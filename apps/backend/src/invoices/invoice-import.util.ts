import { isReverseChargeCode, parseDocumentNumber, type NumberFormats, type ReverseChargeCode } from "@faktur/cz-compliance";
import { normalizeCountry, normalizeHeader } from "../contacts/contacts-csv.util";
import { DOCUMENT_SERIES, type DocumentType, type SequenceBump } from "./invoice-numbering.util";
import type { BuyerSnapshot, SellerSnapshot } from "./party-snapshot";

/**
 * Historical invoices from another invoicing system ("stěhování"), as CSV.
 *
 * Deliberately forgiving about the source: column names from Fakturoid,
 * iDoklad, SuperFaktura, Vyfakturuj, Pohoda, Money S3, faktorio, Invoice
 * Ninja, bitfaktura and plain Czech/Slovak/English headers typed in Excel all
 * map onto the same fields. A file can have one
 * row per invoice (totals only) or one row per line item — rows sharing an
 * invoice number are grouped into one document.
 *
 * Amounts: when the file has line prices, those are used. Otherwise one
 * summary line is created from the totals; with both "without VAT" and
 * "with VAT" totals the VAT rate is derived from them.
 */

export interface ImportedLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number;
}

/** A contact brought in on its own (API imports), with what only that source knows. */
export type ImportedContact = ImportedInvoice["customer"] & { isPerson?: boolean };

export interface ImportedInvoice {
  line: number;
  invoiceNumber: string;
  documentType: "invoice" | "proforma" | "credit_note";
  issueDate: Date;
  dueDate: Date | null;
  taxableSupplyDate: Date | null;
  currency: string;
  variableSymbol: string | null;
  status: "issued" | "paid" | "cancelled";
  paidAt: Date | null;
  amountPaid: number;
  customer: {
    legalName: string;
    ico: string | null;
    dic: string | null;
    email: string | null;
    addressStreet: string | null;
    addressCity: string | null;
    addressPostalCode: string | null;
    addressCountry: string;
    /** `contacts.phone`, for a contact the import creates. */
    phone?: string | null;
    /** E.g. the contact person; the internal note of a contact the import creates. */
    internalNote?: string | null;
  };
  note: string | null;
  lines: ImportedLine[];
  // Left out = the source does not say (defaults apply).
  reverseCharge?: boolean;
  /** Kód předmětu plnění (domestic reverse charge); only codes from REVERSE_CHARGE_CODES. */
  reverseChargeCode?: ReverseChargeCode | null;
  constantSymbol?: string | null;
  paymentMethod?: "bank_transfer" | "cash" | "card" | "cash_on_delivery" | "other";
  paymentMethodLabel?: string | null;
  language?: string;
  /** CZK per unit as the source system recorded it; looked up at the ČNB when missing. */
  exchangeRate?: number | null;
  /** How the source chose `exchangeRate` (see `invoices.exchange_rate_mode`); left out = unknown. */
  exchangeRateMode?: "cnb_daily" | "manual";
  exchangeRateDate?: string | null;
  /** Never printed (the printed note is `note`). */
  internalNote?: string | null;
  orderNumber?: string | null;
  issuePlace?: string | null;
  issuedByName?: string | null;
  /** The document's id in the source system, to fetch its original PDF. */
  sourceId?: number;
  /**
   * Supplier / buyer exactly as the source document shows them (`party-snapshot.ts`).
   * Only API imports set these; a CSV import gets a buyer snapshot from the
   * filled customer columns and no supplier snapshot.
   */
  sellerSnapshot?: SellerSnapshot | null;
  buyerSnapshot?: BuyerSnapshot | null;
}

export interface ImportSkip {
  line: number;
  number: string;
  reason: "missing_number" | "missing_customer" | "invalid_date" | "invalid_amount" | "duplicate_in_file" | "already_exists" | "unsupported_kind" | "unsupported_discount" | "other_seller";
}

