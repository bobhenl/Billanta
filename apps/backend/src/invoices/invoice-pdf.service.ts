import { fillTemplate } from "../tenants/email-prefs";
import { templateValues, templateVarsOf } from "../tenants/template-vars";
import { displayCustomField, documentVars } from "./custom-fields";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import {
  BILINGUAL_SEPARATOR,
  czechAccountToIban,
  generateQrInvoiceString,
  generateSpaydString,
  isEuReverseChargeService,
  paymentQrScheme,
  qrInvoiceForSpayd,
  renderInvoicePdf,
  renderLetterPdf,
  type HomeCurrency,
  type InvoicePdfModel,
  type PdfFonts,
} from "@faktur/cz-compliance";
import { generatePayBySquareString } from "@faktur/cz-compliance/pay-by-square";
import PDFDocument from "pdfkit";
import { demoFooterText, demoWatermarkText } from "./invoice-pdf-demo";
import QRCode from "qrcode";
import * as schema from "../../drizzle/schema";
import { lineBase, type InvoiceVatBreakdown } from "./invoice-total.util";
import { pdfAccentOf, pdfQrDueDateOf, pdfQrModeOf, pdfSecondLanguageOf, tintOf, type PdfQrMode } from "../tenants/invoice-form-prefs";
import { invoiceLinkOf } from "../public-links/public-link";
import { rateLineLabel } from "./exchange-rate-mode";
import { BRAND_NAME, brandCreditFor, brandCreditUrl, CREDIT_LABELS, siteUrl } from "./brand-credit";
import { tenantCountry, tenantHomeCurrencyOf } from "../tenants/home-currency";
import { assertServerReadable, printedTexts } from "../vault/sealed";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;
type TenantRow = typeof schema.tenants.$inferSelect;

/**
 * Which reverse-charge note the document prints: "eu" for a service to a
 * business in another EU state (from a payer with reverse charge ticked, or
 * from an identified person, who charges no VAT and so never ticks it),
 * "domestic" for the §92a note, else none.
 */
/**
 * A Czech or Slovak PSČ as people write it, "602 00". ARES and the other
 * registers hand it over without the space, and typed ones come both ways.
 */
