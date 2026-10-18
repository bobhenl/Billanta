import { fillTemplate } from "../tenants/email-prefs";
import { templateValues, templateVarsOf } from "../tenants/template-vars";
import { displayCustomField, documentVars } from "./custom-fields";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import {
  czechAccountToIban,
  homeCurrencyOf,
  generateQrInvoiceString,
  generateSpaydString,
  isEuReverseChargeService,
  paymentQrScheme,
  qrInvoiceForSpayd,
  type HomeCurrency,
} from "@faktur/cz-compliance";
import { generatePayBySquareString } from "@faktur/cz-compliance/pay-by-square";
import PDFDocument from "pdfkit";
import { drawDemoWatermark } from "./invoice-pdf-demo";
import QRCode from "qrcode";
import * as schema from "../../drizzle/schema";
import { lineBase, type InvoiceVatBreakdown } from "./invoice-total.util";
import { pdfAccentOf, pdfSecondLanguageOf, tintOf } from "../tenants/invoice-form-prefs";
import { rateLineLabel } from "./exchange-rate-mode";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;
type TenantRow = typeof schema.tenants.$inferSelect;

/**
 * Which reverse-charge note the document prints: "eu" for a service to a
 * business in another EU state (from a payer with reverse charge ticked, or
 * from an identified person, who charges no VAT and so never ticks it),
 * "domestic" for the §92a note, else none.
 */
export function reverseChargeNoteKind(
  invoice: Pick<InvoiceRow, "documentType" | "reverseCharge">,
  tenant: Pick<TenantRow, "vatStatus" | "addressCountry">,
  contact?: Pick<ContactRow, "ico" | "dic" | "isPerson" | "addressCountry">,
): "eu" | "domestic" | null {
  const taxDocument = invoice.documentType === "invoice" || invoice.documentType === "credit_note";
  const customer = contact
    ? { ico: contact.ico ?? undefined, dic: contact.dic ?? undefined, isPerson: contact.isPerson, address: { countryCode: contact.addressCountry } }
    : undefined;
  const euService = taxDocument && isEuReverseChargeService(tenant.vatStatus, tenant.addressCountry, customer);
  if (euService && (invoice.reverseCharge || tenant.vatStatus === "identified")) return "eu";
  return invoice.reverseCharge ? "domestic" : null;
}

/**
 * Whether a note already says the customer pays the VAT. Invoices imported
 * from BitFaktura carry "Daň odvede zákazník … / Reverse charge" in their own
 * note, and printing our line on top of it showed the same thing twice.
 */
export function mentionsReverseCharge(note: string | null | undefined): boolean {
  if (!note) return false;
  const text = note.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /dan odvede zakaznik|prenesen\w* danov|reverse[ -]?charge/.test(text);
}
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
const FONTS = resolveFonts();
const REGULAR = FONTS ? "Body" : "Helvetica";
const BOLD = FONTS ? "Body-Bold" : "Helvetica-Bold";

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

const MUTED = "#6b7280";

type Labels = (typeof L)[Lang];
/** Joins two label sets for a bilingual PDF; the renderer splits on it where space is tight. */
export const BILINGUAL_SEPARATOR = " / ";

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