type Field =
  | "number" | "documentType" | "issueDate" | "dueDate" | "taxableSupplyDate" | "currency" | "variableSymbol"
  | "status" | "paidDate" | "paidAmount" | "customer" | "ico" | "dic" | "email" | "street" | "city" | "postalCode" | "country"
  | "note" | "description" | "quantity" | "unit" | "unitPrice" | "lineVatRate" | "totalNet" | "totalGross" | "totalVat" | "vatRate"
  | "reverseCharge" | "reverseChargeCode" | "exchangeRate" | "exchangeRateCnb" | "exchangeRateKind" | "exchangeRateDate"
  | "orderNumber" | "internalNote" | "paymentMethod" | "constantSymbol" | "issuePlace" | "issuedBy" | "phone" | "contactPerson";

const ALIASES: Record<string, Field> = {};
const alias = (field: Field, ...names: string[]) => names.forEach((n) => (ALIASES[normalizeHeader(n)] = field));
alias("number", "Číslo", "Číslo faktury", "Číslo dokladu", "Cislo", "Doklad", "Invoice number", "Invoice #", "number", "Number", "Číslo faktúry");
alias("documentType", "Typ", "Typ dokladu", "Druh dokladu", "Document type", "Type", "document_type");
alias("issueDate", "Vystaveno", "Datum vystavení", "Vystavení", "Datum", "Issue date", "Issued on", "issued_on", "Date", "Invoice date", "Dátum vystavenia");
alias("dueDate", "Splatnost", "Datum splatnosti", "Splatno", "Due date", "Due on", "due_on", "Dátum splatnosti");
alias("taxableSupplyDate", "DUZP", "Zdanitelné plnění", "Datum zdanitelného plnění", "Datum uskutečnění zdanitelného plnění", "Taxable supply date", "taxable_fulfillment_due", "Dátum dodania");
alias("currency", "Měna", "Mena", "Currency", "currency");
alias("variableSymbol", "Variabilní symbol", "VS", "Variable symbol", "variable_symbol", "Variabilný symbol");
alias("status", "Stav", "Stav úhrady", "Status", "status", "Stav faktury");
alias("paidDate", "Zaplaceno dne", "Datum úhrady", "Uhrazeno", "Datum zaplacení", "Paid on", "paid_on", "Paid date", "Payment date", "Dátum úhrady");
alias("paidAmount", "Zaplacená částka", "Uhrazená částka", "Uhrazeno celkem", "Paid amount", "Amount paid", "Paid", "Uhradená suma");
alias("customer", "Odběratel", "Odberatel", "Zákazník", "Klient", "Firma", "Název odběratele", "Customer", "Client", "Client name", "client_name", "Odberateľ");
alias("ico", "IČO", "IČ", "ICO", "IČO odběratele", "Registration no", "client_registration_no", "Company ID", "Client ID number");
alias("dic", "DIČ", "DIC", "DIČ odběratele", "IČ DPH", "VAT no", "client_vat_no", "VAT ID", "Client VAT number");
alias("email", "E-mail", "Email", "E-mail odběratele", "Client email", "client_email");
alias("street", "Ulice", "Adresa", "Street", "client_street", "Address", "Address 1", "Ulica");
alias("city", "Město", "Obec", "City", "client_city", "Mesto");
alias("postalCode", "PSČ", "PSC", "ZIP", "Postal code", "client_zip", "Postcode");
alias("country", "Země", "Stát", "Country", "client_country", "Krajina");
alias("note", "Poznámka", "Text", "Note", "Notes", "Public notes", "note");
alias("description", "Položka", "Popis", "Název položky", "Popis položky", "Item", "Description", "Item description", "Product", "Položka názov");
alias("quantity", "Množství", "Počet", "Qty", "Quantity", "Množstvo");
alias("unit", "Jednotka", "MJ", "Unit", "unit_name");
alias("unitPrice", "Cena za jednotku", "Jednotková cena", "Cena za MJ", "Unit price", "Unit cost", "Cost", "Price", "unit_price", "Jednotková cena bez DPH");
alias("lineVatRate", "Sazba DPH položky", "Item tax rate", "Line tax rate");
alias("vatRate", "Sazba DPH", "Sazba", "DPH %", "VAT rate", "Tax rate", "vat_rate", "Sadzba DPH");
alias("totalNet", "Celkem bez DPH", "Základ", "Základ DPH", "Bez DPH", "Subtotal", "Net", "subtotal", "Total without VAT", "Spolu bez DPH");
alias("totalGross", "Celkem", "Celkem s DPH", "Celková částka", "K úhradě", "Částka", "Total", "Amount", "total", "Total with VAT", "Spolu", "Suma");
alias("totalVat", "DPH", "Částka DPH", "VAT", "Tax", "Tax amount", "VAT amount");
alias("reverseCharge", "Přenesená daňová povinnost", "Přenesení daňové povinnosti", "Režim přenesení daňové povinnosti", "PDP", "Reverse charge", "reverse_charge", "transferred_tax_liability", "Prenesená daňová povinnosť", "Prenesenie daňovej povinnosti", "Tuzemské prenesenie daňovej povinnosti");
alias("reverseChargeCode", "Kód předmětu plnění", "Kód plnění", "Předmět plnění", "Kód PDP", "Supply code", "supply_code", "Kód predmetu plnenia");
alias("exchangeRate", "Kurz", "Kurz měny", "Směnný kurz", "Exchange rate", "exchange_rate", "Kurz meny", "Výmenný kurz");
// A rate column named after the ČNB already says where the rate came from.
alias("exchangeRateCnb", "Kurz ČNB", "Kurz dle ČNB", "CNB rate", "CNB exchange rate", "Kurz podľa ČNB");
alias("exchangeRateKind", "Typ kurzu", "Zdroj kurzu", "Druh kurzu", "Exchange rate type", "Exchange rate source", "exchange_kind");
alias("exchangeRateDate", "Datum kurzu", "Kurz ze dne", "Exchange rate date", "exchange_date", "Dátum kurzu");
alias("orderNumber", "Číslo objednávky", "Objednávka", "Objednávka č.", "Číslo objednávky odběratele", "Order number", "Order no", "PO number", "order_number", "oid", "Číslo objednávky odberateľa");
alias("internalNote", "Interní poznámka", "Interní text", "Soukromá poznámka", "Internal note", "Private notes", "private_note", "internal_note", "Interná poznámka");
alias("paymentMethod", "Způsob platby", "Způsob úhrady", "Forma úhrady", "Forma platby", "Platba", "Úhrada", "Payment method", "Payment type", "payment_method", "payment_type", "Spôsob úhrady", "Spôsob platby");
alias("constantSymbol", "Konstantní symbol", "KS", "Konst. symbol", "Constant symbol", "constant_symbol", "Konštantný symbol");
alias("issuePlace", "Místo vystavení", "Vystaveno v", "Issue place", "Place of issue", "place", "Miesto vystavenia");
alias("issuedBy", "Vystavil", "Vystavila", "Fakturu vystavil", "Vyhotovil", "Issued by", "seller_person", "Vyhotovila");
alias("phone", "Telefon", "Tel.", "Mobil", "Telefon odběratele", "Phone", "client_phone", "Telefón", "Telefón odberateľa");
alias("contactPerson", "Kontaktní osoba", "Kontakt", "Contact person", "Contact name", "client_contact", "Kontaktná osoba");

