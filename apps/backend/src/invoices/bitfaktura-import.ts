import type { ImportedContact, ImportedInvoice, ImportedLine, ImportSkip } from "./invoice-import.util";
import { normalizeCountry } from "../contacts/contacts-csv.util";

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

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

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
    const pdf = Buffer.from(await res.arrayBuffer());
    if (pdf.length === 0 || pdf.length > maxBytes || pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
    return pdf;
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
  description?: string | null;
  buyer_name?: string | null;
  buyer_first_name?: string | null;
  buyer_last_name?: string | null;
  buyer_tax_no?: string | null;
  buyer_email?: string | null;
  buyer_street?: string | null;
  buyer_city?: string | null;
  buyer_post_code?: string | null;
  buyer_country?: string | null;
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

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const date = (v: string | null | undefined): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
};
const text = (v: string | null | undefined, max: number) => (v ? v.trim().slice(0, max) || null : null);

/** A buyer or client as a contact: a bare 8-digit number is a Czech IČO, with a country prefix a VAT ID. */
function contactFrom(c: {
  name: string;
  taxNo?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  postCode?: string | null;
  country?: string | null;
}): ImportedInvoice["customer"] {
  const taxNo = (c.taxNo ?? "").replace(/[\s-]/g, "").toUpperCase();
  // With no address at hand, people often typed the e-mail into the street or city
  // field on purpose, so the invoice still shows how to reach the buyer. Keep it
  // there as typed, and also use it as the contact's e-mail when there is none.
  const street = text(c.street, 255);
  const city = text(c.city, 255);
  const email = [c.email, street, city].map((v) => (v ?? "").trim()).find(isEmail) ?? null;
  return {
    legalName: c.name,
    ico: /^\d{8}$/.test(taxNo) ? taxNo : null,
    dic: /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(taxNo) ? taxNo : null,
    email,
    addressStreet: street,
    addressCity: city,
    addressPostalCode: text(c.postCode, 10),
    addressCountry: normalizeCountry(c.country ?? undefined) ?? "CZ",
  };
}

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

const isEmail = (v: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v);

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

/** Maps API invoices to the shape the CSV import also produces, so both share one write path. */
export function mapBitfakturaInvoices(source: BitfakturaInvoice[]): { invoices: ImportedInvoice[]; skipped: ImportSkip[] } {
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
    const rate = num(raw.exchange_rate);
    const paymentType = (raw.payment_type ?? "").trim();

    seen.add(number);
    invoices.push({
      line,
      invoiceNumber: number,
      documentType,
      issueDate,
      dueDate: date(raw.payment_to),
      taxableSupplyDate: date(raw.sell_date),
      currency,
      variableSymbol: null,
      status,
      paidAt: status === "paid" ? date(raw.paid_date) ?? date(raw.payment_to) ?? issueDate : null,
      amountPaid: num(raw.paid) ?? 0,
      customer: contactFrom({
        name: customerName,
        taxNo: raw.buyer_tax_no,
        email: raw.buyer_email,
        street: raw.buyer_street,
        city: raw.buyer_city,
        postCode: raw.buyer_post_code,
        country: raw.buyer_country,
      }),
      note: text(raw.description, 2000),
      lines,
      reverseCharge: raw.reverse_charge === true,
      paymentMethod: paymentType ? PAYMENT_METHODS[paymentType.toLowerCase()] ?? "other" : undefined,
      paymentMethodLabel: paymentType && !PAYMENT_METHODS[paymentType.toLowerCase()] ? text(paymentType, 64) : PAYMENT_LABELS[paymentType.toLowerCase()] ?? null,
      language: LANGUAGES[(raw.lang ?? "").split("/")[0]!.toLowerCase()],
      // BitFaktura stores the ČNB rate it used; 1.0 on a foreign invoice means none was set.
      exchangeRate: currency !== "CZK" && rate !== null && rate > 0 && rate !== 1 ? rate : null,
      sourceId: Number.isSafeInteger(raw.id) && raw.id > 0 ? raw.id : undefined,
    });
  });
  return { invoices, skipped };
}
