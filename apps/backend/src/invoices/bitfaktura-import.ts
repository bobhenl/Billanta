import { REVERSE_CHARGE_TEXT, type ImportedContact, type ImportedInvoice, type ImportedLine, type ImportSkip } from "./invoice-import.util";
import { normalizeCountry } from "../contacts/contacts-csv.util";
import type { SellerSnapshot } from "./party-snapshot";
import { asPdf, buyerSnapshotFrom, contactFrom, date, isEmail, longText, num, parseBankAccount, text, type Fetch } from "./api-import.util";
import { deriveVariableSymbol } from "./invoice-numbering.util";

/**
 * Invoice history straight from the BitFaktura API ("stěhování" without a CSV
 * export). BitFaktura runs on the InvoiceOcean platform, so the same API also
 * serves InvoiceOcean, Fakturownia and VosFactures accounts.
 *
 * The user's API token is only used for these read-only GET requests and is
 * never stored. Requests go to `<account>.<one of HOSTS>` only, so the
 * account name a user types cannot point the backend at another host.
 */
const HOSTS = ["bitfaktura.cz", "invoiceocean.com", "fakturownia.pl", "vosfactures.fr"];
const PER_PAGE = 100;
const MAX_PAGES = 60;

/**
 * `firma`, `firma.bitfaktura.cz` or a pasted `https://firma.bitfaktura.cz/invoices`
 * → `https://firma.bitfaktura.cz`. Null for anything outside the platform's hosts.
 */
export function bitfakturaBaseUrl(account: string): string | null {
  let host = account.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0]!;
  if (/^[a-z0-9-]{1,63}$/.test(host)) host = `${host}.bitfaktura.cz`;
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(.+)$/.exec(host);
  if (!match || !HOSTS.includes(match[2]!) || match[1] === "app" || match[1] === "www") return null;
  return `https://${host}`;
}

export class BitfakturaError extends Error {
  constructor(readonly code: "bitfaktura_account" | "bitfaktura_unauthorized" | "bitfaktura_unreachable") {
    super(code);
  }
}

/** Every invoice of the account, with its line items (`positions`). */
export function fetchBitfakturaInvoices(account: string, apiToken: string, fetcher: Fetch = fetch): Promise<BitfakturaInvoice[]> {
  return fetchAllPages<BitfakturaInvoice>(account, apiToken, "invoices.json?period=all&include_positions=true&", fetcher);
}

/** The account's seller profiles; the main one holds the business details. */
export function fetchBitfakturaDepartments(account: string, apiToken: string, fetcher: Fetch = fetch): Promise<BitfakturaDepartment[]> {
  return fetchAllPages<BitfakturaDepartment>(account, apiToken, "departments.json?", fetcher);
}

/** Every contact of the account, also those never invoiced. */
export function fetchBitfakturaClients(account: string, apiToken: string, fetcher: Fetch = fetch): Promise<BitfakturaClient[]> {
  return fetchAllPages<BitfakturaClient>(account, apiToken, "clients.json?", fetcher);
}

async function fetchAllPages<T>(account: string, apiToken: string, path: string, fetcher: Fetch): Promise<T[]> {
  const base = bitfakturaBaseUrl(account);
  if (!base) throw new BitfakturaError("bitfaktura_account");
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetcher(`${base}/${path}page=${page}&per_page=${PER_PAGE}`, {
        headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
        // A redirect would mean "not an API answer" (e.g. the login page).
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new BitfakturaError("bitfaktura_unreachable");
    }
    if (res.status === 401 || res.status === 403) throw new BitfakturaError("bitfaktura_unauthorized");
    if (res.status === 404) throw new BitfakturaError("bitfaktura_account");
    if (!res.ok) throw new BitfakturaError("bitfaktura_unreachable");
    const body: unknown = await res.json().catch(() => null);
    if (!Array.isArray(body)) throw new BitfakturaError("bitfaktura_unauthorized");
    all.push(...(body as T[]));
    if (body.length < PER_PAGE) break;
  }
  return all;
}

/**
 * The PDF the customer originally received, kept as an archive copy next to
 * the imported invoice. Null when it can't be had (missing, not a PDF, too
 * big); the import goes on without it.
 */