/** Known statutory rates the derived rate snaps to (CZ, SK, and common EU). */
const KNOWN_RATES = [0, 5, 7, 9, 10, 12, 13, 15, 19, 20, 21, 23, 24, 25, 27];

export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let value = raw.replace(/[\s ]/g, "").replace(/[^\d,.\-−]/g, "").replace("−", "-");
  if (!value || value === "-") return null;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  // "1.234,50" / "1,234.50" / "1234,5" — the right-most separator is the decimal one.
  if (lastComma > lastDot) value = value.replace(/\./g, "").replace(",", ".");
  else value = value.replace(/,/g, "");
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const v = raw.trim().split(/[ T]/)[0]!;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 1990 && y <= 2100 ? date : null;
}

function snapRate(rate: number): number {
  const nearest = KNOWN_RATES.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best), 0);
  return Math.abs(nearest - rate) <= 0.6 ? nearest : Math.round(rate * 100) / 100;
}

function parseRate(raw: string | undefined): number | null {
  const n = parseAmount(raw);
  if (n === null) return null;
  // "0.21" style fractions.
  return n > 0 && n < 1 ? n * 100 : n;
}

function documentTypeOf(raw: string | undefined, number: string, gross: number | null): ImportedInvoice["documentType"] {
  const v = normalizeHeader(raw ?? "");
  if (/zaloh|proforma|zf/.test(v)) return "proforma";
  if (/dobropis|opravn|credit|storno/.test(v)) return "credit_note";
  if (!v && gross !== null && gross < 0) return "credit_note";
  if (!v && /^ZF/i.test(number)) return "proforma";
  return "invoice";
}