export function displayPostalCode(code: string | null, country: string | null | undefined): string | null {
  const digits = code?.replace(/\s+/g, "") ?? "";
  const local = !country || ["CZ", "SK"].includes(country.toUpperCase());
  return local && /^\d{5}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3)}` : code;
}

export function reverseChargeNoteKind(
  invoice: Pick<InvoiceRow, "documentType" | "reverseCharge">,
  tenant: Pick<TenantRow, "vatStatus" | "country">,
  contact?: Pick<ContactRow, "ico" | "dic" | "isPerson" | "addressCountry">,
): "eu" | "domestic" | null {
  const taxDocument = invoice.documentType === "invoice" || invoice.documentType === "credit_note";
  const customer = contact
    ? { ico: contact.ico ?? undefined, dic: contact.dic ?? undefined, isPerson: contact.isPerson, address: { countryCode: contact.addressCountry } }
    : undefined;
  const euService = taxDocument && isEuReverseChargeService(tenant.vatStatus, tenantCountry(tenant), customer);
  if (euService && (invoice.reverseCharge || tenant.vatStatus === "identified")) return "eu";
  return invoice.reverseCharge ? "domestic" : null;
}

// The layout lives in cz-compliance (invoice-pdf.ts) so the browser can draw it too.
export { BILINGUAL_SEPARATOR, mentionsReverseCharge } from "@faktur/cz-compliance";
type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;
type RelatedDocument = { invoiceNumber: string | null; documentType: InvoiceRow["documentType"] } | null;
type Lang = "cs" | "sk" | "en";

// pdfkit's built-in Helvetica only covers WinAnsi, which has no č/ř/ě/ů —
// Czech text came out garbled. DejaVu Sans (npm `dejavu-fonts-ttf`) covers
// all of CZ/SK; Helvetica stays as a fallback should the package be missing.
function resolveFonts(): { regular: string; bold: string } | null {
  try {
    const dir = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
    const regular = join(dir, "DejaVuSans.ttf");
    const bold = join(dir, "DejaVuSans-Bold.ttf");
    return existsSync(regular) && existsSync(bold) ? { regular, bold } : null;
  } catch {
    return null;
  }
}
/** Font files on disk; the browser renderer downloads the same two (`GET /invoices/pdf-fonts/:weight`). */
export const PDF_FONT_FILES: { regular: string; bold: string } | null = resolveFonts();
const FONTS: PdfFonts | null = PDF_FONT_FILES;

const pngDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

const L = {
  cs: {
    invoice: "Faktura – daňový doklad",
    invoiceNonVat: "Faktura",
    proforma: "Zálohová faktura",
    credit_note: "Opravný daňový doklad",
    quote: "Cenová nabídka",
    no: "č.",
    supplier: "Dodavatel",
    customer: "Odběratel",
    contactPerson: "Kontaktní osoba",
    ico: "IČO",
    dic: "DIČ",
    nonVatPayer: "Neplátce DPH",
    issueDate: "Datum vystavení",
    dueDate: "Datum splatnosti",
    validUntil: "Platnost do",
    taxableSupplyDate: "DUZP",
    paymentMethod: "Způsob úhrady",
    account: "Bankovní účet",
    vs: "Variabilní symbol",
    ks: "Konstantní symbol",
    ss: "Specifický symbol",
    order: "Objednávka",
    issuePlace: "Místo vystavení",
    issuedBy: "Vystavil",
    related: "K dokladu",
    description: "Popis",
    quantity: "Množství",
    unitPrice: "Cena/j.",
    discount: "Sleva",
    vat: "DPH",
    total: "Celkem",
    vatRecap: "Rekapitulace DPH",
    base: "Základ",
    totalToPay: "Celkem k úhradě",
    paidSoFar: "Uhrazeno",
    remaining: "Zbývá uhradit",
    totalQuote: "Celkem",
    qr: "QR platba",
    qrPayBySquare: "PAY by square",
    qrInvoice: "QR Faktura",
    qrLink: "Faktura online",
    qrAfterIssue: "QR platba se doplní po vystavení",
    qrInvoiceAfterIssue: "QR Faktura se doplní po vystavení",
    reverseCharge: "Daň odvede zákazník (přenesená daňová povinnost dle § 92a zákona o DPH).",
    // Service to a business in another EU state (§29/2c ZDPH, art. 196 of Directive 2006/112/EC).
    reverseChargeEu: "Daň odvede zákazník.",
    proformaNote: "Zálohová faktura není daňovým dokladem.",
    fxRate: "Kurz ČNB",
    fxRateOn: "Kurz ČNB k {date}",
    fxRateEcbOn: "Kurz ECB k {date}",
    fxRateAnnual: "Jednotný kurz pro rok {year}",
    fxRateManual: "Kurz",
    vatInHome: "DPH v {currency}",
    totalInHome: "Celkem v {currency}",
    paid: "UHRAZENO",
    cancelled: "STORNO",
    methods: {
      bank_transfer: "Převodem",
      cash: "Hotově",
      card: "Kartou",
      cash_on_delivery: "Dobírkou",
      other: "Jinak",
    },
  },
  sk: {
    invoice: "Faktúra – daňový doklad",
    invoiceNonVat: "Faktúra",
    proforma: "Zálohová faktúra",
    credit_note: "Dobropis",
    quote: "Cenová ponuka",
    no: "č.",
    supplier: "Dodávateľ",
    customer: "Odberateľ",
    contactPerson: "Kontaktná osoba",
    ico: "IČO",
    dic: "DIČ",
    nonVatPayer: "Neplatiteľ DPH",
    issueDate: "Dátum vystavenia",
    dueDate: "Dátum splatnosti",
    validUntil: "Platnosť do",
    taxableSupplyDate: "Dátum dodania",
    paymentMethod: "Spôsob úhrady",
    account: "Bankový účet",
    vs: "Variabilný symbol",
    ks: "Konštantný symbol",
    ss: "Špecifický symbol",
    order: "Objednávka",
    issuePlace: "Miesto vystavenia",
    issuedBy: "Vystavil",
    related: "K dokladu",
    description: "Popis",
    quantity: "Množstvo",
    unitPrice: "Cena/j.",
    discount: "Zľava",
    vat: "DPH",
    total: "Spolu",
    vatRecap: "Rekapitulácia DPH",
    base: "Základ",
    totalToPay: "Spolu na úhradu",
    paidSoFar: "Uhradené",
    remaining: "Zostáva uhradiť",
    totalQuote: "Spolu",
    qr: "QR platba",
    qrPayBySquare: "PAY by square",
    qrInvoice: "QR faktúra",
    qrLink: "Faktúra online",
    qrAfterIssue: "QR platba sa doplní po vystavení",
    qrInvoiceAfterIssue: "QR faktúra sa doplní po vystavení",
    reverseCharge: "Prenesenie daňovej povinnosti.",
    reverseChargeEu: "Prenesenie daňovej povinnosti.",
    fxRate: "Kurz ČNB",
    fxRateOn: "Kurz ČNB k {date}",
    fxRateEcbOn: "Kurz ECB zo dňa {date}",
    fxRateAnnual: "Jednotný kurz pre rok {year}",
    fxRateManual: "Kurz",
    vatInHome: "DPH v {currency}",
    totalInHome: "Spolu v {currency}",
    proformaNote: "Zálohová faktúra nie je daňovým dokladom.",
    paid: "UHRADENÉ",
    cancelled: "STORNO",
    methods: {
      bank_transfer: "Prevodom",
      cash: "V hotovosti",
      card: "Kartou",
      cash_on_delivery: "Dobierkou",
      other: "Inak",
    },
  },
  en: {
    invoice: "Tax invoice",
    invoiceNonVat: "Invoice",
    proforma: "Proforma invoice",
    credit_note: "Credit note",
    quote: "Quote",
    no: "No.",
    supplier: "Supplier",
    customer: "Customer",
    contactPerson: "Contact person",
    ico: "Reg. No.",
    dic: "VAT ID",
    nonVatPayer: "Not a VAT payer",
    issueDate: "Issue date",
    dueDate: "Due date",
    validUntil: "Valid until",
    taxableSupplyDate: "Date of supply",
    paymentMethod: "Payment method",
    account: "Bank account",
    vs: "Variable symbol",
    ks: "Constant symbol",
    ss: "Specific symbol",
    order: "Order",
    issuePlace: "Place of issue",
    issuedBy: "Issued by",
    related: "Related to",
    description: "Description",
    quantity: "Qty",
    unitPrice: "Unit price",
    discount: "Disc.",
    vat: "VAT",
    total: "Total",
    vatRecap: "VAT summary",
    base: "Base",
    totalToPay: "Total due",
    paidSoFar: "Paid",
    remaining: "Left to pay",
    totalQuote: "Total",
    qr: "QR payment",
    qrPayBySquare: "PAY by square",
    qrInvoice: "QR invoice",
    qrLink: "Invoice online",
    qrAfterIssue: "QR payment is added once issued",
    qrInvoiceAfterIssue: "QR invoice is added once issued",
    reverseCharge: "Reverse charge – VAT to be accounted for by the customer.",
    reverseChargeEu: "Reverse charge – VAT to be accounted for by the customer.",
    fxRate: "ČNB rate",
    fxRateOn: "ČNB rate as of {date}",
    fxRateEcbOn: "ECB rate as of {date}",
    fxRateAnnual: "Fixed annual rate for {year}",
    fxRateManual: "Exchange rate",
    vatInHome: "VAT in {currency}",
    totalInHome: "Total in {currency}",
    proformaNote: "A proforma invoice is not a tax document.",
    paid: "PAID",
    cancelled: "CANCELLED",
    methods: {
      bank_transfer: "Bank transfer",
      cash: "Cash",
      card: "Card",
      cash_on_delivery: "Cash on delivery",
      other: "Other",
    },
  },
} as const;

type Labels = (typeof L)[Lang];

/** "Datum vystavení / Issue date" for every label; identical ones ("DPH", "IBAN") stay single. */
export function bilingualLabels(primary: Labels, second: Labels): Labels {
  const join = (a: unknown, b: unknown): unknown => {
    if (typeof a === "string") return a === b ? a : `${a}${BILINGUAL_SEPARATOR}${b}`;
    if (a && typeof a === "object") {
      return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, join(v, (b as Record<string, unknown>)[k])]));
    }
    return a;
  };
  return join(primary, second) as Labels;
}

/**
 * Renders the PDF of an issued document — invoice, proforma, credit note or
 * quote — in the document's language: issuer/customer blocks, dates and
 * payment details, the items table with units and discounts, the VAT
 * recapitulation, notes and (for anything payable with an account on file)
 * an embedded SPAYD "QR Platba" code.
 *
 * Uses `pdfkit`: pure JS, no headless Chromium, so the backend image stays
 * small on a VPS.
 */
/**
 * Whether the document asks the buyer for money. A quote is an offer, a
 * cancelled document is void and a credit note (negative total) pays back,
 * so none of them gets a payment QR or the "Celkem k úhradě" label.
 */
function asksForPayment(invoice: InvoiceRow, totals: InvoiceVatBreakdown): boolean {
  return invoice.documentType !== "quote" && invoice.status !== "cancelled" && totals.totalWithVat > 0;
}

function countryName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Stands in for the number on a draft's preview. */
const DRAFT_NUMBER: Record<Lang, string> = { cs: "(koncept)", sk: "(koncept)", en: "(draft)" };

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  async generate(
    invoice: InvoiceRow,
    contact: ContactRow,
    tenant: TenantRow,
    lineItems: LineItemRow[],
    totals: InvoiceVatBreakdown,
    related: RelatedDocument = null,
  ): Promise<Buffer> {
    // Důvěrný režim: the server can't read the text, and must not print ciphertext instead.
    // The browser draws those from buildModel with the vault key.
    assertServerReadable(...printedTexts(invoice, lineItems));
    const model = await this.buildModel(invoice, contact, tenant, lineItems, totals, related);
    const pdf = await renderInvoicePdf(PDFDocument, model, FONTS);
    return Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  }

  /**
   * Everything the PDF shows, already worded and formatted, so the browser
   * draws a sealed invoice with the same layout as the server. Sealed texts
   * (notes, item descriptions) stay envelopes here: nothing is derived from
   * them, the renderer opens them where the key is.
   */
  async buildModel(
    invoice: InvoiceRow,
    contact: ContactRow,
    tenant: TenantRow,
    lineItems: LineItemRow[],
    totals: InvoiceVatBreakdown,
    related: RelatedDocument = null,
  ): Promise<InvoicePdfModel> {
    const lang: Lang = invoice.language === "sk" || invoice.language === "en" ? invoice.language : "cs";
    // An unissued draft is a preview: a placeholder number, no payment QR (its VS
    // comes with the number) and a stamp on every page.
    const draft = !invoice.invoiceNumber;
    if (draft) invoice = { ...invoice, invoiceNumber: DRAFT_NUMBER[lang] };
    const second = pdfSecondLanguageOf(tenant.invoiceFormPrefs);
    const t = second && second !== lang ? bilingualLabels(L[lang], L[second]) : L[lang];

    const payable = asksForPayment(invoice, totals);
    // A demo's fictional bank account must not end up in anyone's banking app.
    const qrMode = pdfQrModeOf(tenant.invoiceFormPrefs);
    const qr =
      invoice.documentType !== "quote" && !tenant.isDemo && !draft && qrMode !== "off"
        ? await this.buildQrCode(invoice, contact, tenant, totals, payable, qrMode === "auto_link" ? "auto" : qrMode, lang)
        : null;
    // The web page as a second code: the customer opens it with a phone camera, the bank app keeps the first one.
    const linkQr =
      qrMode === "auto_link" && invoice.documentType !== "quote" && !tenant.isDemo && !draft ? await this.buildLinkQr(invoice, tenant, lang) : null;
    // A draft gets no code anyone could pay, but its preview keeps the code's place.
    const qrPending =
      draft && payable && invoice.documentType !== "quote" && !tenant.isDemo && qrMode !== "off" && invoice.paymentMethod === "bank_transfer";

    // With the credit switched off the document carries no trace of Billanta, metadata included.
    const credit = brandCreditFor(tenant, lang, "pdf");

    // Settings → Proměnné: `{vs}`, `{due_date}`, the company's own `{…}` in the notes.
    const docVars = documentVars(invoice.customFields, totals, invoice.amountPaid, templateVarsOf(tenant.templateVars), (n) => `${this.formatNumber(n)} ${invoice.currency}`);
    const vars = { ...templateValues(tenant, invoice, contact), ...docVars.formatted };
    // A non-VAT payer charges no VAT, so a "0%" column and a VAT summary of zeros only confuse the reader.
    const showVat = tenant.dicVatPayer || totals.byRate.some((entry) => entry.vatAmount !== 0);
    // A non-payer billing whole jobs (each line once, no unit) shows just what and how much. A tax
    // document needs the quantity and unit price (§ 29 ZDPH), so a payer and an identified
    // person's EU reverse charge invoice keep them.
    const lumpSum =
      !showVat &&
      !reverseChargeNoteKind(invoice, tenant, contact) &&
      lineItems.length > 0 &&
      lineItems.every((i) => Number(i.quantity) === 1 && !i.unit && !Number(i.discountPercent));

    // The brand name is written exactly so ("PAY by square"), never uppercased.
    const qrLabel = qr
      ? qr.kind === "pay_by_square"
        ? t.qrPayBySquare
        : (qr.kind === "spayd" ? t.qr : qr.kind === "link" ? t.qrLink : t.qrInvoice).toUpperCase()
      : "";
    // A draft made from a payment is paid already: once issued it gets the QR invoice, not a payment code.
    const paidDraft = Number(invoice.amountPaid ?? 0) >= totals.totalWithVat;
    const qrSlot = qr
      ? { label: qrLabel, png: pngDataUrl(qr.png) }
      : qrPending
        ? paidDraft
          ? { label: t.qrInvoice.toUpperCase(), pending: t.qrInvoiceAfterIssue }
          : { label: t.qr.toUpperCase(), pending: t.qrAfterIssue }
        : null;

    const accent = pdfAccentOf(tenant.invoiceFormPrefs);
    const stamp = invoice.status === "paid" ? t.paid : invoice.status === "cancelled" ? t.cancelled : null;
    const variant = tenant.isDemo ? (tenant.classroomClassId ? "classroom" : "demo") : draft ? "draft" : null;
    const method = invoice.paymentMethodLabel || t.methods[invoice.paymentMethod];
    return {
      version: 1,
      info: { title: `${invoice.invoiceNumber}`, creator: credit ? BRAND_NAME : null },
      title: this.title(t, invoice, tenant),
      number: `${t.no} ${invoice.invoiceNumber}`,
      accent,
      tint: tintOf(accent),
      // A broken image must never block the invoice; the renderer skips one it cannot read.
      logo: tenant.logoData ? `data:application/octet-stream;base64,${tenant.logoData}` : null,
      stamp: stamp ? { text: stamp, color: invoice.status === "paid" ? "#059669" : "#dc2626" } : null,
      labels: {
        supplier: t.supplier,
        customer: t.customer,
        description: t.description,
        quantity: t.quantity,
        unitPrice: t.unitPrice,
        discount: t.discount,
        vat: t.vat,
        total: t.total,
        vatRecap: t.vatRecap,
        paidSoFar: t.paidSoFar,
        remaining: t.remaining,
      },
      ...this.parties(t, invoice, tenant, contact, lang, vars),
      rows: this.headerRows(t, invoice, tenant, contact, related, docVars.numbers, vars),
      noteAbove: invoice.noteAbove,
      vars,
      table: this.table(lineItems, invoice, showVat, lumpSum),
      totals: this.totals(t, totals, invoice, tenantHomeCurrencyOf(tenant), showVat),
      payment: {
        rows: this.bankRows(t, invoice, tenant, contact),
        qr: qrSlot,
        linkQr: linkQr ? { label: t.qrLink.toUpperCase(), png: pngDataUrl(linkQr) } : null,
      },
      notes: {
        reverseCharge: this.reverseChargeNote(t, invoice, tenant, contact),
        proforma: invoice.documentType === "proforma" ? t.proformaNote : null,
        paymentInstructions:
          invoice.documentType !== "quote" && invoice.paymentInstructions ? `${method}: ${fillTemplate(invoice.paymentInstructions, vars)}` : null,
        noteBelow: invoice.noteBelow,
        issuedBy: invoice.issuedByName ? `${t.issuedBy}: ${invoice.issuedByName}` : null,
      },
      credit: credit ? { text: `${credit.label} · ${siteUrl().replace(/^https?:\/\//, "")}`, url: credit.url } : null,
      watermark: variant ? { stamp: demoWatermarkText(lang, variant), footer: demoFooterText(lang, variant) } : null,
    };
  }

  /**
   * A plain A4 letter: a bold title and paragraphs separated by blank lines,
   * with the same font and footer credit as the invoices. The public payment
   * reminder generator uses it; the text is the visitor's, nothing is stored.
   */
  async generateLetter(input: { language: Lang; title: string; body: string }): Promise<Buffer> {
    // No company behind a public letter, so no referral code and no opt-out.
    const credit = {
      text: `${CREDIT_LABELS[input.language]} · ${siteUrl().replace(/^https?:\/\//, "")}`,
      url: brandCreditUrl(input.language, "pdf", null),
    };
    const pdf = await renderLetterPdf(PDFDocument, { title: input.title, body: input.body, creator: BRAND_NAME, credit }, FONTS);
    return Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  }

  /**
   * "QR Platba + Faktura": the SPAYD payment code with the invoice itself
   * embedded as QR Faktura (X-INV), so the customer's bank app pays it and
   * their accounting app imports it from the same scan. Without a payable
   * bank transfer the PDF still gets a standalone QR Faktura.
   *
   * Slovak payers get PAY by square instead (rule in paymentQrScheme). It
   * has no slot for QR Faktura, so that code only pays.
   *
   * Settings → Faktury can swap this for a link to the invoice's web page
   * (every way to pay is there) or keep only the payment code (PDF_QR_MODES).
   */
  private async buildQrCode(
    invoice: InvoiceRow,
    contact: ContactRow,
    tenant: TenantRow,
    totals: InvoiceVatBreakdown,
    payable: boolean,
    mode: PdfQrMode,
    lang: Lang,
  ): Promise<{ png: Buffer; kind: "spayd" | "pay_by_square" | "invoice" | "link" } | null> {
    if (mode === "link") {
      const png = await this.buildLinkQr(invoice, tenant, lang);
      return png ? { png, kind: "link" } : null;
    }
    // Same gate as the client-portal page (apps/frontend/app/[locale]/i/[token]/page.tsx):
    // prefer the stored IBAN, otherwise derive it from the domestic
    // account number + bank code, and omit the payment part when neither is on file.
    const iban = this.iban(tenant);
    // Without the date the customer's bank offers to pay today instead of on the due date. Banks
    // also read it from the QR Faktura inside the payment code, so that copy drops it too; a
    // QR Faktura on its own is for bookkeeping and keeps it.
    const dueDate = pdfQrDueDateOf(tenant.invoiceFormPrefs) ? (invoice.dueDate ?? undefined) : undefined;
    const sidWith = (sidDueDate: Date | undefined) =>
      invoice.invoiceNumber
      ? generateQrInvoiceString({
          invoiceNumber: invoice.invoiceNumber,
          issueDate: invoice.issueDate ?? new Date(),
          totalAmount: totals.totalWithVat,
          currency: invoice.currency,
          dueDate: sidDueDate,
          taxableSupplyDate: invoice.taxableSupplyDate ?? undefined,
          variableSymbol: invoice.variableSymbol ?? undefined,
          orderNumber: invoice.orderNumber ?? undefined,
          supplierIco: tenant.ico ?? undefined,
          supplierDic: tenant.dic ?? undefined,
          customerIco: contact.ico ?? undefined,
          customerDic: contact.dic ?? undefined,
          vatLines: tenant.dicVatPayer
            ? totals.byRate.map((r) => ({ rate: r.vatRatePercent, base: r.totalWithoutVat, vat: r.vatAmount }))
            : [],
          documentType: invoice.documentType === "proforma" ? 0 : invoice.documentType === "credit_note" ? 1 : undefined,
          advance: invoice.documentType === "proforma",
          reverseCharge: invoice.reverseCharge,
          iban: iban ?? undefined,
          exchangeRate: invoice.exchangeRate ? Number(invoice.exchangeRate) : undefined,
          software: brandCreditFor(tenant, "cs", "pdf") ? BRAND_NAME : undefined,
        })
      : null;
    const sid = sidWith(invoice.dueDate ?? undefined);

    // After a partial payment the QR asks only for what is left; a paid document
    // gets no payment code at all (it used to ask for the full amount again).
    const amount =
      invoice.status === "paid" ? 0 : Math.max(0, Math.round((totals.totalWithVat - Number(invoice.amountPaid ?? 0)) * 100) / 100);
    if (payable && amount > 0 && iban && invoice.paymentMethod === "bank_transfer") {
      const scheme = paymentQrScheme({ payeeIban: iban, currency: invoice.currency, buyerCountry: contact.addressCountry });
      const bysquare = scheme === "pay_by_square" ? this.payBySquare(invoice, tenant, iban, amount, dueDate) : null;
      if (bysquare) {
        return { png: await QRCode.toBuffer(bysquare, { type: "png", margin: 1, width: 280, errorCorrectionLevel: "M" }), kind: "pay_by_square" };
      }
      const spayd = generateSpaydString({
        iban,
        amount,
        currency: invoice.currency,
        variableSymbol: invoice.variableSymbol ?? undefined,
        dueDate,
        message: invoice.invoiceNumber ?? undefined,
        invoice: sid ? qrInvoiceForSpayd(sidWith(dueDate)!) : undefined,
      });
      return { png: await QRCode.toBuffer(spayd, { type: "png", margin: 1, width: 280, errorCorrectionLevel: "M" }), kind: "spayd" };
    }
    if (!sid || mode === "payment_only") return null;
    return { png: await QRCode.toBuffer(sid, { type: "png", margin: 1, width: 280, errorCorrectionLevel: "M" }), kind: "invoice" };
  }

  /** A code that opens the invoice's web page; a draft has no working page yet. */
  private async buildLinkQr(invoice: InvoiceRow, tenant: TenantRow, lang: Lang): Promise<Buffer | null> {
    if (!invoice.invoiceNumber || !invoice.publicToken) return null;
    const url = `${siteUrl()}/${lang}/i/${invoiceLinkOf(tenant, invoice)}`;
    return QRCode.toBuffer(url, { type: "png", margin: 1, width: 280, errorCorrectionLevel: "M" });
  }

  /**
   * PAY by square validates the IBAN and BIC, SPAYD does not. A bad account
   * on file must not break the whole PDF, so the caller falls back to SPAYD.
   */
  private payBySquare(invoice: InvoiceRow, tenant: TenantRow, iban: string, amount: number, dueDate: Date | undefined): string | null {
    try {
      return generatePayBySquareString({
        iban,
        bic: tenant.bankAccountSwift ?? undefined,
        amount,
        currency: invoice.currency,
        variableSymbol: invoice.variableSymbol ?? undefined,
        dueDate,
        message: invoice.invoiceNumber ?? undefined,
        invoiceId: invoice.invoiceNumber ?? undefined,
        beneficiaryName: tenant.legalName,
        beneficiaryStreet: tenant.addressStreet ?? undefined,
        beneficiaryCity: tenant.addressCity ?? undefined,
      });
    } catch (error) {
      this.logger.warn(`PAY by square failed for invoice ${invoice.id}, using SPAYD: ${(error as Error).message}`);
      return null;
    }
  }

  private iban(tenant: TenantRow): string | null {
    return (
      tenant.bankAccountIban ??
      (tenant.bankAccountNumber ? czechAccountToIban(tenant.bankAccountNumber, tenant.bankAccountBankCode) : null)
    );
  }

  private title(t: (typeof L)[Lang], invoice: InvoiceRow, tenant: TenantRow): string {
    if (invoice.documentType === "invoice") return tenant.dicVatPayer ? t.invoice : t.invoiceNonVat;
    return t[invoice.documentType];
  }

  private parties(
    t: (typeof L)[Lang],
    invoice: InvoiceRow,
    tenant: TenantRow,
    contact: ContactRow,
    lang: Lang,
    vars: Record<string, string>,
  ): Pick<InvoicePdfModel, "supplier" | "customer"> {
    const address = (street: string | null, city: string | null, postalCode: string | null) => [
      ...(street ? [{ text: street }] : []),
      ...(city || postalCode ? [{ text: `${postalCode ?? ""} ${city ?? ""}`.trim() }] : []),
    ];
    // Once the buyer's country is printed, the seller's is too, so a foreign reader sees both sides.
    const buyerCountry = contact.addressCountry?.toUpperCase();
    const sellerCountry = tenantCountry(tenant);
    const foreignBuyer = !!buyerCountry && buyerCountry !== sellerCountry;
    // A Czech DIČ reads as "VAT payer" to most accountants, so a non-payer prints it only for a buyer
    // abroad, where an EU reverse charge needs it. A Slovak DIČ is the
    // income tax number, distinct from the IČ DPH, so it stays.
    const ownDic = tenant.dicVatPayer || sellerCountry !== "CZ" || foreignBuyer;
    const supplier = [
      ...address(tenant.addressStreet, tenant.addressCity, displayPostalCode(tenant.addressPostalCode, sellerCountry)),
      ...(foreignBuyer ? [{ text: countryName(sellerCountry, lang) }] : []),
      ...(tenant.ico ? [{ text: `${t.ico}: ${tenant.ico}` }] : []),
      ...(tenant.dic && ownDic ? [{ text: `${t.dic}: ${tenant.dic}` }] : []),
      ...(!tenant.dicVatPayer ? [{ text: t.nonVatPayer }] : []),
      // The trade or commercial register entry describes the seller, so it sits with the seller.
      ...(tenant.registryNote ? [{ text: fillTemplate(tenant.registryNote, vars), width: 240 }] : []),
      ...(tenant.email ? [{ text: tenant.email }] : []),
      ...(tenant.phone ? [{ text: tenant.phone }] : []),
    ];
    const customer = [
      ...address(contact.addressStreet, contact.addressCity, displayPostalCode(contact.addressPostalCode, contact.addressCountry)),
      // A buyer abroad gets the country, in the document language.
      ...(foreignBuyer && buyerCountry ? [{ text: countryName(buyerCountry, lang) }] : []),
      ...(contact.ico ? [{ text: `${t.ico}: ${contact.ico}` }] : []),
      ...(contact.dic ? [{ text: `${t.dic}: ${contact.dic}` }] : []),
      ...(invoice.buyerContactPerson ? [{ text: `${t.contactPerson}: ${invoice.buyerContactPerson}`, width: 240 }] : []),
    ];
    return { supplier: { name: tenant.legalName, lines: supplier }, customer: { name: contact.legalName, lines: customer } };
  }

  /** Dates (left) and payment details (right) under the parties. */
  private headerRows(
    t: (typeof L)[Lang],
    invoice: InvoiceRow,
    tenant: TenantRow,
    contact: ContactRow,
    related: RelatedDocument,
    numbers: Record<string, number>,
    vars: Record<string, string>,
  ): InvoicePdfModel["rows"] {
    const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("cs-CZ") : "–");
    const left: Array<[string, string]> = [[t.issueDate, fmt(invoice.issueDate)]];
    // DUZP belongs on tax documents only (§29 ZDPH); a non-payer's invoice is
    // not one, and printing the date there only raises questions.
    const taxDocument = invoice.documentType === "invoice" || invoice.documentType === "credit_note";
    // An identified person's domestic invoice is not a tax document either; only the EU reverse
    // charge one is.
    if (taxDocument && (tenant.dicVatPayer || (tenant.vatStatus === "identified" && !!reverseChargeNoteKind(invoice, tenant, contact)))) {
      left.push([t.taxableSupplyDate, fmt(invoice.taxableSupplyDate ?? invoice.issueDate)]);
    }
    if (invoice.dueDate) left.push([invoice.documentType === "quote" ? t.validUntil : t.dueDate, fmt(invoice.dueDate)]);
    if (invoice.orderNumber) left.push([t.order, invoice.orderNumber]);
    if (invoice.issuePlace) left.push([t.issuePlace, invoice.issuePlace]);
    for (const field of invoice.customFields ?? []) {
      if (field.internal) continue; // team-only note
      left.push([field.label, displayCustomField(field, numbers, (n) => this.formatAmount(n, invoice.currency), (s) => fillTemplate(s, vars))]);
    }
    if (related?.invoiceNumber) left.push([t.related, related.invoiceNumber]);

    const right: Array<[string, string]> = [];
    if (invoice.documentType !== "quote") {
      right.push([t.paymentMethod, invoice.paymentMethodLabel || t.methods[invoice.paymentMethod]]);
      if (invoice.variableSymbol) right.push([t.vs, invoice.variableSymbol]);
      if (invoice.constantSymbol) right.push([t.ks, invoice.constantSymbol]);
      if (invoice.specificSymbol) right.push([t.ss, invoice.specificSymbol]);
    }
    return { left, right };
  }

  private table(lineItems: LineItemRow[], invoice: InvoiceRow, showVat: boolean, lumpSum: boolean): InvoicePdfModel["table"] {
    const currency = invoice.currency;
    return {
      showVat,
      lumpSum,
      hasDiscount: lineItems.some((i) => Number(i.discountPercent) !== 0),
      items: lineItems.map((item) => ({
        description: item.description,
        code: item.code ?? null,
        quantity: `${this.formatNumber(Number(item.quantity))}${item.unit ? ` ${item.unit}` : ""}`,
        unitPrice: this.formatAmount(Number(item.unitPrice), currency),
        discount: Number(item.discountPercent) ? `${this.formatNumber(Number(item.discountPercent))}%` : "",
        vatRate: `${invoice.reverseCharge ? 0 : item.vatRate != null ? Number(item.vatRate) : 0}%`,
        total: this.formatAmount(lineBase(item), currency),
      })),
    };
  }

  private totals(t: (typeof L)[Lang], totals: InvoiceVatBreakdown, invoice: InvoiceRow, home: HomeCurrency, showVat: boolean): InvoicePdfModel["totals"] {
    const currency = invoice.currency;
    // Paid or partly paid: "Celkem", then what was paid and what is left (0 once
    // settled), so a paid invoice no longer reads "Celkem k úhradě" with the full sum.
    const paid = invoice.documentType === "quote" ? 0 : invoice.status === "paid" ? totals.totalWithVat : Number(invoice.amountPaid ?? 0);
    const label = invoice.documentType === "quote" ? t.totalQuote : paid > 0 || !asksForPayment(invoice, totals) ? t.total : t.totalToPay;
    // §29 ZDPH / § 74 ods. 1 písm. i SK: a foreign-currency tax document
    // states the VAT in the home currency too (CZK, or EUR for SK).
    // The label follows the mode stored at issue; "none" (non-payers only,
    // see exchange-rate-mode.ts) prints no conversion.
    const rate = invoice.exchangeRate ? Number(invoice.exchangeRate) : null;
    const rateLabel = rateLineLabel(t, invoice, invoice.taxableSupplyDate ?? invoice.issueDate ?? null);
    let fx: string[] | null = null;
    if (currency !== home && rate && rateLabel) {
      // ECB rates are quoted as units per euro, so a Slovak document shows
      // them that way round (25,2 CZK/EUR) rather than 0,0397 EUR/CZK.
      const perEuro = home === "EUR";
      const rateText = (perEuro ? 1 / rate : rate).toLocaleString("cs-CZ", { maximumFractionDigits: 4 });
      fx = [
        `${rateLabel} ${rateText} ${perEuro ? `${currency}/${home}` : `${home}/${currency}`}`,
        `${t.vatInHome.replaceAll("{currency}", home)} ${this.formatAmount(totals.totalVat * rate, home)}`,
        `${t.totalInHome.replaceAll("{currency}", home)} ${this.formatAmount(totals.totalWithVat * rate, home)}`,
      ];
    }
    return {
      showVat,
      byRate: showVat
        ? totals.byRate.map((entry) => ({
            base: `${t.base} ${entry.vatRatePercent}%`,
            amount: this.formatAmount(entry.totalWithoutVat, currency),
            vat: `${t.vat} ${this.formatAmount(entry.vatAmount, currency)}`,
          }))
        : [],
      label,
      amount: this.formatAmount(totals.totalWithVat, currency),
      paid:
        paid > 0
          ? { amount: `−${this.formatAmount(paid, currency)}`, remaining: this.formatAmount(Math.round((totals.totalWithVat - paid) * 100) / 100, currency) }
          : null,
      fx,
    };
  }

  /** Account, IBAN and SWIFT of a bank transfer: they go next to the QR code that pays into them. */
  private bankRows(t: (typeof L)[Lang], invoice: InvoiceRow, tenant: TenantRow, contact: ContactRow): Array<[string, string]> {
    if (invoice.documentType === "quote" || invoice.paymentMethod !== "bank_transfer") return [];
    const rows: Array<[string, string]> = [];
    if (tenant.bankAccountNumber) rows.push([t.account, `${tenant.bankAccountNumber}/${tenant.bankAccountBankCode ?? ""}`]);
    // A domestic payment in the home currency only needs the local account
    // number; IBAN and SWIFT are for payers abroad or in another currency.
    const buyerCountry = contact.addressCountry?.toUpperCase();
    const domestic = invoice.currency === tenantHomeCurrencyOf(tenant) && (!buyerCountry || buyerCountry === tenantCountry(tenant));
    if (domestic && rows.length) return rows;
    const iban = this.iban(tenant);
    if (iban) rows.push(["IBAN", iban]);
    if (tenant.bankAccountSwift) rows.push(["SWIFT", tenant.bankAccountSwift]);
    return rows;
  }

  /**
   * "Daň odvede zákazník": a service to a business in another EU state (§29/2c
   * ZDPH) – also from an identified person, who never ticks reverse charge
   * because it charges no VAT; otherwise the domestic reverse-charge note.
   */
  private reverseChargeNote(t: (typeof L)[Lang], invoice: InvoiceRow, tenant: TenantRow, contact?: ContactRow): string | null {
    const kind = reverseChargeNoteKind(invoice, tenant, contact);
    return kind === "eu" ? t.reverseChargeEu : kind === "domestic" ? t.reverseCharge : null;
  }

  private formatNumber(n: number): string {
    return n.toLocaleString("cs-CZ", { maximumFractionDigits: 3 });
  }

  private formatAmount(amount: number, currency: string): string {
    return `${amount.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}
