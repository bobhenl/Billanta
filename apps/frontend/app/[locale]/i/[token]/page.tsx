import { AlertTriangle, CheckCircle2, Clock, Download, Info, Paperclip } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import {
  czechAccountToIban,
  generateQrInvoiceString,
  generateSpaydString,
  qrInvoiceForSpayd,
} from "@faktur/cz-compliance";
import {
  confirmCardPayment,
  getPublicInvoice,
  recordPublicInvoiceView,
  type PublicInvoiceStatus,
} from "@/lib/public-invoices";
import type { Metadata } from "next";
import { privateLinkMetadata } from "@/lib/seo";
import { QuoteResponse } from "./quote-response";
import { ReportAbuse } from "./report-abuse";
import { PayerNote } from "./payer-note";
import { CardPayButton } from "./card-pay-button";

// A client's private invoice link: never indexed, never followed.
// Generic, non-revealing preview card; see privateLinkMetadata.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return privateLinkMetadata(locale);
}

/**
 * Client-portal invoice view — the page a client lands on after clicking an
 * emailed invoice link. No auth, no dashboard chrome.
 *
 * ============================================================================
 * ROUTE PLACEMENT: `app/[locale]/i/[token]/page.tsx`, INSIDE the `[locale]`
 * segment (not a locale-independent `app/i/[token]/page.tsx`) — reasoning:
 * ============================================================================
 *   1. `middleware.ts`'s matcher (`/((?!api|trpc|_next|_vercel|.*\\..*).*)`)
 *      applies next-intl's locale-prefix redirect to essentially every path
 *      in the app. A route living outside `[locale]` would still get
 *      intercepted and redirected to `/cs/i/:token` before ever reaching a
 *      locale-less page — carving out an exception would mean editing the
 *      shared middleware matcher, which every other route in the app
 *      currently relies on behaving uniformly.
 *   2. There is no root `app/layout.tsx` in this project — `<html>`/`<body>`,
 *      the theme provider, and the `NextIntlClientProvider` are all set up
 *      once in `app/[locale]/layout.tsx`. A locale-independent route would
 *      need its own parallel root layout, duplicating that setup.
 *   3. Staying inside `[locale]` costs only one extra path segment on the
 *      shared link (e.g. `https://.../cs/i/<token>`) and, in exchange, lets
 *      this page's chrome-free UI (labels like "Total due", "Pay this
 *      invoice") come from the same `messages/{cs,sk,en}.json` catalogs as
 *      the rest of the app, via `getTranslations`. The invoice *data* itself
 *      is locale-agnostic (dates/amounts use `Intl` formatting against the
 *      resolved locale below); only the surrounding UI copy is translated.
 *   4. This mirrors how `app/[locale]/legal/terms` and `app/[locale]/about`
 *      are already structured: locale-prefixed, but with no dashboard nav —
 *      "public, chrome-free" and "locale-prefixed" aren't in tension
 *      anywhere else in this codebase.
 */
export const dynamic = "force-dynamic";

interface PublicInvoicePageProps {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ preview?: string; report?: string; card?: string; session_id?: string }>;
}

const STATUS_BADGE_CLASSES: Record<PublicInvoiceStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-warning/15 text-warning",
  issued: "bg-accent text-accent-foreground",
  paid: "bg-success/15 text-success",
  cancelled: "bg-destructive/10 text-destructive",
};