function statusOf(raw: string | undefined, paidAt: Date | null): "issued" | "paid" | "cancelled" | null {
  const v = normalizeHeader(raw ?? "");
  if (/storn|zrus|cancel|void/.test(v)) return "cancelled";
  if (/^(zaplac|uhraz|paid|ano|yes|true|1$)|^uhraden/.test(v) && !/nezapl|neuhr|unpaid|partial|castecn/.test(v)) return "paid";
  if (paidAt) return "paid";
  return v ? "issued" : null;
}

const clean = (v: string | undefined, max: number) => (v ? v.trim().slice(0, max) || null : null);

/**
 * The sentence people type (or a template prints) on a reverse-charge
 * invoice, in Czech, Slovak or English. Older invoices often carry only this
 * text and no flag.
 */
export const REVERSE_CHARGE_TEXT = /p[řr]enesen\S* da[ňn]ov\S* povinnos|da[ňn] odvede z[áa]kazn[íi]k|reverse[\s-]charge/i;

/** A yes/no cell as spreadsheets and exports write it; null when it is neither. */
export function parseFlag(raw: string | undefined): boolean | null {
  const v = normalizeHeader(raw ?? "");
  if (!v) return null;
  // Diacritics are gone here, so "áno" is "ano".
  if (/^(1|ano|a|yes|y|true|pravda|x)$/.test(v)) return true;
  if (/^(0|ne|n|no|false|nepravda|nie)$/.test(v)) return false;
  return null;
}

/**
 * Labels the source systems use for each payment method, normalised (see
 * `normalizeHeader`). Card comes before transfer so "bankovní karta" is a card.
 */
const PAYMENT_METHOD_PATTERNS: [RegExp, NonNullable<ImportedInvoice["paymentMethod"]>][] = [
  [/dobirk|dobierk|cashondelivery|^cod$/, "cash_on_delivery"],
  [/kart|card/, "card"],
  [/prevod|prikaz|bank|transfer|ucet|wire/, "bank_transfer"],
  [/hotov|cash/, "cash"],
];

/**
 * A payment-method cell: a known method by its usual name, anything else
 * (PayPal, "zápočtem", …) as "other" with the text kept as the printed label,
 * the same as the BitFaktura import does.
 */
export function paymentMethodOf(raw: string | undefined): Pick<ImportedInvoice, "paymentMethod" | "paymentMethodLabel"> {
  const label = clean(raw, 64);
  if (!label) return {};
  const v = normalizeHeader(label);
  const known = PAYMENT_METHOD_PATTERNS.find(([pattern]) => pattern.test(v))?.[1];
  return known ? { paymentMethod: known, paymentMethodLabel: null } : { paymentMethod: "other", paymentMethodLabel: label };
}