/** Puts each language on its own line (narrow table headers, the total box). */
const stacked = (label: string) => label.replace(BILINGUAL_SEPARATOR, "\n");

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
    if (!invoice.invoiceNumber) {
      throw new Error("InvoicePdfService.generate: invoice has no invoiceNumber — has it been issued?");
    }
    const lang: Lang = invoice.language === "sk" || invoice.language === "en" ? invoice.language : "cs";
    const second = pdfSecondLanguageOf(tenant.invoiceFormPrefs);
    const t = second && second !== lang ? bilingualLabels(L[lang], L[second]) : L[lang];

    const payable = invoice.documentType !== "quote" && totals.totalWithVat > 0;
    // A demo's fictional bank account must not end up in anyone's banking app.
    const qr = invoice.documentType !== "quote" && !tenant.isDemo ? await this.buildQrCode(invoice, contact, tenant, totals, payable) : null;

    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, info: { Title: `${invoice.invoiceNumber}`, Creator: "Billanta" } });
    if (FONTS) {
      doc.registerFont(REGULAR, FONTS.regular);
      doc.registerFont(BOLD, FONTS.bold);
    }
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    // Settings → Proměnné: `{vs}`, `{due_date}`, the company's own `{…}` in the notes.
    const docVars = documentVars(invoice.customFields, totals, invoice.amountPaid, templateVarsOf(tenant.templateVars), (n) => `${this.formatNumber(n)} ${invoice.currency}`);
    const vars = { ...templateValues(tenant, invoice, contact), ...docVars.formatted };
    const fill = (text: string | null) => (text ? fillTemplate(text, vars) : text);
    this.renderHeader(doc, t, invoice, tenant, contact, related, docVars.numbers, vars);
    if (invoice.noteAbove) {
      doc.font(REGULAR).fontSize(9).fillColor("black").text(fill(invoice.noteAbove) ?? "", 50, doc.y, { width: 500 });
      doc.moveDown(0.8);
    }
    this.renderLineItemsTable(doc, t, lineItems, invoice);
    const totalsTop = this.renderTotals(doc, t, totals, invoice, pdfAccentOf(tenant.invoiceFormPrefs), homeCurrencyOf(tenant.addressCountry));
    // The brand name is written exactly so ("PAY by square"), never uppercased.
    if (qr) this.renderPaymentQr(doc, qr.kind === "pay_by_square" ? t.qrPayBySquare : (qr.kind === "spayd" ? t.qr : t.qrInvoice).toUpperCase(), qr.png, totalsTop);
    this.renderFooterNotes(doc, t, invoice, tenant, fill, contact);
    this.renderCredit(doc, lang);
    if (tenant.isDemo) drawDemoWatermark(doc, lang, REGULAR);

    doc.end();
    return finished;
  }

  /**
   * "QR Platba + Faktura": the SPAYD payment code with the invoice itself
   * embedded as QR Faktura (X-INV), so the customer's bank app pays it and
   * their accounting app imports it from the same scan. Without a payable
   * bank transfer the PDF still gets a standalone QR Faktura.
   *
   * Slovak payers get PAY by square instead (rule in paymentQrScheme). It
   * has no slot for QR Faktura, so that code only pays.
   */
  private async buildQrCode(
    invoice: InvoiceRow,
    contact: ContactRow,
    tenant: TenantRow,
    totals: InvoiceVatBreakdown,
    payable: boolean,
  ): Promise<{ png: Buffer; kind: "spayd" | "pay_by_square" | "invoice" } | null> {
    // Same gate as the client-portal page (apps/frontend/app/[locale]/i/[token]/page.tsx):
    // prefer the stored IBAN, otherwise derive it from the domestic
    // account number + bank code, and omit the payment part when neither is on file.
    const iban = this.iban(tenant);
    const sid = invoice.invoiceNumber
      ? generateQrInvoiceString({
          invoiceNumber: invoice.invoiceNumber,
          issueDate: invoice.issueDate ?? new Date(),
          totalAmount: totals.totalWithVat,
          currency: invoice.currency,
          dueDate: invoice.dueDate ?? undefined,
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
          software: "Billanta",
        })
      : null;

    if (payable && iban && invoice.paymentMethod === "bank_transfer") {
      // After a partial payment the QR asks only for what is left.
      const amount =
        Math.max(0, Math.round((totals.totalWithVat - Number(invoice.amountPaid ?? 0)) * 100) / 100) || totals.totalWithVat;
      const scheme = paymentQrScheme({ payeeIban: iban, currency: invoice.currency, buyerCountry: contact.addressCountry });
      const bysquare = scheme === "pay_by_square" ? this.payBySquare(invoice, tenant, iban, amount) : null;
      if (bysquare) {
        return { png: await QRCode.toBuffer(bysquare, { type: "png", margin: 1, width: 280, errorCorrectionLevel: "M" }), kind: "pay_by_square" };
      }
      const spayd = generateSpaydString({
        iban,
        amount,
        currency: invoice.currency,
        variableSymbol: invoice.variableSymbol ?? undefined,
        dueDate: invoice.dueDate ?? undefined,
        message: invoice.invoiceNumber ?? undefined,
        invoice: sid ? qrInvoiceForSpayd(sid) : undefined,
      });
      return { png: await QRCode.toBuffer(spayd, { type: "png", margin: 1, width: 280, errorCorrectionLevel: "M" }), kind: "spayd" };
    }
    if (!sid) return null;
    return { png: await QRCode.toBuffer(sid, { type: "png", margin: 1, width: 280, errorCorrectionLevel: "M" }), kind: "invoice" };
  }

  /**
   * PAY by square validates the IBAN and BIC, SPAYD does not. A bad account
   * on file must not break the whole PDF, so the caller falls back to SPAYD.
   */
  private payBySquare(invoice: InvoiceRow, tenant: TenantRow, iban: string, amount: number): string | null {
    try {
      return generatePayBySquareString({
        iban,
        bic: tenant.bankAccountSwift ?? undefined,
        amount,
        currency: invoice.currency,
        variableSymbol: invoice.variableSymbol ?? undefined,
        dueDate: invoice.dueDate ?? undefined,
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

  private renderHeader(
    doc: PDFKit.PDFDocument,
    t: (typeof L)[Lang],
    invoice: InvoiceRow,
    tenant: TenantRow,
    contact: ContactRow,
    related: RelatedDocument,
    numbers: Record<string, number>,
    vars: Record<string, string>,
  ): void {
    doc.font(BOLD).fontSize(18).fillColor(pdfAccentOf(tenant.invoiceFormPrefs)).text(this.title(t, invoice, tenant), 50, 50);
    doc.font(REGULAR).fontSize(11).fillColor("black").text(`${t.no} ${invoice.invoiceNumber}`, 50, doc.y + 2);

    // Company logo, top right (idea from faktorio, MIT © Jiri Spac). A broken
    // image must never block the invoice, so failures just skip it.
    let hasLogo = false;
    if (tenant.logoData) {
      try {
        doc.image(Buffer.from(tenant.logoData, "base64"), 395, 40, { fit: [150, 50], align: "right" });
        hasLogo = true;
      } catch {
        hasLogo = false;
      }
    }

    const stamp = invoice.status === "paid" ? t.paid : invoice.status === "cancelled" ? t.cancelled : null;
    if (stamp) {
      doc
        .font(BOLD)
        .fontSize(14)
        .fillColor(invoice.status === "paid" ? "#059669" : "#dc2626")
        .text(stamp, 350, hasLogo ? 88 : 56, { width: 200, align: "right" });
    }

    const startY = 105;
    const right = 310;

    doc.font(BOLD).fontSize(8).fillColor(MUTED).text(t.supplier.toUpperCase(), 50, startY);
    doc.font(BOLD).fontSize(10).fillColor("black").text(tenant.legalName, 50, doc.y + 2, { width: 240 });
    doc.font(REGULAR).fontSize(9);
    this.renderAddressLines(doc, tenant.addressStreet, tenant.addressCity, tenant.addressPostalCode, 50);
    if (tenant.ico) doc.text(`${t.ico}: ${tenant.ico}`, 50);
    if (tenant.dic) doc.text(`${t.dic}: ${tenant.dic}`, 50);
    if (!tenant.dicVatPayer) doc.text(t.nonVatPayer, 50);
    if (tenant.email) doc.text(tenant.email, 50);
    if (tenant.phone) doc.text(tenant.phone, 50);
    const leftEnd = doc.y;

    doc.font(BOLD).fontSize(8).fillColor(MUTED).text(t.customer.toUpperCase(), right, startY);
    doc.font(BOLD).fontSize(10).fillColor("black").text(contact.legalName, right, doc.y + 2, { width: 240 });
    doc.font(REGULAR).fontSize(9);
    this.renderAddressLines(doc, contact.addressStreet, contact.addressCity, contact.addressPostalCode, right);
    if (contact.ico) doc.text(`${t.ico}: ${contact.ico}`, right);
    if (contact.dic) doc.text(`${t.dic}: ${contact.dic}`, right);
    if (invoice.buyerContactPerson) doc.text(`${t.contactPerson}: ${invoice.buyerContactPerson}`, right, doc.y, { width: 240 });
    const rightEnd = doc.y;

    // Dates (left) and payment details (right).
    let y = Math.max(leftEnd, rightEnd) + 18;
    doc.moveTo(50, y - 8).lineTo(545, y - 8).strokeColor("#e5e7eb").stroke();
    const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString("cs-CZ") : "–");
    const left: Array<[string, string]> = [[t.issueDate, fmt(invoice.issueDate)]];
    if (invoice.documentType === "invoice" || invoice.documentType === "credit_note") {
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

    const rightRows: Array<[string, string]> = [];
    if (invoice.documentType !== "quote") {
      rightRows.push([t.paymentMethod, invoice.paymentMethodLabel || t.methods[invoice.paymentMethod]]);
      if (invoice.paymentMethod === "bank_transfer") {
        if (tenant.bankAccountNumber) {
          rightRows.push([t.account, `${tenant.bankAccountNumber}/${tenant.bankAccountBankCode ?? ""}`]);
        }
        const iban = this.iban(tenant);
        if (iban) rightRows.push(["IBAN", iban]);
        if (tenant.bankAccountSwift) rightRows.push(["SWIFT", tenant.bankAccountSwift]);
      }
      if (invoice.variableSymbol) rightRows.push([t.vs, invoice.variableSymbol]);
      if (invoice.constantSymbol) rightRows.push([t.ks, invoice.constantSymbol]);
      if (invoice.specificSymbol) rightRows.push([t.ss, invoice.specificSymbol]);
    }

    const rows = Math.max(left.length, rightRows.length);
    for (let i = 0; i < rows; i++) {
      // A long IBAN or custom-field value wraps, so the row grows to its tallest cell.
      let height = 14;
      for (const [x, row] of [
        [50, left[i]],
        [right, rightRows[i]],
      ] as const) {
        if (!row) continue;
        doc.font(REGULAR).fontSize(9).fillColor(MUTED).text(row[0], x, y, { width: 105 });
        const labelHeight = doc.heightOfString(row[0], { width: 105 });
        doc.font(BOLD).fillColor("black").text(row[1], x + 105, y, { width: 135 });
        height = Math.max(height, labelHeight + 3, doc.heightOfString(row[1], { width: 135 }) + 3);
      }
      y += height;
    }
    doc.y = y + 12;
    doc.x = 50;
  }

  private renderAddressLines(
    doc: PDFKit.PDFDocument,
    street: string | null,
    city: string | null,
    postalCode: string | null,
    x: number,
  ): void {
    if (street) doc.text(street, x);
    if (city || postalCode) doc.text(`${postalCode ?? ""} ${city ?? ""}`.trim(), x);
  }

  private renderLineItemsTable(
    doc: PDFKit.PDFDocument,
    t: (typeof L)[Lang],
    lineItems: LineItemRow[],
    invoice: InvoiceRow,
  ): void {
    const currency = invoice.currency;
    const hasDiscount = lineItems.some((i) => Number(i.discountPercent) !== 0);
    const columns = {
      description: { x: 50, width: hasDiscount ? 185 : 225 },
      quantity: { x: hasDiscount ? 235 : 275, width: 60 },
      unitPrice: { x: hasDiscount ? 300 : 335, width: hasDiscount ? 75 : 80 },
      discount: { x: 375, width: 40 },
      vatRate: { x: 415, width: 40 },
      lineTotal: { x: 455, width: 90 },
    };

    // Bilingual labels go on two lines, so the header band grows.
    const twoLine = t.description.includes(BILINGUAL_SEPARATOR);
    const header = (top: number) => {
      doc.rect(50, top - 4, 495, twoLine ? 27 : 18).fill("#f3f4f6");
      doc.font(BOLD).fontSize(8).fillColor(MUTED);
      doc.text(stacked(t.description), columns.description.x + 4, top);
      doc.text(stacked(t.quantity), columns.quantity.x, top, { width: columns.quantity.width, align: "right" });
      doc.text(stacked(t.unitPrice), columns.unitPrice.x, top, { width: columns.unitPrice.width, align: "right" });
      if (hasDiscount) doc.text(stacked(t.discount), columns.discount.x, top, { width: columns.discount.width, align: "right" });
      doc.text(stacked(t.vat), columns.vatRate.x, top, { width: columns.vatRate.width, align: "right" });
      doc.text(stacked(t.total), columns.lineTotal.x, top, { width: columns.lineTotal.width - 4, align: "right" });
      return top + (twoLine ? 29 : 20);
    };

    let y = header(doc.y + 4);
    doc.font(REGULAR).fontSize(9).fillColor("black");
    for (const item of lineItems) {
      const descHeight =
        doc.heightOfString(item.description, { width: columns.description.width - 4 }) + (item.code ? 10 : 0);
      if (y + descHeight > 760) {
        doc.addPage();
        y = header(60);
        doc.font(REGULAR).fontSize(9).fillColor("black");
      }
      const quantity = Number(item.quantity);
      const vatRatePercent = invoice.reverseCharge ? 0 : item.vatRate != null ? Number(item.vatRate) : 0;

      doc.text(item.description, columns.description.x + 4, y, { width: columns.description.width - 4 });
      if (item.code) {
        doc
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(item.code, columns.description.x + 4, doc.y, { width: columns.description.width - 4 });
        doc.fontSize(9).fillColor("black");
      }
      doc.text(`${this.formatNumber(quantity)}${item.unit ? ` ${item.unit}` : ""}`, columns.quantity.x, y, {
        width: columns.quantity.width,
        align: "right",
      });
      doc.text(this.formatAmount(Number(item.unitPrice), currency), columns.unitPrice.x, y, {
        width: columns.unitPrice.width,
        align: "right",
      });
      if (hasDiscount) {
        doc.text(Number(item.discountPercent) ? `${this.formatNumber(Number(item.discountPercent))}%` : "", columns.discount.x, y, {
          width: columns.discount.width,
          align: "right",
        });
      }
      doc.text(`${vatRatePercent}%`, columns.vatRate.x, y, { width: columns.vatRate.width, align: "right" });
      doc.text(this.formatAmount(lineBase(item), currency), columns.lineTotal.x, y, {
        width: columns.lineTotal.width - 4,
        align: "right",
      });
      y += Math.max(descHeight, 11) + 7;
      doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor("#f3f4f6").stroke();
    }
    doc.y = y + 6;
  }

  private renderTotals(
    doc: PDFKit.PDFDocument,
    t: (typeof L)[Lang],
    totals: InvoiceVatBreakdown,
    invoice: InvoiceRow,
    accent: string,
    home: HomeCurrency,
  ): number {
    const currency = invoice.currency;
    if (doc.y > 650) doc.addPage();
    const x = 300;
    let y = doc.y;
    const top = y;
    doc.font(BOLD).fontSize(8).fillColor(MUTED).text(t.vatRecap.toUpperCase(), x, y);
    y += 14;
    doc.font(REGULAR).fontSize(9).fillColor("black");
    for (const entry of totals.byRate) {
      // Bilingual labels can wrap, so each row grows to its tallest cell.
      const cells: Array<[string, number, number, "left" | "right"]> = [
        [`${t.base} ${entry.vatRatePercent}%`, x, 80, "left"],
        [this.formatAmount(entry.totalWithoutVat, currency), x + 80, 80, "right"],
        [`${t.vat} ${this.formatAmount(entry.vatAmount, currency)}`, x + 160, 85, "right"],
      ];
      let height = 13;
      for (const [text, cx, width, align] of cells) {
        doc.text(text, cx, y, { width, align });
        height = Math.max(height, doc.heightOfString(text, { width }) + 2);
      }
      y += height;
    }
    y += 6;
    doc.rect(x, y - 4, 245, 26).fill(tintOf(accent));
    const totalLabel = invoice.documentType === "quote" ? t.totalQuote : t.totalToPay;
    const bilingual = totalLabel.includes(BILINGUAL_SEPARATOR);
    doc
      .font(BOLD)
      .fontSize(bilingual ? 8.5 : 12)
      .fillColor(accent)
      .text(stacked(totalLabel), x + 8, bilingual ? y - 1 : y + 3, { width: 120 });
    doc.fontSize(12).text(this.formatAmount(totals.totalWithVat, currency), x + 110, y + 3, { width: 127, align: "right" });
    doc.fillColor("black");
    y += 34;
    // Partial payment (deposit received): state what is paid and what is left.
    const paid = Number(invoice.amountPaid ?? 0);
    if (paid > 0 && invoice.documentType !== "quote" && paid < totals.totalWithVat) {
      doc.font(REGULAR).fontSize(9).fillColor("black");
      doc.text(stacked(t.paidSoFar), x + 8, y, { width: 120 });
      doc.text(`−${this.formatAmount(paid, currency)}`, x + 110, y, { width: 127, align: "right" });
      y += t.paidSoFar.includes(BILINGUAL_SEPARATOR) ? 22 : 14;
      doc.font(BOLD).fillColor(accent);
      doc.text(stacked(t.remaining), x + 8, y, { width: 120 });
      doc.text(this.formatAmount(Math.round((totals.totalWithVat - paid) * 100) / 100, currency), x + 110, y, { width: 127, align: "right" });
      doc.fillColor("black");
      y += t.remaining.includes(BILINGUAL_SEPARATOR) ? 26 : 18;
    }
    // §29 ZDPH / § 74 ods. 1 písm. i SK: a foreign-currency tax document
    // states the VAT in the home currency too (CZK, or EUR for SK).
    // The label follows the mode stored at issue; "none" (non-payers only,
    // see exchange-rate-mode.ts) prints no conversion.
    const rate = invoice.exchangeRate ? Number(invoice.exchangeRate) : null;
    const rateLabel = rateLineLabel(t, invoice, invoice.taxableSupplyDate ?? invoice.issueDate ?? null);
    if (currency !== home && rate && rateLabel) {
      doc.font(REGULAR).fontSize(8.5).fillColor(MUTED);
      // ECB rates are quoted as units per euro, so a Slovak document shows
      // them that way round (25,2 CZK/EUR) rather than 0,0397 EUR/CZK.
      const perEuro = home === "EUR";
      const rateText = (perEuro ? 1 / rate : rate).toLocaleString("cs-CZ", { maximumFractionDigits: 4 });
      doc.text(`${rateLabel} ${rateText} ${perEuro ? `${currency}/${home}` : `${home}/${currency}`}`, x, y, { width: 245 });
      y += 12;
      doc.text(`${t.vatInHome.replaceAll("{currency}", home)} ${this.formatAmount(totals.totalVat * rate, home)}`, x, y, { width: 245 });
      y += 12;
      doc.text(`${t.totalInHome.replaceAll("{currency}", home)} ${this.formatAmount(totals.totalWithVat * rate, home)}`, x, y, { width: 245 });
      y += 16;
      doc.fillColor("black");
    }
    doc.y = y;
    doc.x = 50;
    return top;
  }

  /** Sits to the left of the totals block, level with its top (`top`). */
  private renderPaymentQr(doc: PDFKit.PDFDocument, label: string, qrPngBuffer: Buffer, top: number): void {
    doc.font(BOLD).fontSize(8).fillColor(MUTED).text(label, 50, top);
    doc.image(qrPngBuffer, 50, top + 12, { width: 100, height: 100 });
    doc.fillColor("black");
    doc.y = Math.max(doc.y, top + 120);
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

  private renderFooterNotes(
    doc: PDFKit.PDFDocument,
    t: (typeof L)[Lang],
    invoice: InvoiceRow,
    tenant: TenantRow,
    fill: (text: string | null) => string | null,
    contact?: ContactRow,
  ): void {
    const notes = [
      mentionsReverseCharge(invoice.noteBelow) ? null : this.reverseChargeNote(t, invoice, tenant, contact),
      invoice.documentType === "proforma" ? t.proformaNote : null,
      invoice.documentType !== "quote" && invoice.paymentInstructions
        ? `${invoice.paymentMethodLabel || t.methods[invoice.paymentMethod]}: ${fill(invoice.paymentInstructions)}`
        : null,
      fill(invoice.noteBelow),
      invoice.issuedByName ? `${t.issuedBy}: ${invoice.issuedByName}` : null,
      fill(tenant.registryNote),
    ].filter((n): n is string => !!n);
    if (notes.length === 0) return;
    doc.moveDown(1);
    doc.font(REGULAR).fontSize(8.5).fillColor(MUTED);
    for (const note of notes) {
      doc.text(note, 50, doc.y, { width: 495 });
      doc.moveDown(0.4);
    }
    doc.fillColor("black");
  }

  /**
   * One small grey line at the very bottom of every page, the way Fakturoid
   * and iDoklad sign their PDFs. Drawn inside the bottom margin, so the
   * margin is lifted for the moment or pdfkit would start a new page.
   */
  private renderCredit(doc: PDFKit.PDFDocument, lang: Lang): void {
    const label = { cs: "Vystaveno v aplikaci Billanta", sk: "Vystavené v aplikácii Billanta", en: "Made with Billanta" }[lang];
    const url = (process.env.PUBLIC_SITE_URL ?? "https://billanta.com").replace(/\/$/, "");
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      // Mark + text centred together as one line.
      const text = `${label} · ${url.replace(/^https?:\/\//, "")}`;
      doc.font(REGULAR).fontSize(7.5);
      const mark = 11;
      const width = Math.ceil(doc.widthOfString(text)) + 1;
      const left = 50 + (495 - (mark + 5 + width)) / 2;
      this.renderBrandMark(doc, left, doc.page.height - 31, mark);
      // pdfkit needs an explicit width to size the link annotation.
      doc.fillColor("#4b5563").text(text, left + mark + 5, doc.page.height - 28.5, { width, link: url, lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.fillColor("black");
  }

  /** The Billanta "B" tile from components/brand-mark.tsx, `size` points square. */
  private renderBrandMark(doc: PDFKit.PDFDocument, x: number, y: number, size: number): void {
    const gradient = doc.linearGradient(x, y, x + size, y + size).stop(0, "#6366f1").stop(1, "#7c3aed");
    doc.save();
    doc.roundedRect(x, y, size, size, size / 4).fill(gradient);
    doc.translate(x, y).scale(size / 32);
    doc
      .path("M10.5 7.5h6.3a4.25 4.25 0 0 1 0 8.5H10.5zM10.5 16h7.4a4.5 4.5 0 0 1 0 9h-7.4z")
      .lineWidth(2.8)
      .lineJoin("round")
      .stroke("#ffffff");
    doc.circle(24.6, 8.4, 2.6).fill("#4ade80");
    doc.restore();
  }

  private formatNumber(n: number): string {
    return n.toLocaleString("cs-CZ", { maximumFractionDigits: 3 });
  }

  private formatAmount(amount: number, currency: string): string {
    return `${amount.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}
