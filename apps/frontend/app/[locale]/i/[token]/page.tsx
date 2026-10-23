import { CheckCircle2, Clock, Download, Info, Paperclip } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import {
  czechAccountToIban,
  generateQrInvoiceString,
  generateSpaydString,
  paymentQrScheme,
  qrInvoiceForSpayd,
} from "@faktur/cz-compliance";
import { generatePayBySquareString } from "@faktur/cz-compliance/pay-by-square";
import {
  confirmCardPayment,
  getPublicInvoice,
  recordPublicInvoiceView,
  type PublicInvoiceStatus,
} from "@/lib/public-invoices";
import type { Metadata } from "next";
import { privateLinkMetadata } from "@/lib/seo";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { PublicDemoNotice } from "@/components/demo/public-demo-notice";
import { QuoteResponse } from "./quote-response";
import { ReportAbuse } from "./report-abuse";
import { PayerNote } from "./payer-note";
import { CardPayButton } from "./card-pay-button";
import { PaymentDetails, type PaymentDetailRow } from "./payment-details";
import { PrintButton } from "./print-button";
import { InfoHint } from "@/components/info-hint";
import { buttonClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

/**
 * Links from the bottom of the page to our own site, tagged like
 * brandCreditUrl in the backend (src/invoices/brand-credit.ts) so signups
 * from them can be counted; `ref` credits the issuer's referral.
 */
function siteHref(path: string, ref: string | null, tags: Record<string, string>): string {
  const params = new URLSearchParams({ utm_source: "invoice", ...tags });
  if (ref && /^[A-Za-z0-9]{4,12}$/.test(ref)) params.set("ref", ref);
  return `${SITE_URL.replace(/\/$/, "")}${path}?${params.toString()}`;
}

// A client's private invoice link: never indexed, never followed.
// Generic, non-revealing preview card; see privateLinkMetadata.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return privateLinkMetadata(locale);
}