/** A KH code as typed ("4", " 1A ", "4.0" from Excel); null unless it is one EPO accepts. */
export function parseReverseChargeCode(raw: string | undefined): ReverseChargeCode | null {
  const v = (raw ?? "").trim().toLowerCase().replace(/[.,]0+$/, "");
  return isReverseChargeCode(v) ? v : null;
}

/**
 * The rate on a foreign-currency row and how it was chosen. A rate is taken
 * as typed by hand unless the file says it is the ČNB's (the column's own
 * name or a rate-type column), as the VAT reports treat the two differently.
 */
function exchangeRateOf(raw: Partial<Record<Field, string>>, currency: string): Pick<ImportedInvoice, "exchangeRate" | "exchangeRateMode" | "exchangeRateDate"> {
  if (currency === "CZK") return {};
  const cnbColumn = raw.exchangeRateCnb !== undefined && raw.exchangeRate === undefined;
  const rate = parseAmount(raw.exchangeRate ?? raw.exchangeRateCnb);
  // 1 on a foreign invoice is an export's placeholder, not a rate.
  if (rate === null || rate <= 0 || rate === 1) return {};
  const cnb = cnbColumn || /cnb|narodni|national/.test(normalizeHeader(raw.exchangeRateKind ?? ""));
  if (!cnb) return { exchangeRate: rate, exchangeRateMode: "manual", exchangeRateDate: null };
  const day = parseDate(raw.exchangeRateDate);
  return { exchangeRate: rate, exchangeRateMode: "cnb_daily", exchangeRateDate: day ? day.toISOString().slice(0, 10) : null };
}

/**
 * The reverse-charge flag of a row. A yes/no column is authoritative. The
 * reverse-charge sentence (in the note, or typed into the flag column) only
 * counts when no line carries VAT, so reading text can never change what an
 * invoice totals – the same rule as the BitFaktura import. "hint" is decided
 * once all of the invoice's line rows are in.
 */
function reverseChargeOf(raw: Partial<Record<Field, string>>): boolean | "hint" | undefined {
  const flag = parseFlag(raw.reverseCharge);
  if (flag !== null) return flag;
  return [raw.reverseCharge, raw.note].some((v) => !!v && REVERSE_CHARGE_TEXT.test(v)) ? "hint" : undefined;
}

/**
 * Maps parsed CSV rows (first row = header) to invoices. Throws
 * `unknown_columns` when the file has no recognisable number + customer +
 * amount columns, i.e. it is clearly not an invoice list.
 */