export async function fetchBitfakturaPdf(
  account: string,
  apiToken: string,
  sourceId: number,
  maxBytes: number,
  fetcher: Fetch = fetch,
): Promise<Buffer | null> {
  const base = bitfakturaBaseUrl(account);
  if (!base || !Number.isSafeInteger(sourceId) || sourceId <= 0) return null;
  try {
    const res = await fetcher(`${base}/invoices/${sourceId}.pdf`, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/pdf" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return asPdf(Buffer.from(await res.arrayBuffer()), maxBytes);
  } catch {
    return null;
  }
}

/** The fields of an InvoiceOcean invoice this import reads (the API sends ~200). */
export interface BitfakturaInvoice {
  id: number;
  number: string;
  kind: string;
  status: string;
  cancelled?: boolean | null;
  issue_date: string;
  sell_date?: string | null;
  payment_to?: string | null;
  paid_date?: string | null;
  paid?: string | null;
  currency: string;
  exchange_rate?: string | null;
  payment_type?: string | null;
  lang?: string | null;
  reverse_charge?: boolean | null;
  /** Printed note; people also put payment references and the reverse-charge sentence here. */
  description?: string | null;
  description_long?: string | null;
  description_footer?: string | null;
  /** Never printed. */
  internal_note?: string | null;
  /** Order number ("číslo objednávky"). */
  oid?: string | null;
  /** Place of issue. */
  place?: string | null;
  /** "cnb" when the rate came from the ČNB list of `exchange_date`. */
  exchange_kind?: string | null;
  exchange_date?: string | null;
  buyer_name?: string | null;
  buyer_first_name?: string | null;
  buyer_last_name?: string | null;
  buyer_tax_no?: string | null;
  buyer_email?: string | null;
  buyer_street?: string | null;
  buyer_city?: string | null;
  buyer_post_code?: string | null;
  buyer_country?: string | null;
  /** The buyer's person on the document, the counterpart of `seller_person`. */
  buyer_person?: string | null;
  // The seller block as printed on this very invoice (it may differ from
  // today's seller profile). Any of these can be missing or empty.
  seller_name?: string | null;
  seller_tax_no?: string | null;
  seller_register_number?: string | null;
  seller_street?: string | null;
  seller_city?: string | null;
  seller_post_code?: string | null;
  seller_country?: string | null;
  seller_email?: string | null;
  seller_phone?: string | null;
  seller_www?: string | null;
  /** The person who issued the invoice ("Vystavil"). */
  seller_person?: string | null;
  seller_bank_account?: string | null;
  seller_iban?: string | null;
  seller_swift?: string | null;
  additional_fields?: { seller_trade_register_cz?: string | null } | null;
  positions?: {
    name?: string | null;
    quantity?: string | null;
    quantity_unit?: string | null;
    price_net?: string | null;
    price_gross?: string | null;
    tax?: string | null;
    discount?: string | null;
    discount_percent?: string | null;
  }[];
}

/** The fields of an InvoiceOcean client this import reads. */
export interface BitfakturaClient {
  id: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  tax_no?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile_phone?: string | null;
  street?: string | null;
  city?: string | null;
  post_code?: string | null;
  country?: string | null;
  note?: string | null;
  company?: boolean | null;
}

const DOCUMENT_TYPES: Record<string, ImportedInvoice["documentType"]> = {
  vat: "invoice",
  bill: "invoice",
  final: "invoice",
  advance: "invoice",
  proforma: "proforma",
  correction: "credit_note",
};

/** BitFaktura's own payment types; anything else (e.g. "Wise") keeps its name as the label. */
const PAYMENT_METHODS: Record<string, ImportedInvoice["paymentMethod"]> = {
  transfer: "bank_transfer",
  cash: "cash",
  card: "card",
  cash_on_delivery: "cash_on_delivery",
  paypal: "other",
};
const PAYMENT_LABELS: Record<string, string> = { paypal: "PayPal" };

const LANGUAGES: Record<string, string> = { cz: "cs", cs: "cs", sk: "sk", en: "en" };

/** API clients as contacts; one per IČO or name, nameless ones left out. */
export function mapBitfakturaClients(source: BitfakturaClient[]): ImportedContact[] {
  const out: ImportedContact[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    const person = [raw.first_name, raw.last_name].filter(Boolean).join(" ");
    const name = text(raw.name, 255) ?? text(person, 255);
    if (!name) continue;
    const contact = contactFrom({ name, taxNo: raw.tax_no, email: raw.email, street: raw.street, city: raw.city, postCode: raw.post_code, country: raw.country });
    const key = contact.ico ?? name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Contacts have no phone column; the phone goes into the internal note.
    const phone = text(raw.phone, 64) ?? text(raw.mobile_phone, 64);
    const internalNote = [phone ? `Tel. ${phone}` : null, text(raw.note, 2000)].filter(Boolean).join("\n") || null;
    out.push({ ...contact, ...(raw.company === false ? { isPerson: true } : {}), ...(internalNote ? { internalNote } : {}) });
  }
  return out;
}

/** The fields of an InvoiceOcean department (the seller profile) this import reads. */
export interface BitfakturaDepartment {
  id: number;
  name?: string | null;
  tax_no?: string | null;
  register_number?: string | null;
  street?: string | null;
  city?: string | null;
  post_code?: string | null;
  country?: string | null;
  main?: boolean | null;
  deleted?: boolean | null;
  additional_fields?: { seller_trade_register_cz?: string | null } | null;
}

/**
 * Business details as the tenant settings store them; only what the source actually has.
 * No bank account: a change there alerts the owner, and an import should not go around that.
 */
export interface ImportedBusinessDetails {
  ico?: string;
  dic?: string;
  addressStreet?: string;
  addressCity?: string;
  addressPostalCode?: string;
  addressCountry?: string;
  registryNote?: string;
}

/** The main seller profile as business details, or null when there is none. */
export function mapBitfakturaSeller(departments: BitfakturaDepartment[]): ImportedBusinessDetails | null {
  const live = departments.filter((d) => !d.deleted);
  const d = live.find((x) => x.main) ?? live[0];
  if (!d) return null;
  const out: ImportedBusinessDetails = {};
  const taxNo = (d.tax_no ?? "").replace(/[\s-]/g, "").toUpperCase();
  const reg = (d.register_number ?? "").replace(/\s/g, "");
  const ico = [reg, taxNo].find((v) => /^\d{8}$/.test(v));
  if (ico) out.ico = ico;
  if (/^[A-Z]{2}[0-9A-Z]{2,12}$/.test(taxNo)) out.dic = taxNo;
  const street = text(d.street, 255);
  const city = text(d.city, 255);
  if (street && city && !isEmail(street)) {
    out.addressStreet = street;
    out.addressCity = city;
    const zip = text(d.post_code, 10);
    if (zip) out.addressPostalCode = zip;
    out.addressCountry = normalizeCountry(d.country ?? undefined) ?? "CZ";
  }
  const registry = text(d.additional_fields?.seller_trade_register_cz, 500);
  if (registry) out.registryNote = registry;
  return Object.keys(out).length > 0 ? out : null;
}

/** A bank account as typed into BitFaktura (see `parseBankAccount`). */
export const parseBitfakturaAccount = parseBankAccount;

/**
 * The supplier block of one source invoice. Only fields the invoice actually
 * has (non-empty) are kept, so a field the source lacks falls back to the
 * current company details instead of being printed empty. The address is
 * taken as a whole and exactly as typed (an e-mail in the street stays there).
 * Null when the invoice carries no seller data at all.
 */
export function mapBitfakturaInvoiceSeller(raw: BitfakturaInvoice, capturedAt: Date = new Date()): SellerSnapshot | null {
  const out: SellerSnapshot = {};
  const name = text(raw.seller_name, 255);
  if (name) {
    out.legalName = name;
    out.companyName = name;
  }
  const taxNo = (raw.seller_tax_no ?? "").replace(/[\s-]/g, "").toUpperCase();
  const reg = (raw.seller_register_number ?? "").replace(/\s/g, "");
  const ico = [reg, taxNo].find((v) => /^\d{8}$/.test(v));
  if (ico) out.ico = ico;
  if (/^[A-Z]{2}[0-9A-Z]{2,12}$/.test(taxNo)) out.dic = taxNo;
  const street = text(raw.seller_street, 255);
  const city = text(raw.seller_city, 255);
  const zip = text(raw.seller_post_code, 10);
  if (street || city || zip) {
    out.addressStreet = street;
    out.addressCity = city;
    out.addressPostalCode = zip;
    out.addressCountry = normalizeCountry(raw.seller_country ?? undefined) ?? "CZ";
  }
  const email = text(raw.seller_email, 255);
  if (email) out.email = email;
  const phone = text(raw.seller_phone, 32);
  if (phone) out.phone = phone;
  const web = text(raw.seller_www, 255);
  if (web) out.website = web;
  const registry = text(raw.additional_fields?.seller_trade_register_cz, 500);
  if (registry) out.registryNote = registry;
  const account = parseBitfakturaAccount(raw.seller_bank_account);
  const iban = parseBitfakturaAccount(raw.seller_iban)?.bankAccountIban;
  if (account || iban) {
    out.bankAccountNumber = account?.bankAccountNumber ?? null;
    out.bankAccountBankCode = account?.bankAccountBankCode ?? null;
    out.bankAccountIban = iban ?? account?.bankAccountIban ?? null;
    out.bankAccountSwift = text(raw.seller_swift, 11)?.toUpperCase() ?? null;
  }
  // "bill" is BitFaktura's invoice of a non-VAT payer; VAT on a line means a payer.
  if (raw.kind === "bill") out.dicVatPayer = false;
  else if ((raw.positions ?? []).some((p) => (num(p.tax) ?? 0) > 0)) out.dicVatPayer = true;
  if (Object.keys(out).length === 0) return null;
  return { ...out, capturedAt: capturedAt.toISOString(), source: "import" };
}

/** The printed notes of an invoice (note, long description, footer) as one note, each part once. */
function printedNote(raw: BitfakturaInvoice): string | null {
  const parts = [raw.description, raw.description_long, raw.description_footer].map((v) => longText(v, 4000)).filter((v): v is string => !!v);
  return [...new Set(parts)].join("\n\n").slice(0, 4000) || null;
}

/**
 * How the rate on a foreign invoice was chosen, for the VAT and income-tax
 * reports: BitFaktura's "cnb" with its list day, else a rate typed by hand.
 */
function exchangeRateOrigin(raw: BitfakturaInvoice, rate: number | null): Pick<ImportedInvoice, "exchangeRateMode" | "exchangeRateDate"> {
  const kind = (raw.exchange_kind ?? "").trim().toLowerCase();
  if (rate === null || !kind) return {};
  if (kind !== "cnb") return { exchangeRateMode: "manual", exchangeRateDate: null };
  const day = date(raw.exchange_date);
  return { exchangeRateMode: "cnb_daily", exchangeRateDate: day ? day.toISOString().slice(0, 10) : null };
}

/** Maps API invoices to the shape the CSV import also produces, so both share one write path. */
export function mapBitfakturaInvoices(source: BitfakturaInvoice[], capturedAt: Date = new Date()): { invoices: ImportedInvoice[]; skipped: ImportSkip[] } {
  const invoices: ImportedInvoice[] = [];
  const skipped: ImportSkip[] = [];
  const seen = new Set<string>();

  source.forEach((raw, index) => {
    const line = index + 1;
    const number = text(raw.number, 32) ?? "";
    if (!number) return skipped.push({ line, number: "", reason: "missing_number" });
    const documentType = DOCUMENT_TYPES[raw.kind];
    if (!documentType) return skipped.push({ line, number, reason: "unsupported_kind" });
    if (seen.has(number)) return skipped.push({ line, number, reason: "duplicate_in_file" });

    const person = [raw.buyer_first_name, raw.buyer_last_name].filter(Boolean).join(" ");
    const customerName = text(raw.buyer_name, 255) ?? text(person, 255);
    if (!customerName) return skipped.push({ line, number, reason: "missing_customer" });
    const issueDate = date(raw.issue_date);
    if (!issueDate) return skipped.push({ line, number, reason: "invalid_date" });

    const lines: ImportedLine[] = [];
    for (const p of raw.positions ?? []) {
      const quantity = num(p.quantity) ?? 1;
      // "disabled" (not a VAT payer), "np", "zw" and similar all mean no VAT.
      const vatRate = num(p.tax) ?? 0;
      const gross = num(p.price_gross);
      const unitPrice = num(p.price_net) ?? (gross !== null ? gross / (1 + vatRate / 100) : null);
      if (unitPrice === null || quantity === 0) return skipped.push({ line, number, reason: "invalid_amount" });
      if (num(p.discount) || num(p.discount_percent)) return skipped.push({ line, number, reason: "unsupported_discount" });
      lines.push({ description: text(p.name, 500) ?? number, quantity, unit: text(p.quantity_unit, 16), unitPrice, vatRate });
    }
    if (lines.length === 0) return skipped.push({ line, number, reason: "invalid_amount" });

    const status: ImportedInvoice["status"] = raw.cancelled || raw.status === "rejected" ? "cancelled" : raw.status === "paid" ? "paid" : "issued";
    const currency = /^[A-Za-z]{3}$/.test(raw.currency ?? "") ? raw.currency.toUpperCase() : "CZK";
    const rawRate = num(raw.exchange_rate);
    // BitFaktura stores the ČNB rate it used; 1.0 on a foreign invoice means none was set.
    const rate = currency !== "CZK" && rawRate !== null && rawRate > 0 && rawRate !== 1 ? rawRate : null;
    const paymentType = (raw.payment_type ?? "").trim();
    const note = printedNote(raw);
    // The flag is authoritative. The sentence alone only counts on an invoice
    // without VAT, so reading a note can never change what the invoice totals.
    const reverseCharge = raw.reverse_charge === true || (!!note && REVERSE_CHARGE_TEXT.test(note) && lines.every((l) => l.vatRate === 0));

    seen.add(number);
    const customer = contactFrom({
      name: customerName,
      taxNo: raw.buyer_tax_no,
      email: raw.buyer_email,
      street: raw.buyer_street,
      city: raw.buyer_city,
      postCode: raw.buyer_post_code,
      country: raw.buyer_country,
    });
    invoices.push({
      line,
      invoiceNumber: number,
      documentType,
      issueDate,
      dueDate: date(raw.payment_to),
      taxableSupplyDate: date(raw.sell_date),
      currency,
      // BitFaktura has no VS field; its documents (and the payer's bank order)
      // use the digits of the number, the same rule as our own invoices.
      variableSymbol: deriveVariableSymbol(number) || null,
      status,
      paidAt: status === "paid" ? date(raw.paid_date) ?? date(raw.payment_to) ?? issueDate : null,
      amountPaid: num(raw.paid) ?? 0,
      customer,
      sellerSnapshot: mapBitfakturaInvoiceSeller(raw, capturedAt),
      buyerSnapshot: buyerSnapshotFrom(customer, capturedAt),
      note,
      internalNote: longText(raw.internal_note, 4000),
      orderNumber: text(raw.oid, 64),
      buyerContactPerson: text(raw.buyer_person, 255),
      issuePlace: text(raw.place, 255),
      issuedByName: text(raw.seller_person, 255),
      lines,
      reverseCharge,
      paymentMethod: paymentType ? PAYMENT_METHODS[paymentType.toLowerCase()] ?? "other" : undefined,
      paymentMethodLabel: paymentType && !PAYMENT_METHODS[paymentType.toLowerCase()] ? text(paymentType, 64) : PAYMENT_LABELS[paymentType.toLowerCase()] ?? null,
      language: LANGUAGES[(raw.lang ?? "").split("/")[0]!.toLowerCase()],
      exchangeRate: rate,
      ...exchangeRateOrigin(raw, rate),
      sourceId: Number.isSafeInteger(raw.id) && raw.id > 0 ? raw.id : undefined,
    });
  });
  return { invoices, skipped };
}