/**
 * Client-portal invoice view – the page a client lands on after clicking an
 * emailed invoice link. No auth, no dashboard chrome.
 *
 * ============================================================================
 * ROUTE PLACEMENT: `app/[locale]/i/[token]/page.tsx`, INSIDE the `[locale]`
 * segment (not a locale-independent `app/i/[token]/page.tsx`) – reasoning:
 * ============================================================================
 *   1. `middleware.ts`'s matcher (`/((?!api|trpc|_next|_vercel|.*\\..*).*)`)
 *      applies next-intl's locale-prefix redirect to essentially every path
 *      in the app. A route living outside `[locale]` would still get
 *      intercepted and redirected to `/cs/i/:token` before ever reaching a
 *      locale-less page – carving out an exception would mean editing the
 *      shared middleware matcher, which every other route in the app
 *      currently relies on behaving uniformly.
 *   2. There is no root `app/layout.tsx` in this project – `<html>`/`<body>`,
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
 *      are already structured: locale-prefixed, but with no dashboard nav –
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
  // server-side via the invoice's public_token – see
  // `apps/backend/drizzle/rls-policies.sql`) is needed to build the SPAYD
  // string; `generateSpaydString` (packages/cz-compliance/src/spayd.ts)
  // encodes IBAN + amount + currency + variable symbol into the standard
  // Czech Banking Association short payment descriptor, which `qrcode`
  // then renders as an actual scannable SVG image below – never just shown
  // as raw text, which would defeat the entire "scan to pay" point.
  //
  // Card payments go through the supplier's OWN Stripe account (Settings →
  // Způsoby úhrady → Platba kartou); `invoice.cardPayment` says whether to
  // offer the button – see apps/backend/src/card-payments.
  const remainingToPay = Math.max(0, Math.round((invoice.total - (invoice.amountPaid ?? 0)) * 100) / 100);
  let qrCodeSvg: string | null = null;
  let qrBySquare = false;
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
  // Only what is left after partial payments.
  const amountToPay = remainingToPay > 0 ? remainingToPay : invoice.total;
  // Slovak payers get PAY by square, same rule as the PDF (paymentQrScheme).
  // It validates the IBAN; on failure we fall back to SPAYD like the PDF does.
  if (
    iban &&
    !invoice.quote &&
    isTransfer &&
    paymentQrScheme({ payeeIban: iban, currency: invoice.currency, buyerCountry: invoice.buyerCountry }) === "pay_by_square"
  ) {
    try {
      const bysquare = generatePayBySquareString({
        iban,
        amount: amountToPay,
        currency: invoice.currency,
        variableSymbol: invoice.variableSymbol ?? undefined,
        dueDate: invoice.dueDate ? new Date(invoice.dueDate) : undefined,
        message: invoice.invoiceNumber ?? undefined,
        invoiceId: invoice.invoiceNumber ?? undefined,
        beneficiaryName: supplier?.companyName ?? "",
      });
      qrCodeSvg = await QRCode.toString(bysquare, { type: "svg", margin: 1 });
      qrBySquare = true;
    } catch {
      qrCodeSvg = null;
    }
  }
  if (iban && !invoice.quote && isTransfer && !qrCodeSvg) {
    const spayd = generateSpaydString({
      iban,
      amount: amountToPay,
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


  const paid = invoice.status === "paid";
  const overdue =
    invoice.status === "issued" && !invoice.quote && Boolean(invoice.dueDate) && (invoice.dueDate ?? "") < new Date().toISOString().slice(0, 10);
  // Nothing to pay on a paid or cancelled document: no QR that would pay it twice.
  const showPayment = !invoice.quote && !paid && invoice.status !== "cancelled";
  const partlyPaid = invoice.status === "issued" && (invoice.amountPaid ?? 0) > 0;
  const showVat = invoice.vatTotal > 0 || invoice.lineItems.some((i) => (i.vatRate ?? 0) > 0);
  // "Issued" says nothing to a payer: the amount block already reads "Amount due".
  const badge: { label: string; className: string } | null = overdue
    ? { label: t("overdue"), className: "bg-destructive/10 text-destructive" }
    : invoice.status === "issued" || (invoice.quote && invoice.status !== "cancelled")
      ? null
      : { label: tStatus(invoice.status), className: STATUS_BADGE_CLASSES[invoice.status] };

  const accountNumber = supplier?.bankAccountNumber
    ? supplier.bankAccountBankCode
      ? `${supplier.bankAccountNumber}/${supplier.bankAccountBankCode}`
      : supplier.bankAccountNumber
    : null;
  // Bank apps want a bare number in the amount field, without grouping or currency.
  const plainAmount = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(amountToPay);
  const paymentRows: PaymentDetailRow[] =
    isTransfer && (iban || accountNumber)
      ? [
          ...(accountNumber ? [{ label: t("pay.account"), value: accountNumber, strong: true }] : []),
          ...(iban ? [{ label: t("pay.iban"), value: iban.replace(/(.{4})(?=.)/g, "$1 "), copy: iban }] : []),
          ...(invoice.variableSymbol ? [{ label: t("variableSymbolLabel"), value: invoice.variableSymbol, strong: true }] : []),
          { label: t("pay.amount"), value: currencyFormatter.format(amountToPay), copy: plainAmount, strong: true },
        ]
      : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-14 print:py-0" data-print-sheet>
      {invoice.demo && <PublicDemoNotice />}

      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-8">
        {invoice.demo && <PublicDemoNotice watermark />}

        {/* Who is billing comes first: the reader may never have heard of the app the link is on. */}
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {supplier?.companyName && <p className="break-words text-sm font-semibold text-primary">{supplier.companyName}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                {invoice.invoiceNumber
                  ? t(invoice.quote ? "quoteTitle" : "title", { number: invoice.invoiceNumber })
                  : t("unnumbered")}
              </h1>
              {badge && (
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
                  {badge.label}
                </span>
              )}
            </div>
            {invoice.issueDate && (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("issuedOn", { date: dateFormatter.format(new Date(invoice.issueDate)) })}
                {invoice.variableSymbol && paymentRows.length === 0 && (
                  <>
                    {" · "}
                    {t("variableSymbolLabel")} <span className="font-mono">{invoice.variableSymbol}</span>
                  </>
                )}
              </p>
            )}
          </div>
          {/* The real document once it has a number; an unnumbered one can only be printed from the page. */}
          {invoice.invoiceNumber ? (
            <a
              href={`/api/public/invoices/${token}/pdf`}
              download
              className={cn(buttonClass.primary, "h-10 shrink-0 px-3 sm:px-4 print:hidden")}
              aria-label={t("downloadPdf")}
            >
              <Download className="h-4 w-4" />
              <span className="sm:hidden">{t("downloadPdfShort")}</span>
              <span className="hidden sm:inline">{t("downloadPdf")}</span>
            </a>
          ) : (
            <PrintButton />
          )}
        </header>

        <div className="mt-5 rounded-xl bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            {invoice.quote
              ? t("quoteTotalLabel")
              : showPayment
                ? t(partlyPaid ? "remainingLabel" : "amountDueLabel")
                : t("totalShortLabel")}
          </p>
          <p className="mt-0.5 text-3xl font-extrabold tracking-tight tabular-nums">
            {currencyFormatter.format(showPayment ? amountToPay : invoice.total)}
          </p>
          {invoice.dueDate && (invoice.quote || showPayment) && (
            <p className={`mt-1 text-sm font-semibold ${overdue ? "text-destructive" : "text-foreground"}`}>
              {t(invoice.quote ? "validUntilOn" : "dueOn", { date: dateFormatter.format(new Date(invoice.dueDate)) })}
            </p>
          )}
        </div>

        {card === "success" && (
          <div
            className={`mt-4 flex items-start gap-3 rounded-lg border p-4 text-sm ${cardResult === "paid" || paid ? "border-success/40 bg-success/5" : "border-border bg-muted/40"}`}
          >
            {cardResult === "paid" || paid ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            ) : (
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
            <p>{t(cardResult === "paid" || paid ? "card.success" : "card.processing")}</p>
          </div>
        )}
        {card === "cancelled" && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <p>{t("card.cancelled")}</p>
          </div>
        )}

        {invoice.quote && (
          <QuoteResponse
            token={token}
            preview={Boolean(preview)}
            state={invoice.quote}
            respondedAtLabel={invoice.quote.respondedAt ? dateFormatter.format(new Date(invoice.quote.respondedAt)) : null}
          />
        )}

        {showPayment && (
          <section className="mt-6">
            <h2 className="text-base font-bold">{t("paymentTitle")}</h2>
            {invoice.cardPayment && !invoice.demo && (
              <CardPayButton token={token} disabled={Boolean(preview)} amountLabel={currencyFormatter.format(amountToPay)} />
            )}
            {invoice.paymentMethodLabel && !isTransfer && (
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">{t("paymentMethod")}: </span>
                <span className="font-medium">{invoice.paymentMethodLabel}</span>
              </p>
            )}
            {invoice.paymentInstructions && (
              <p className="mt-2 whitespace-pre-line break-words rounded-md bg-muted/50 px-3 py-2 text-sm">
                {invoice.paymentInstructions
                  .replaceAll("{number}", invoice.invoiceNumber ?? "")
                  .replaceAll("{vs}", invoice.variableSymbol ?? "")
                  .replaceAll("{amount}", currencyFormatter.format(invoice.total))
                  .replaceAll("{remaining}", currencyFormatter.format(remainingToPay))}
              </p>
            )}

            {paymentRows.length > 0 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
                {/* On a phone the QR is on the screen it would be scanned with, so the copyable details come first there. */}
                {qrCodeSvg && (
                  <div className="order-last flex flex-col items-center gap-2 sm:order-none">
                    <div
                      className="h-44 w-44 shrink-0 rounded-lg bg-white p-1 [&_svg]:h-full [&_svg]:w-full"
                      // `qrCodeSvg` is generated server-side by the trusted `qrcode`
                      // library from a SPAYD or PAY by square string we just built above – not
                      // user-supplied HTML – so injecting it directly is safe and
                      // is the only way to render actual SVG markup as an image
                      // rather than escaped text.
                      dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
                    />
                    <InfoHint
                      hint={t(qrBySquare ? "paymentDisclaimerBySquare" : "paymentDisclaimer")}
                      className="max-w-[16rem]"
                      rowClassName="justify-center text-center text-xs text-muted-foreground"
                    >
                      <span>{t("paymentInstructions")}</span>
                    </InfoHint>
                  </div>
                )}
                <PaymentDetails rows={paymentRows} />
              </div>
            ) : isTransfer ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("noBankAccount")}</p>
            ) : null}
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("lineItemsTitle")}</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium sm:px-4">{t("columns.description")}</th>
                  <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">{t("columns.quantity")}</th>
                  <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">{t("columns.unitPrice")}</th>
                  {showVat && <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">{t("columns.vatRate")}</th>}
                  <th className="px-3 py-2 text-right font-medium sm:px-4">{t("columns.lineTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((item, index) => (
                  <tr key={index} className="border-b border-border align-top last:border-b-0">
                    <td className="px-3 py-2.5 sm:px-4">
                      <span className="break-words">{item.description}</span>
                      {/* On a phone the quantity, unit price and VAT columns fold into one line under the name. */}
                      <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums sm:hidden">
                        {item.quantity} × {currencyFormatter.format(item.unitPrice)}
                        {showVat && item.vatRate != null ? ` · ${t("columns.vatRate")} ${percentFormatter.format(item.vatRate)} %` : ""}
                      </span>
                    </td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums sm:table-cell">{item.quantity}</td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 text-right tabular-nums sm:table-cell">
                      {currencyFormatter.format(item.unitPrice)}
                    </td>
                    {showVat && (
                      <td className="hidden whitespace-nowrap px-4 py-2.5 text-right tabular-nums sm:table-cell">
                        {item.vatRate != null ? `${percentFormatter.format(item.vatRate)} %` : ""}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums sm:px-4">
                      {currencyFormatter.format(item.quantity * item.unitPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto mt-3 max-w-[280px] space-y-1.5 text-sm">
            {invoice.vatTotal > 0 && (
              <>
                <div className="flex justify-between gap-4 text-muted-foreground">
                  <span>{t("subtotalLabel")}</span>
                  <span className="tabular-nums">{currencyFormatter.format(invoice.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-4 text-muted-foreground">
                  <span>{t("vatTotalLabel")}</span>
                  <span className="tabular-nums">{currencyFormatter.format(invoice.vatTotal)}</span>
                </div>
              </>
            )}
            <div className={`flex justify-between gap-4 font-semibold ${invoice.vatTotal > 0 ? "border-t border-border pt-1.5" : ""}`}>
              <span>{t(invoice.quote ? "quoteTotalLabel" : "totalShortLabel")}</span>
              <span className="tabular-nums">{currencyFormatter.format(invoice.total)}</span>
            </div>
            {partlyPaid && (
              <>
                <div className="flex justify-between gap-4 text-success">
                  <span>{t("paidSoFarLabel")}</span>
                  <span className="tabular-nums">{currencyFormatter.format(invoice.amountPaid ?? 0)}</span>
                </div>
                <div className="flex justify-between gap-4 font-semibold">
                  <span>{t("remainingLabel")}</span>
                  <span className="tabular-nums">{currencyFormatter.format(remainingToPay)}</span>
                </div>
              </>
            )}
          </div>
        </section>

        {invoice.attachments && invoice.attachments.length > 0 && (
          <section className="mt-8">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Paperclip className="h-4 w-4" />
              {t("attachmentsTitle")}
            </h2>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {invoice.attachments.map((file) => (
                <li key={file.id}>
                  <a
                    href={`/api/public/invoices/${token}/attachments/${file.id}`}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted/50 hover:text-primary"
                  >
                    <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {file.sizeBytes < 1024
                        ? `${file.sizeBytes} B`
                        : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(file.sizeBytes / 1024)} kB`}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!preview && <PayerNote token={token} />}

        {!preview && <ReportAbuse token={token} initiallyOpen={report === "1"} />}

        {/* Last on the page and small: the supplier's identity leads, the customer may invoice too. */}
        {invoice.brandCredit && (
          <p className="mt-6 border-t border-border pt-4 text-center text-xs text-muted-foreground">
            <a
              href={siteHref(`/${locale}`, invoice.brandCredit.ref, { utm_medium: "footer", utm_content: "page" })}
              className="hover:text-foreground hover:underline"
            >
              {t("madeWith", { name: SITE_NAME })}
            </a>
            {" · "}
            {t("cta.question")}{" "}
            <a
              href={siteHref(`/${locale}/signup`, invoice.brandCredit.ref, { utm_medium: "public_page" })}
              className="font-medium text-primary hover:underline"
            >
              {t("cta.action", { name: SITE_NAME })}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