export function mapInvoiceRows(rows: string[][]): { invoices: ImportedInvoice[]; skipped: ImportSkip[] } {
  const [header, ...body] = rows;
  if (!header) return { invoices: [], skipped: [] };
  const columns = header.map((h) => ALIASES[normalizeHeader(h)] ?? null);
  const has = (f: Field) => columns.includes(f);
  if (!has("number") || !has("customer") || !(has("totalGross") || has("totalNet") || has("unitPrice"))) {
    throw new Error("unknown_columns");
  }

  const byNumber = new Map<string, ImportedInvoice>();
  const skipped: ImportSkip[] = [];
  const order: ImportedInvoice[] = [];
  // Settled after the loop, once every line row of an invoice is grouped in.
  const reverseChargeHints = new Set<string>();
  const reverseChargeCodes = new Map<string, ReverseChargeCode>();

  body.forEach((cells, index) => {
    const line = index + 2;
    const raw: Partial<Record<Field, string>> = {};
    columns.forEach((field, i) => {
      const value = (cells[i] ?? "").trim();
      if (field && value && raw[field] === undefined) raw[field] = value;
    });
    const number = clean(raw.number, 32) ?? "";
    if (!number) return skipped.push({ line, number: "", reason: "missing_number" });

    const existing = byNumber.get(number);
    const lineFromItem = (): ImportedLine | null | "invalid" => {
      if (raw.unitPrice === undefined) return null;
      const unitPrice = parseAmount(raw.unitPrice);
      const quantity = raw.quantity === undefined ? 1 : parseAmount(raw.quantity);
      if (unitPrice === null || quantity === null || quantity === 0) return "invalid";
      return {
        description: clean(raw.description, 500) ?? number,
        quantity,
        unit: clean(raw.unit, 16),
        unitPrice,
        vatRate: snapRate(parseRate(raw.lineVatRate ?? raw.vatRate) ?? 0),
      };
    };

    // A follow-up row of a multi-line invoice: only its item matters.
    if (existing) {
      const item = lineFromItem();
      if (item === "invalid") return skipped.push({ line, number, reason: "invalid_amount" });
      if (item && existing.lines.length < 200) existing.lines.push(item);
      else if (!item) skipped.push({ line, number, reason: "duplicate_in_file" });
      return;
    }

    const customerName = clean(raw.customer, 255);
    if (!customerName) return skipped.push({ line, number, reason: "missing_customer" });
    const issueDate = parseDate(raw.issueDate);
    if (!issueDate) return skipped.push({ line, number, reason: "invalid_date" });

    const net = parseAmount(raw.totalNet);
    const gross = parseAmount(raw.totalGross);
    const vatAmount = parseAmount(raw.totalVat);
    let lines: ImportedLine[];
    const item = lineFromItem();
    if (item === "invalid") return skipped.push({ line, number, reason: "invalid_amount" });
    if (item) {
      lines = [item];
    } else {
      const base = net ?? (gross !== null && vatAmount !== null ? gross - vatAmount : gross);
      if (base === null) return skipped.push({ line, number, reason: "invalid_amount" });
      const explicitRate = parseRate(raw.vatRate);
      const vat = vatAmount ?? (net !== null && gross !== null ? gross - net : null);
      const rate = explicitRate ?? (vat !== null && base !== 0 ? (vat / base) * 100 : 0);
      lines = [{ description: clean(raw.description, 500) ?? clean(raw.note, 500) ?? `Faktura ${number}`, quantity: 1, unit: null, unitPrice: base, vatRate: snapRate(rate) }];
    }

    const paidAt = parseDate(raw.paidDate);
    const status = statusOf(raw.status, paidAt) ?? "issued";
    const currency = /^[A-Za-z]{3}$/.test(raw.currency ?? "") ? raw.currency!.toUpperCase() : /€|eur/i.test(`${raw.totalGross ?? ""}${raw.currency ?? ""}`) ? "EUR" : "CZK";
    const ico = raw.ico ? raw.ico.replace(/\s/g, "") : null;
    const reverseCharge = reverseChargeOf(raw);
    if (reverseCharge === "hint") reverseChargeHints.add(number);
    const constantSymbol = (raw.constantSymbol ?? "").replace(/\s/g, "");
    const contactPerson = clean(raw.contactPerson, 255);

    const invoice: ImportedInvoice = {
      line,
      invoiceNumber: number,
      documentType: documentTypeOf(raw.documentType, number, gross),
      issueDate,
      dueDate: parseDate(raw.dueDate),
      taxableSupplyDate: parseDate(raw.taxableSupplyDate),
      currency,
      variableSymbol: raw.variableSymbol && /^\d{1,10}$/.test(raw.variableSymbol.replace(/\s/g, "")) ? raw.variableSymbol.replace(/\s/g, "") : null,
      status,
      paidAt: status === "paid" ? paidAt ?? parseDate(raw.dueDate) ?? issueDate : null,
      amountPaid: parseAmount(raw.paidAmount) ?? 0,
      customer: {
        legalName: customerName,
        ico: ico && /^\d{1,8}$/.test(ico) ? ico.padStart(8, "0") : null,
        dic: raw.dic ? raw.dic.replace(/\s/g, "").toUpperCase().slice(0, 14) : null,
        email: raw.email && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(raw.email.split(/[,;\s]+/)[0]!) ? raw.email.split(/[,;\s]+/)[0]! : null,
        addressStreet: clean(raw.street, 255),
        addressCity: clean(raw.city, 255),
        addressPostalCode: clean(raw.postalCode, 10),
        addressCountry: normalizeCountry(raw.country) ?? "CZ",
        ...(raw.phone ? { phone: clean(raw.phone, 32) } : {}),
        // Contacts have no contact-person column; the contact's internal note keeps it.
        ...(contactPerson ? { internalNote: `Kontaktní osoba: ${contactPerson}` } : {}),
      },
      note: clean(raw.note, 2000),
      lines,
      ...(typeof reverseCharge === "boolean" ? { reverseCharge } : {}),
      ...exchangeRateOf(raw, currency),
      ...paymentMethodOf(raw.paymentMethod),
      ...(/^\d{1,4}$/.test(constantSymbol) ? { constantSymbol: constantSymbol.padStart(4, "0") } : {}),
      ...(raw.orderNumber ? { orderNumber: clean(raw.orderNumber, 64) } : {}),
      ...(raw.internalNote ? { internalNote: clean(raw.internalNote, 4000) } : {}),
      ...(raw.issuePlace ? { issuePlace: clean(raw.issuePlace, 255) } : {}),
      ...(raw.issuedBy ? { issuedByName: clean(raw.issuedBy, 255) } : {}),
    };
    const code = parseReverseChargeCode(raw.reverseChargeCode);
    if (code) reverseChargeCodes.set(number, code);
    byNumber.set(number, invoice);
    order.push(invoice);
  });

  for (const invoice of order) {
    if (reverseChargeHints.has(invoice.invoiceNumber) && invoice.lines.every((l) => l.vatRate === 0)) invoice.reverseCharge = true;
    // The KH code belongs to a domestic reverse charge only, never to an invoice without one.
    const code = reverseChargeCodes.get(invoice.invoiceNumber);
    if (code && invoice.reverseCharge && invoice.customer.addressCountry === "CZ") invoice.reverseChargeCode = code;
  }
  return { invoices: order, skipped };
}

