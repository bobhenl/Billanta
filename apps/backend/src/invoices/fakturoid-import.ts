import { REVERSE_CHARGE_TEXT, parseReverseChargeCode, type ImportedContact, type ImportedInvoice, type ImportedLine, type ImportSkip } from "./invoice-import.util";
import { normalizeCountry } from "../contacts/contacts-csv.util";
import type { SellerSnapshot } from "./party-snapshot";
import { deriveVariableSymbol } from "./invoice-numbering.util";
import { round2 } from "./invoice-total.util";
import { asPdf, buyerSnapshotFrom, contactFrom, date, isEmail, isIco, isVatId, longText, num, parseBankAccount, text, type Fetch } from "./api-import.util";
import type { ImportedBusinessDetails } from "./bitfaktura-import";

/**
 * Invoice history straight from the Fakturoid API v3 (every plan, the free
 * one included, has API access).
 *
 * The user pastes the Client ID and Client secret from Fakturoid's Settings →
 * User account. They are exchanged for a 2-hour access token, which together
 * with them lives only in this request: nothing is stored or logged. Apart
 * from that token request, only GETs are sent, so the source account is never
 * changed. Requests only ever go to app.fakturoid.cz.
 */
const API = "https://app.fakturoid.cz/api/v3";
// Fakturoid answers 400 without a User-Agent in the "App (e-mail)" form.
const USER_AGENT = "Billanta import (faktury@billanta.cz)";
const PER_PAGE = 40;
const MAX_PAGES = 150;
/** Retries of one request after a 429 (rate limit, 400 requests a minute) or a 503 (maintenance). */
const MAX_RETRIES = 4;
const MAX_WAIT_MS = 60_000;
/** A PDF still being generated answers 204; Fakturoid says to wait a second or two. */
const PDF_ATTEMPTS = 3;
const PDF_WAIT_MS = 2_000;

export class FakturoidError extends Error {
  constructor(readonly code: "fakturoid_unauthorized" | "fakturoid_account" | "fakturoid_blocked" | "fakturoid_unreachable") {
    super(code);
  }
}

export interface FakturoidCredentials {
  clientId: string;
  clientSecret: string;
  /** The account slug (app.fakturoid.cz/<slug>); only needed when the user has several. */
  account?: string;
}

export interface FakturoidOptions {
  fetcher?: Fetch;
  /** Injected by specs so a rate-limit wait does not slow them down. */
  sleep?: (ms: number) => Promise<void>;
}

/** One signed-in session against one Fakturoid account. */
export interface FakturoidConnection {
  slug: string;
  get<T>(path: string): Promise<T>;
  list<T>(path: string): Promise<T[]>;
  pdf(invoiceId: number, maxBytes: number): Promise<Buffer | null>;
}

/** `applecorp` or a pasted `https://app.fakturoid.cz/applecorp/invoices` → `applecorp`. */
export function fakturoidSlug(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "");
  const path = raw.startsWith("app.fakturoid.cz/") ? raw.slice("app.fakturoid.cz/".length) : raw;
  const slug = path.split(/[/?#]/)[0]!;
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug) ? slug : null;
}