export default async function PublicInvoicePage({
  params,
  searchParams,
}: PublicInvoicePageProps) {
  const { token } = await params;
  const { preview, report, card, session_id: sessionId } = await searchParams;
  // Back from Stripe Checkout: book the payment before reading the invoice, so it already shows as paid.
  const cardResult = card === "success" && sessionId ? await confirmCardPayment(token, sessionId) : null;
  const invoice = await getPublicInvoice(token);

  if (!invoice) {
    notFound();
  }
  // The owner's own "open client view" link carries ?preview=1 and is not counted.
  if (!preview) await recordPublicInvoiceView(token);

  const t = await getTranslations("publicInvoice");
  const tStatus = await getTranslations("invoices.status");
  const tApp = await getTranslations("app");
  const locale = await getLocale();

  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: invoice.currency,
  });
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "long" });
  const percentFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  });

  // --- Payment section: SPAYD ("QR Platba") QR code -----------------------
  // Only the tenant's IBAN (from `get_public_invoice_supplier_info`, joined
  // server-side via the invoice's public_token — see
  // `apps/backend/drizzle/rls-policies.sql`) is needed to build the SPAYD
  // string; `generateSpaydString` (packages/cz-compliance/src/spayd.ts)
  // encodes IBAN + amount + currency + variable symbol into the standard
  // Czech Banking Association short payment descriptor, which `qrcode`
  // then renders as an actual scannable SVG image below — never just shown
  // as raw text, which would defeat the entire "scan to pay" point.
  //
  // Card payments go through the supplier's OWN Stripe account (Settings →
  // Způsoby úhrady → Platba kartou); `invoice.cardPayment` says whether to
  // offer the button — see apps/backend/src/card-payments.
  const remainingToPay = Math.max(0, Math.round((invoice.total - (invoice.amountPaid ?? 0)) * 100) / 100);
  let qrCodeSvg: string | null = null;
  const supplier = invoice.supplier;
  const iban =
    supplier?.bankAccountIban ??
    (supplier?.bankAccountNumber
      ? czechAccountToIban(
          supplier.bankAccountNumber,
          supplier.bankAccountBankCode,
        )
      : null);
  // Same rule as the PDF: QR/account only for (custom methods behaving as) bank transfer.
  const isTransfer = !invoice.paymentMethod || invoice.paymentMethod === "bank_transfer";
  if (iban && !invoice.quote && isTransfer) {
    const spayd = generateSpaydString({
      iban,
      // Only what is left after partial payments.
      amount: remainingToPay > 0 ? remainingToPay : invoice.total,
      currency: invoice.currency,
      variableSymbol: invoice.variableSymbol ?? undefined,
      dueDate: invoice.dueDate ? new Date(invoice.dueDate) : undefined,
      message: invoice.invoiceNumber ?? undefined,
      // QR Platba + Faktura: the client's accounting app can import the invoice from the same scan.
      invoice: invoice.qrInvoice
        ? qrInvoiceForSpayd(invoice.qrInvoice)
        : invoice.invoiceNumber && invoice.issueDate
          ? qrInvoiceForSpayd(
              generateQrInvoiceString({
                invoiceNumber: invoice.invoiceNumber,
                issueDate: new Date(invoice.issueDate),
                totalAmount: invoice.total,
                currency: invoice.currency,
                dueDate: invoice.dueDate
                  ? new Date(invoice.dueDate)
                  : undefined,
                variableSymbol: invoice.variableSymbol ?? undefined,
                documentType: invoice.vatTotal > 0 ? 9 : 0,
                iban,
                software: "Billanta",
              }),
            )
          : undefined,
    });
    qrCodeSvg = await QRCode.toString(spayd, { type: "svg", margin: 1 });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div className="mb-8 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          {tApp("name")}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {invoice.invoiceNumber
                ? t(invoice.quote ? "quoteTitle" : "title", {
                    number: invoice.invoiceNumber,
                  })
                : t("unnumbered")}
            </h1>
            <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {invoice.issueDate && (
                <>
                  <dt>{t("issueDateLabel")}:</dt>
                  <dd>{dateFormatter.format(new Date(invoice.issueDate))}</dd>
                </>
              )}
              {invoice.dueDate && (
                <>
                  <dt>
                    {t(invoice.quote ? "validUntilLabel" : "dueDateLabel")}:
                  </dt>
                  <dd>{dateFormatter.format(new Date(invoice.dueDate))}</dd>
                </>
              )}
              {invoice.variableSymbol && (
                <>
                  <dt>{t("variableSymbolLabel")}:</dt>
                  <dd className="font-mono">{invoice.variableSymbol}</dd>
                </>
              )}
            </dl>
          </div>

          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[invoice.status]}`}
          >
            {tStatus(invoice.status)}
          </span>
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {t("lineItemsTitle")}
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">
                    {t("columns.description")}
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    {t("columns.quantity")}
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    {t("columns.unitPrice")}
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    {t("columns.vatRate")}
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    {t("columns.lineTotal")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((item, index) => (
                  <tr
                    key={index}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-4 py-2.5">{item.description}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {currencyFormatter.format(item.unitPrice)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {item.vatRate != null
                        ? `${percentFormatter.format(item.vatRate)} %`
                        : "–"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {currencyFormatter.format(item.quantity * item.unitPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto mt-4 max-w-[280px] space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{t("subtotalLabel")}</span>
              <span className="tabular-nums">
                {currencyFormatter.format(invoice.subtotal)}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{t("vatTotalLabel")}</span>
              <span className="tabular-nums">
                {currencyFormatter.format(invoice.vatTotal)}
              </span>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5 text-base font-semibold">
              <span>{t("totalLabel")}</span>
              <span className="tabular-nums">
                {currencyFormatter.format(invoice.total)}
              </span>
            </div>
            {invoice.status === "issued" && (invoice.amountPaid ?? 0) > 0 && (
              <>
                <div className="flex justify-between text-success">
                  <span>{t("paidSoFarLabel")}</span>
                  <span className="tabular-nums">{currencyFormatter.format(invoice.amountPaid ?? 0)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{t("remainingLabel")}</span>
                  <span className="tabular-nums">{currencyFormatter.format(remainingToPay)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {invoice.attachments && invoice.attachments.length > 0 && (
          <div className="mt-8">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Paperclip className="h-4 w-4" />
              {t("attachmentsTitle")}
            </h2>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {invoice.attachments.map((file) => (
                <li key={file.id}>
                  <a
                    href={`/api/public/invoices/${token}/attachments/${file.id}`}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted/50 hover:text-primary"
                  >
                    <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {file.filename}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {file.sizeBytes < 1024
                        ? `${file.sizeBytes} B`
                        : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(file.sizeBytes / 1024)} kB`}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {card === "success" && (
          <div
            className={`mt-8 flex items-start gap-3 rounded-lg border p-4 text-sm ${cardResult === "paid" || invoice.status === "paid" ? "border-success/40 bg-success/5" : "border-border bg-muted/40"}`}
          >
            {cardResult === "paid" || invoice.status === "paid" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            ) : (
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
            <p>{t(cardResult === "paid" || invoice.status === "paid" ? "card.success" : "card.processing")}</p>
          </div>
        )}
        {card === "cancelled" && (
          <div className="mt-8 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <p>{t("card.cancelled")}</p>
          </div>
        )}

        {!preview && <PayerNote token={token} />}

        {invoice.quote && (
          <QuoteResponse
            token={token}
            preview={Boolean(preview)}
            state={invoice.quote}
            respondedAtLabel={
              invoice.quote.respondedAt
                ? dateFormatter.format(new Date(invoice.quote.respondedAt))
                : null
            }
          />
        )}

        {!invoice.quote && (
          <div className="mt-8 rounded-lg border border-dashed border-border p-5">
            <h2 className="text-sm font-semibold">{t("paymentTitle")}</h2>
            {invoice.cardPayment && (
              <CardPayButton
                token={token}
                disabled={Boolean(preview)}
                amountLabel={currencyFormatter.format(remainingToPay > 0 ? remainingToPay : invoice.total)}
              />
            )}
            {invoice.paymentMethodLabel && (
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">{t("paymentMethod")}: </span>
                <span className="font-medium">{invoice.paymentMethodLabel}</span>
              </p>
            )}
            {invoice.paymentInstructions && (
              <p className="mt-2 whitespace-pre-line rounded-md bg-muted/50 px-3 py-2 text-sm">
                {invoice.paymentInstructions
                  .replaceAll("{number}", invoice.invoiceNumber ?? "")
                  .replaceAll("{vs}", invoice.variableSymbol ?? "")
                  .replaceAll("{amount}", currencyFormatter.format(invoice.total))
                  .replaceAll("{remaining}", currencyFormatter.format(remainingToPay))}
              </p>
            )}

            {qrCodeSvg ? (
              <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <div
                  className="h-48 w-48 shrink-0 [&_svg]:h-full [&_svg]:w-full"
                  // `qrCodeSvg` is generated server-side by the trusted `qrcode`
                  // library from a SPAYD string we just built above — not
                  // user-supplied HTML — so injecting it directly is safe and
                  // is the only way to render actual SVG markup as an image
                  // rather than escaped text.
                  dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
                />
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>{t("paymentInstructions")}</p>
                  <p className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t("paymentDisclaimer")}</span>
                  </p>
                </div>
              </div>
            ) : isTransfer ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t("noBankAccount")}
              </p>
            ) : null}
          </div>
        )}

        {!preview && <ReportAbuse token={token} initiallyOpen={report === '1'} />}
      </div>
    </div>
  );
}