/** "2026-0042" / "ZF2026-0003" — our own format, whose sequence must continue after an import. */
export function ownNumberSequence(invoiceNumber: string): { series: string; year: number; month: number; sequence: number } | null {
  const match = /^(ZF|OD|NA)?(\d{4})-(\d{1,6})$/.exec(invoiceNumber);
  if (!match) return null;
  return { series: match[1] ?? "", year: Number(match[2]), month: 0, sequence: Number(match[3]) };
}

/**
 * The counter an imported number belongs to: read with the company's
 * pattern for that document type (e.g. `1/10/2026` with `{N}/{MM}/{YYYY}` →
 * the October 2026 counter at 1), else as our built-in format.
 */
export function importedNumberSequence(invoiceNumber: string, documentType: DocumentType, formats: NumberFormats): SequenceBump | null {
  const pattern = formats[documentType];
  const parsed = pattern ? parseDocumentNumber(pattern, invoiceNumber) : null;
  if (parsed) return { series: DOCUMENT_SERIES[documentType], ...parsed };
  return ownNumberSequence(invoiceNumber);
}

/** Highest imported sequence per counter, so issuance continues after it. */
export function highestImportedSequences(
  invoices: { invoiceNumber: string; documentType: DocumentType }[],
  formats: NumberFormats,
): SequenceBump[] {
  const best = new Map<string, SequenceBump>();
  for (const inv of invoices) {
    const own = importedNumberSequence(inv.invoiceNumber, inv.documentType, formats);
    if (!own) continue;
    const key = `${own.series}|${own.year}|${own.month}`;
    if ((best.get(key)?.sequence ?? 0) < own.sequence) best.set(key, own);
  }
  return [...best.values()];
}
