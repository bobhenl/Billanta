import { parseDocumentNumber, type NumberFormats } from "@faktur/cz-compliance";
import { normalizeCountry, normalizeHeader } from "../contacts/contacts-csv.util";
import { DOCUMENT_SERIES, type DocumentType, type SequenceBump } from "./invoice-numbering.util";

/**
 * Historical invoices from another invoicing system ("stěhování"), as CSV.
 *
 * Deliberately forgiving about the source: column names from Fakturoid,
 * iDoklad, faktorio, Invoice Ninja, bitfaktura and plain Czech/Slovak/English
 * headers typed in Excel all map onto the same fields. A file can have one
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
export type ImportedContact = ImportedInvoice["customer"] & { isPerson?: boolean; internalNote?: string };

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
  };
  note: string | null;
  lines: ImportedLine[];
  // Only API imports know these; the CSV mapper leaves them out (defaults apply).
  reverseCharge?: boolean;
  paymentMethod?: "bank_transfer" | "cash" | "card" | "cash_on_delivery" | "other";
  paymentMethodLabel?: string | null;
  language?: string;
  /** CZK per unit as the source system recorded it; looked up at the ČNB when missing. */
  exchangeRate?: number | null;
  /** The document's id in the source system, to fetch its original PDF. */
  sourceId?: number;
}

export interface ImportSkip {
  line: number;
  number: string;
  reason: "missing_number" | "missing_customer" | "invalid_date" | "invalid_amount" | "duplicate_in_file" | "already_exists" | "unsupported_kind" | "unsupported_discount";
}

type Field =
  | "number" | "documentType" | "issueDate" | "dueDate" | "taxableSupplyDate" | "currency" | "variableSymbol"
  | "status" | "paidDate" | "paidAmount" | "customer" | "ico" | "dic" | "email" | "street" | "city" | "postalCode" | "country"
  | "note" | "description" | "quantity" | "unit" | "unitPrice" | "lineVatRate" | "totalNet" | "totalGross" | "totalVat" | "vatRate";

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
      },
      note: clean(raw.note, 2000),
      lines,
    };
    byNumber.set(number, invoice);
    order.push(invoice);
  });

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