/** How long to wait before retrying: the reset time Fakturoid sends, else a growing back-off. */
export function retryDelayMs(res: Pick<Response, "headers">, attempt: number): number {
  // `X-RateLimit: default;r=0;t=37` – t is the seconds until the window resets.
  const t = /(?:^|;)\s*t=(\d+)/.exec(res.headers.get("x-ratelimit") ?? "")?.[1];
  const retryAfter = res.headers.get("retry-after");
  const seconds = t !== undefined ? Number(t) : retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 2 ** attempt;
  return Math.min(MAX_WAIT_MS, Math.max(1_000, seconds * 1_000));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function connectFakturoid(credentials: FakturoidCredentials, options: FakturoidOptions = {}): Promise<FakturoidConnection> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  /** One request, retried while Fakturoid says "too many requests" or "maintenance". */
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetcher(url, {
          ...init,
          headers: { "User-Agent": USER_AGENT, ...(init.headers as Record<string, string>) },
          // A redirect would mean "not an API answer" (e.g. the login page).
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new FakturoidError("fakturoid_unreachable");
      }
      if ((res.status !== 429 && res.status !== 503) || attempt >= MAX_RETRIES) return res;
      await sleep(retryDelayMs(res, attempt));
    }
  };
  const fail = (status: number): never => {
    if (status === 401 || status === 403) throw new FakturoidError("fakturoid_unauthorized");
    if (status === 402) throw new FakturoidError("fakturoid_blocked");
    if (status === 404) throw new FakturoidError("fakturoid_account");
    throw new FakturoidError("fakturoid_unreachable");
  };

  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, "utf8").toString("base64");
  const tokenRes = await send(`${API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  // A wrong ID or secret comes back as 400 invalid_client or 401.
  if (tokenRes.status === 400 || tokenRes.status === 401 || tokenRes.status === 403) throw new FakturoidError("fakturoid_unauthorized");
  if (!tokenRes.ok) fail(tokenRes.status);
  const token = ((await tokenRes.json().catch(() => null)) as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== "string" || !token) throw new FakturoidError("fakturoid_unauthorized");
  const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const getJson = async <T>(url: string): Promise<T> => {
    const res = await send(url, { headers: auth });
    if (!res.ok) fail(res.status);
    const body: unknown = await res.json().catch(() => undefined);
    if (body === undefined || body === null) throw new FakturoidError("fakturoid_unreachable");
    return body as T;
  };

  const user = await getJson<{ default_account?: string | null; accounts?: { slug?: string | null }[] }>(`${API}/user.json`);
  const slugs = (user.accounts ?? []).map((a) => a.slug).filter((s): s is string => typeof s === "string" && !!fakturoidSlug(s));
  const wanted = credentials.account?.trim() ? fakturoidSlug(credentials.account) : null;
  if (credentials.account?.trim() && !wanted) throw new FakturoidError("fakturoid_account");
  // Several accounts and none named: we can't tell which business this is, so ask.
  const slug = wanted ?? (user.default_account && slugs.includes(user.default_account) ? user.default_account : slugs.length === 1 ? slugs[0]! : null);
  if (!slug || !slugs.includes(slug)) throw new FakturoidError("fakturoid_account");
  const base = `${API}/accounts/${encodeURIComponent(slug)}`;

  return {
    slug,
    get: <T>(path: string) => getJson<T>(`${base}/${path}`),
    async list<T>(path: string): Promise<T[]> {
      const all: T[] = [];
      const sep = path.includes("?") ? "&" : "?";
      for (let page = 1; page <= MAX_PAGES; page++) {
        const body = await getJson<unknown>(`${base}/${path}${sep}page=${page}`);
        if (!Array.isArray(body)) throw new FakturoidError("fakturoid_unreachable");
        all.push(...(body as T[]));
        if (body.length < PER_PAGE) break;
      }
      return all;
    },
    async pdf(invoiceId: number, maxBytes: number): Promise<Buffer | null> {
      if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) return null;
      try {
        for (let attempt = 1; attempt <= PDF_ATTEMPTS; attempt++) {
          const res = await send(`${base}/invoices/${invoiceId}/download.pdf`, { headers: { ...auth, Accept: "application/pdf" } });
          if (res.status === 204) {
            if (attempt < PDF_ATTEMPTS) await sleep(PDF_WAIT_MS);
            continue;
          }
          if (!res.ok) return null;
          return asPdf(Buffer.from(await res.arrayBuffer()), maxBytes);
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}

/** The fields of a Fakturoid invoice this import reads. */
export interface FakturoidInvoice {
  id: number;
  document_type: string;
  number: string;
  variable_symbol?: string | null;
  status: string;
  issued_on: string;
  taxable_fulfillment_due?: string | null;
  due_on?: string | null;
  paid_on?: string | null;
  order_number?: string | null;
  note?: string | null;
  footer_note?: string | null;
  private_note?: string | null;
  currency?: string | null;
  exchange_rate?: string | null;
  language?: string | null;
  payment_method?: string | null;
  custom_payment_method?: string | null;
  transferred_tax_liability?: boolean | null;
  supply_code?: string | null;
  vat_price_mode?: string | null;
  total?: string | null;
  remaining_amount?: string | null;
  bank_account?: string | null;
  iban?: string | null;
  swift_bic?: string | null;
  // The supplier block as printed on this very invoice.
  your_name?: string | null;
  your_street?: string | null;
  your_city?: string | null;
  your_zip?: string | null;
  your_country?: string | null;
  your_registration_no?: string | null;
  your_vat_no?: string | null;
  client_name?: string | null;
  client_street?: string | null;
  client_city?: string | null;
  client_zip?: string | null;
  client_country?: string | null;
  client_registration_no?: string | null;
  client_vat_no?: string | null;
  lines?: {
    name?: string | null;
    quantity?: string | null;
    unit_name?: string | null;
    unit_price?: string | null;
    unit_price_without_vat?: string | null;
    vat_rate?: number | string | null;
  }[];
  payments?: { paid_on?: string | null; amount?: string | null }[];
}

/** The fields of a Fakturoid subject (contact) this import reads. */
export interface FakturoidSubject {
  id: number;
  type?: string | null;
  name?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  zip?: string | null;
  country?: string | null;
  registration_no?: string | null;
  vat_no?: string | null;
  private_note?: string | null;
}

/** The fields of the Fakturoid account (the user's own business) this import reads. */
export interface FakturoidAccount {
  name?: string | null;
  registration_no?: string | null;
  vat_no?: string | null;
  street?: string | null;
  city?: string | null;
  zip?: string | null;
  country?: string | null;
  currency?: string | null;
}

/** Everything the import needs, read with GETs only. */
export async function fetchFakturoidData(conn: FakturoidConnection): Promise<{ invoices: FakturoidInvoice[]; subjects: FakturoidSubject[]; account: FakturoidAccount | null }> {
  // The docs leave open whether the plain list includes proformas (the
  // "regular" filter leaves them out), so ask for them separately and merge.
  const regular = await conn.list<FakturoidInvoice>("invoices.json");
  const proformas = await conn.list<FakturoidInvoice>("invoices.json?document_type=proforma");
  const seen = new Set<number>();
  const invoices = [...regular, ...proformas].filter((inv) => !seen.has(inv.id) && !!seen.add(inv.id));
  const subjects = await conn.list<FakturoidSubject>("subjects.json");
  // Nice to have: without it the business details are just not filled.
  const account = await conn.get<FakturoidAccount>("account.json").catch(() => null);
  return { invoices, subjects, account };
}

const DOCUMENT_TYPES: Record<string, ImportedInvoice["documentType"]> = {
  invoice: "invoice",
  final_invoice: "invoice",
  // Daňový doklad k přijaté platbě: a tax document of its own, kept as an invoice like BitFaktura's advance.
  tax_document: "invoice",
  proforma: "proforma",
  partial_proforma: "proforma",
  correction: "credit_note",
};

const PAYMENT_METHODS: Record<string, ImportedInvoice["paymentMethod"]> = {
  bank: "bank_transfer",
  cash: "cash",
  card: "card",
  cod: "cash_on_delivery",
  paypal: "other",
  custom: "other",
};

const LANGUAGES: Record<string, string> = { cz: "cs", sk: "sk", en: "en" };

/** The supplier block of one invoice; only what it has, so the rest falls back to the current details. */
export function mapFakturoidInvoiceSeller(raw: FakturoidInvoice, capturedAt: Date = new Date()): SellerSnapshot | null {
  const out: SellerSnapshot = {};
  const name = text(raw.your_name, 255);
  if (name) {
    out.legalName = name;
    out.companyName = name;
  }
  const ico = (raw.your_registration_no ?? "").replace(/\s/g, "");
  if (isIco(ico)) out.ico = ico;
  const dic = (raw.your_vat_no ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (isVatId(dic)) out.dic = dic;
  const street = text(raw.your_street, 255);
  const city = text(raw.your_city, 255);
  const zip = text(raw.your_zip, 10);
  if (street || city || zip) {
    out.addressStreet = street;
    out.addressCity = city;
    out.addressPostalCode = zip;
    out.addressCountry = normalizeCountry(raw.your_country ?? undefined) ?? "CZ";
  }
  const account = parseBankAccount(raw.bank_account);
  const iban = parseBankAccount(raw.iban)?.bankAccountIban;
  if (account || iban) {
    out.bankAccountNumber = account?.bankAccountNumber ?? null;
    out.bankAccountBankCode = account?.bankAccountBankCode ?? null;
    out.bankAccountIban = iban ?? account?.bankAccountIban ?? null;
    out.bankAccountSwift = text(raw.swift_bic, 11)?.toUpperCase() ?? null;
  }
  if ((raw.lines ?? []).some((l) => (num(l.vat_rate) ?? 0) > 0)) out.dicVatPayer = true;
  if (Object.keys(out).length === 0) return null;
  return { ...out, capturedAt: capturedAt.toISOString(), source: "import" };
}

/**
 * Maps API invoices to the shape the CSV import also produces, so all imports
 * share one write path. `accountCurrency` is the Fakturoid account's own
 * currency: its `exchange_rate` converts into that one, so it is a CZK rate
 * only on a CZK account.
 */
export function mapFakturoidInvoices(
  source: FakturoidInvoice[],
  accountCurrency: string | null | undefined = "CZK",
  capturedAt: Date = new Date(),
): { invoices: ImportedInvoice[]; skipped: ImportSkip[] } {
  const invoices: ImportedInvoice[] = [];
  const skipped: ImportSkip[] = [];
  const seen = new Set<string>();
  const homeCurrency = (accountCurrency ?? "CZK").toUpperCase();

  source.forEach((raw, index) => {
    const line = index + 1;
    const number = text(raw.number, 32) ?? "";
    if (!number) return skipped.push({ line, number: "", reason: "missing_number" });
    const documentType = DOCUMENT_TYPES[raw.document_type];
    if (!documentType) return skipped.push({ line, number, reason: "unsupported_kind" });
    if (seen.has(number)) return skipped.push({ line, number, reason: "duplicate_in_file" });
    const customerName = text(raw.client_name, 255);
    if (!customerName) return skipped.push({ line, number, reason: "missing_customer" });
    const issueDate = date(raw.issued_on);
    if (!issueDate) return skipped.push({ line, number, reason: "invalid_date" });

    const lines: ImportedLine[] = [];
    for (const l of raw.lines ?? []) {
      const quantity = num(l.quantity) ?? 1;
      const vatRate = num(l.vat_rate) ?? 0;
      const entered = num(l.unit_price);
      // unit_price is net or gross depending on vat_price_mode; the read-only net field settles it.
      const unitPrice = num(l.unit_price_without_vat) ?? (entered !== null && raw.vat_price_mode === "from_total_with_vat" ? entered / (1 + vatRate / 100) : entered);
      if (unitPrice === null || quantity === 0) return skipped.push({ line, number, reason: "invalid_amount" });
      lines.push({ description: text(l.name, 500) ?? number, quantity, unit: text(l.unit_name, 16), unitPrice, vatRate });
    }
    if (lines.length === 0) return skipped.push({ line, number, reason: "invalid_amount" });

    // "uncollectible" stays open in our books: the claim exists, it is just not paid.
    const status: ImportedInvoice["status"] = raw.status === "cancelled" ? "cancelled" : raw.status === "paid" ? "paid" : "issued";
    const currency = /^[A-Za-z]{3}$/.test(raw.currency ?? "") ? raw.currency!.toUpperCase() : homeCurrency;
    const rawRate = num(raw.exchange_rate);
    const rate = homeCurrency === "CZK" && currency !== "CZK" && rawRate !== null && rawRate > 0 && rawRate !== 1 ? rawRate : null;
    const payments = raw.payments ?? [];
    const paidSum = payments.reduce((sum, p) => sum + (num(p.amount) ?? 0), 0);
    const total = num(raw.total);
    const remaining = num(raw.remaining_amount);
    const amountPaid = round2(paidSum || (total !== null && remaining !== null ? total - remaining : 0));
    const lastPayment = payments.map((p) => date(p.paid_on)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    const method = (raw.payment_method ?? "").trim().toLowerCase();
    const note = [...new Set([raw.note, raw.footer_note].map((v) => longText(v, 4000)).filter((v): v is string => !!v))].join("\n\n").slice(0, 4000) || null;
    // The flag is authoritative; the printed sentence only counts on an invoice without VAT.
    const reverseCharge = raw.transferred_tax_liability === true || (!!note && REVERSE_CHARGE_TEXT.test(note) && lines.every((l) => l.vatRate === 0));
    const vs = (raw.variable_symbol ?? "").trim();

    seen.add(number);
    const customer = contactFrom({
      name: customerName,
      ico: raw.client_registration_no,
      dic: raw.client_vat_no,
      street: raw.client_street,
      city: raw.client_city,
      postCode: raw.client_zip,
      country: raw.client_country,
    });
    const code = parseReverseChargeCode(raw.supply_code ?? undefined);
    invoices.push({
      line,
      invoiceNumber: number,
      documentType,
      issueDate,
      dueDate: date(raw.due_on),
      taxableSupplyDate: date(raw.taxable_fulfillment_due),
      currency,
      variableSymbol: /^\d{1,10}$/.test(vs) ? vs : deriveVariableSymbol(number) || null,
      status,
      paidAt: status === "paid" ? date(raw.paid_on) ?? lastPayment ?? date(raw.due_on) ?? issueDate : null,
      amountPaid,
      customer,
      sellerSnapshot: mapFakturoidInvoiceSeller(raw, capturedAt),
      buyerSnapshot: buyerSnapshotFrom(customer, capturedAt),
      note,
      internalNote: longText(raw.private_note, 4000),
      orderNumber: text(raw.order_number, 64),
      lines,
      reverseCharge,
      // The KH code belongs to a domestic reverse charge only.
      ...(code && reverseCharge && customer.addressCountry === "CZ" ? { reverseChargeCode: code } : {}),
      paymentMethod: method ? PAYMENT_METHODS[method] ?? "other" : undefined,
      paymentMethodLabel: method === "paypal" ? "PayPal" : method === "custom" ? text(raw.custom_payment_method, 64) : null,
      language: LANGUAGES[(raw.language ?? "").toLowerCase()],
      exchangeRate: rate,
      sourceId: Number.isSafeInteger(raw.id) && raw.id > 0 ? raw.id : undefined,
    });
  });
  return { invoices, skipped };
}

/** Subjects as contacts: customers only (suppliers belong to expenses), one per IČO or name. */
export function mapFakturoidSubjects(source: FakturoidSubject[]): ImportedContact[] {
  const out: ImportedContact[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    if (raw.type === "supplier") continue;
    const name = text(raw.name, 255);
    if (!name) continue;
    const contact = contactFrom({
      name,
      ico: raw.registration_no,
      dic: raw.vat_no,
      email: raw.email,
      phone: raw.phone,
      street: raw.street,
      city: raw.city,
      postCode: raw.zip,
      country: raw.country,
    });
    const key = contact.ico ?? name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // full_name is the contact person. Fakturoid invoices carry no such field,
    // so imported invoices keep none; new ones for this customer get it prefilled.
    const contactPerson = text(raw.full_name, 255);
    const internalNote = longText(raw.private_note, 2000);
    out.push({ ...contact, ...(contactPerson ? { contactPerson } : {}), ...(internalNote ? { internalNote } : {}) });
  }
  return out;
}

/** The Fakturoid account as business details, or null when it has none of them. */
export function mapFakturoidAccount(account: FakturoidAccount | null): ImportedBusinessDetails | null {
  if (!account) return null;
  const out: ImportedBusinessDetails = {};
  const ico = (account.registration_no ?? "").replace(/\s/g, "");
  if (isIco(ico)) out.ico = ico;
  const dic = (account.vat_no ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (isVatId(dic)) out.dic = dic;
  const street = text(account.street, 255);
  const city = text(account.city, 255);
  if (street && city && !isEmail(street)) {
    out.addressStreet = street;
    out.addressCity = city;
    const zip = text(account.zip, 10);
    if (zip) out.addressPostalCode = zip;
    out.addressCountry = normalizeCountry(account.country ?? undefined) ?? "CZ";
  }
  return Object.keys(out).length > 0 ? out : null;
}
