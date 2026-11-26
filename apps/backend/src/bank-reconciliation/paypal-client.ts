import type { ParsedBankTransactionRow } from "./csv-parser";
import { extractVariableSymbol } from "./enable-banking-client";

/**
 * Minimal client for the PayPal Transaction Search API
 * (https://developer.paypal.com/docs/api/transaction-search/v1/). The
 * company creates a REST app in the PayPal developer dashboard with the
 * "Transaction search" feature enabled and pastes its client id and secret.
 * The credentials only read transactions here.
 *
 * PayPal publishes transactions with a delay of up to about 3 hours and
 * limits one query to 31 days, so longer periods are read in windows.
 */

export class PaypalApiError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_credentials" | "reporting_disabled" | "rate_limited" | "unavailable" | "bad_response",
  ) {
    super(message);
  }
}

export interface PaypalCredentials {
  clientId: string;
  secret: string;
  sandbox: boolean;
}

export interface PaypalSyncedRow extends ParsedBankTransactionRow {
  /** `paypal:<transaction id>`, unique per PayPal account. */
  externalId: string;
  /** When the payment was made, to the second. */
  occurredAt: Date | null;
  /** Fee PayPal kept, positive decimal string in `currency`, or null. */
  fee: string | null;
  /**
   * What PayPal credited after converting the payment to another currency
   * (fee and PayPal's rate applied), or null when it stayed in `currency`.
   */
  netAmount: string | null;
  netCurrency: string | null;
  /** Two-letter country of the payer's PayPal account, for a new contact. */
  payerCountry: string | null;
  /** A withdrawal to the company's bank (parsePaypalWithdrawals), not a payment. */
  withdrawal?: boolean;
  /**
   * A conversion of the PayPal balance (parsePaypalConversions): `amount` in
   * `currency` is what came out of it, `conversion` what went in. Not a payment.
   */
  conversion?: { amount: string; currency: string };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 31 * DAY_MS;
const MAX_PAGES = 20;

/** The 31-day windows PayPal accepts, oldest first, each ending a second before the next starts. */
export function paypalWindows(from: Date, to: Date): { from: Date; to: Date }[] {
  const windows: { from: Date; to: Date }[] = [];
  for (let start = from.getTime(); start < to.getTime(); start += MAX_WINDOW_MS) {
    windows.push({ from: new Date(start), to: new Date(Math.min(start + MAX_WINDOW_MS - 1000, to.getTime())) });
  }
  return windows;
}

/**
 * What a history download reads: from the start of the requested day up to
 * now. Transaction Search serves three years back; a day of margin keeps the
 * first window inside it. Up to now rather than to the first sync, so rows
 * stored earlier get their conversion filled in too (see `missingNets`).
 * Null when the requested day is not in the past.
 */
export function paypalBackfillRange(requested: Date, now: Date): { from: Date; to: Date } | null {
  const earliest = Date.UTC(now.getUTCFullYear() - 3, now.getUTCMonth(), now.getUTCDate() + 1);
  const day = Date.UTC(requested.getUTCFullYear(), requested.getUTCMonth(), requested.getUTCDate());
  const from = Math.max(day, earliest);
  return from < now.getTime() ? { from: new Date(from), to: now } : null;
}

/**
 * Where a manual sync starts reading. Normally `from` (a few days back), but
 * a draft still waiting for PayPal's item names (`oldestUnnamed`, a stored
 * Prague day) pulls it back so the re-read fills them in; one year at most.
 */
export function paypalSyncFrom(from: Date, oldestUnnamed: Date | null, now: Date): Date {
  if (!oldestUnnamed) return from;
  // The stored day is Prague's; the payment may sit on the UTC day before.
  const start = Math.max(oldestUnnamed.getTime() - DAY_MS, now.getTime() - 366 * DAY_MS);
  return start < from.getTime() ? new Date(start) : from;
}

export function paypalBaseUrl(sandbox: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PAYPAL_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  return sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

type Money = { currency_code?: string | null; value?: string | number | null } | null | undefined;
type RawDetail = {
  transaction_info?: {
    transaction_id?: string | null;
    paypal_reference_id?: string | null;
    transaction_event_code?: string | null;
    transaction_initiation_date?: string | null;
    transaction_amount?: Money;
    fee_amount?: Money;
    transaction_status?: string | null;
    transaction_subject?: string | null;
    transaction_note?: string | null;
    invoice_id?: string | null;
    custom_field?: string | null;
  } | null;
  cart_info?: {
    item_details?: { item_name?: string | null; item_quantity?: string | null }[] | null;
  } | null;
  payer_info?: {
    email_address?: string | null;
    country_code?: string | null;
    payer_name?: { given_name?: string | null; surname?: string | null; alternate_full_name?: string | null } | null;
  } | null;
};

function money(value: Money): number | null {
  const n = Number(value?.value);
  return value?.value === undefined || value?.value === null || !Number.isFinite(n) ? null : n;
}

const PRAGUE_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * "2026-09-30T23:30:00+0000" → the calendar day in Prague (here Oct 1) at UTC
 * midnight, like the other sources. PayPal's API answers in UTC; a payment
 * late in the evening belongs to the next day on the invoice (DUZP) and in
 * the books, which is also what PayPal's own site shows a CZ/SK account.
 */
export function parseDay(raw: string | null | undefined): Date | null {
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss, zone] = match;
  if (hh === undefined) return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const offset = !zone || zone === "Z" ? "Z" : zone.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const instant = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}${offset}`);
  if (Number.isNaN(instant.getTime())) return null;
  const [py, pm, pd] = PRAGUE_DAY.format(instant).split("-").map(Number);
  return new Date(Date.UTC(py, pm - 1, pd));
}

/** The exact moment of a PayPal timestamp, or null for a bare day. */
export function parseInstant(raw: string | null | undefined): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return null;
  const instant = new Date(raw);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** What was paid for: the item names of a PayPal invoice or cart ("2× Logo"), when PayPal sends them. */
function itemsOf(detail: RawDetail): string | null {
  const names = (detail.cart_info?.item_details ?? [])
    .map((item) => {
      const name = item?.item_name?.trim();
      const qty = Number(item?.item_quantity);
      return name ? (Number.isFinite(qty) && qty > 1 ? `${qty}× ${name}` : name) : null;
    })
    .filter(Boolean);
  return names.length ? names.join("; ") : null;
}

/**
 * Keeps completed incoming payments only: event codes T00xx (payments
 * received) with status S and a positive amount. Transfers to the bank,
 * currency conversions, top-ups and refunds are not invoice payments.
 */
export function parsePaypalTransactions(details: unknown): PaypalSyncedRow[] {
  if (!Array.isArray(details)) return [];
  const conversions = conversionCredits(details as RawDetail[]);
  const rows: PaypalSyncedRow[] = [];
  for (const detail of details as RawDetail[]) {
    const info = detail?.transaction_info;
    if (!info?.transaction_id) continue;
    if (info.transaction_status !== "S") continue;
    if (!info.transaction_event_code?.startsWith("T00")) continue;
    const amount = money(info.transaction_amount);
    const transactionDate = parseDay(info.transaction_initiation_date);
    if (amount === null || amount <= 0 || !transactionDate) continue;

    const fee = money(info.fee_amount);
    const currency = (info.transaction_amount?.currency_code ?? "EUR").toUpperCase().slice(0, 3);
    const converted =
      conversions.byReference.get(info.transaction_id) ??
      conversions.byTime.get(`${info.transaction_initiation_date}|${currency}`) ??
      conversions.byNet.get(netKey(info.transaction_initiation_date, currency, amount - Math.abs(fee ?? 0))) ??
      null;
    const payer = detail.payer_info;
    const name =
      payer?.payer_name?.alternate_full_name?.trim() ||
      [payer?.payer_name?.given_name, payer?.payer_name?.surname].filter(Boolean).join(" ").trim() ||
      null;
    rows.push({
      externalId: `paypal:${info.transaction_id}`,
      transactionDate,
      occurredAt: parseInstant(info.transaction_initiation_date),
      amount: amount.toFixed(2),
      currency,
      variableSymbol: extractVariableSymbol([info.invoice_id, info.custom_field, info.transaction_subject, info.transaction_note]),
      counterpartyAccount: payer?.email_address?.trim() || null,
      counterpartyName: name,
      fee: fee !== null && fee !== 0 ? Math.abs(fee).toFixed(2) : null,
      netAmount: converted && converted.currency !== currency ? converted.amount.toFixed(2) : null,
      netCurrency: converted && converted.currency !== currency ? converted.currency : null,
      // The items say what was paid for; a subject or note is the fallback (often just "Invoice 12").
      message: itemsOf(detail) ?? ([info.transaction_subject, info.transaction_note].map((t) => t?.trim()).filter(Boolean).join(" – ") || null),
      payerCountry: payer?.country_code?.trim().toUpperCase().slice(0, 2) || null,
    });
  }
  return rows;
}

/**
 * Money the company moved from PayPal to its bank (event codes T04xx,
 * negative amounts). Not income: the payments it consists of are already
 * counted, so the bank credit it becomes is paired with it and both stay out
 * of the totals (transfer-pairing.ts).
 */
export function parsePaypalWithdrawals(details: unknown): PaypalSyncedRow[] {
  if (!Array.isArray(details)) return [];
  const rows: PaypalSyncedRow[] = [];
  for (const detail of details as RawDetail[]) {
    const info = detail?.transaction_info;
    if (!info?.transaction_id || info.transaction_status !== "S") continue;
    if (!info.transaction_event_code?.startsWith("T04")) continue;
    const amount = money(info.transaction_amount);
    const transactionDate = parseDay(info.transaction_initiation_date);
    if (amount === null || amount >= 0 || !transactionDate) continue;
    rows.push({
      externalId: `paypal:${info.transaction_id}`,
      transactionDate,
      occurredAt: parseInstant(info.transaction_initiation_date),
      amount: amount.toFixed(2),
      currency: (info.transaction_amount?.currency_code ?? "EUR").toUpperCase().slice(0, 3),
      variableSymbol: null,
      counterpartyAccount: null,
      counterpartyName: null,
      fee: null,
      netAmount: null,
      netCurrency: null,
      message: null,
      payerCountry: null,
      withdrawal: true,
    });
  }
  return rows;
}

const netKey = (time: string | null | undefined, currency: string, amount: number) =>
  `${time?.slice(0, 10)}|${currency}|${Math.abs(amount).toFixed(2)}`;

/**
 * The credit legs of PayPal's currency conversions (event T0200): with
 * auto-conversion on, a received USD payment is followed by a USD debit and
 * a CZK credit. The credit usually points at the payment through
 * `paypal_reference_id`, or at the debit leg that does. When neither does,
 * it shares the payment's timestamp, keyed by the currency it was converted
 * from (the debit leg's). Last resort: PayPal converts what is left after
 * the fee, so a debit of exactly the payment's net on the same day is it.
 */
function conversionCredits(details: RawDetail[]) {
  const byReference = new Map<string, ConversionCredit>();
  const byTime = new Map<string, ConversionCredit>();
  const byNet = new Map<string, ConversionCredit>();
  type Leg = { info: NonNullable<RawDetail["transaction_info"]>; amount: number; currency: string };
  const debits: Leg[] = [];
  const credits: Leg[] = [];
  for (const detail of details) {
    const info = detail?.transaction_info;
    if (!info || info.transaction_event_code !== "T0200" || info.transaction_status !== "S") continue;
    const amount = money(info.transaction_amount);
    const currency = info.transaction_amount?.currency_code?.toUpperCase().slice(0, 3);
    if (amount === null || !currency) continue;
    if (amount < 0) debits.push({ info, amount, currency });
    else if (amount > 0) credits.push({ info, amount, currency });
  }
  const all: ConversionCredit[] = [];
  for (const credit of credits) {
    const { info } = credit;
    const value: ConversionCredit = { amount: credit.amount, currency: credit.currency, info };
    all.push(value);
    const sameTime = debits.find((d) => d.info.transaction_initiation_date === info.transaction_initiation_date);
    const linked =
      debits.find((d) => info.paypal_reference_id && d.info.transaction_id === info.paypal_reference_id) ??
      debits.find((d) => d.info.paypal_reference_id && d.info.paypal_reference_id === info.transaction_id) ??
      debits.find((d) => info.paypal_reference_id && d.info.paypal_reference_id === info.paypal_reference_id);
    if (info.paypal_reference_id) byReference.set(info.paypal_reference_id, value);
    const payment = linked?.info.paypal_reference_id;
    if (payment && !byReference.has(payment)) byReference.set(payment, value);
    if (sameTime) byTime.set(`${info.transaction_initiation_date}|${sameTime.currency}`, value);
    const debit = linked ?? sameTime;
    if (debit) {
      value.from = { amount: Math.abs(debit.amount), currency: debit.currency };
      byNet.set(netKey(debit.info.transaction_initiation_date, debit.currency, debit.amount), value);
    }
  }
  return { byReference, byTime, byNet, all };
}

type ConversionCredit = {
  amount: number;
  currency: string;
  info: NonNullable<RawDetail["transaction_info"]>;
  /** The debit leg: what was converted. */
  from?: { amount: number; currency: string };
};

/**
 * Conversions of the balance that no single payment claims. Without
 * auto-conversion PayPal keeps a USD payment in USD and converts the balance
 * only when the company withdraws it, at its own rate; that rate is what the
 * payments in it were really worth (paypal-conversions.ts spreads it).
 */
export function parsePaypalConversions(details: unknown): PaypalSyncedRow[] {
  if (!Array.isArray(details)) return [];
  const conversions = conversionCredits(details as RawDetail[]);
  const claimed = new Set<ConversionCredit>();
  for (const detail of details as RawDetail[]) {
    const info = detail?.transaction_info;
    if (!info?.transaction_id || info.transaction_status !== "S" || !info.transaction_event_code?.startsWith("T00")) continue;
    const amount = money(info.transaction_amount);
    if (amount === null || amount <= 0) continue;
    const currency = (info.transaction_amount?.currency_code ?? "EUR").toUpperCase().slice(0, 3);
    const fee = money(info.fee_amount);
    const hit =
      conversions.byReference.get(info.transaction_id) ??
      conversions.byTime.get(`${info.transaction_initiation_date}|${currency}`) ??
      conversions.byNet.get(netKey(info.transaction_initiation_date, currency, amount - Math.abs(fee ?? 0)));
    if (hit) claimed.add(hit);
  }
  const rows: PaypalSyncedRow[] = [];
  for (const c of conversions.all) {
    const transactionDate = parseDay(c.info.transaction_initiation_date);
    if (claimed.has(c) || !c.from || c.from.currency === c.currency || !c.info.transaction_id || !transactionDate) continue;
    rows.push({
      externalId: `paypal:${c.info.transaction_id}`,
      transactionDate,
      occurredAt: parseInstant(c.info.transaction_initiation_date),
      amount: c.amount.toFixed(2),
      currency: c.currency,
      variableSymbol: null,
      counterpartyAccount: null,
      counterpartyName: null,
      fee: null,
      netAmount: null,
      netCurrency: null,
      // The frontend tells a conversion row by this arrow (paypalMovement in bank-ui.ts).
      message: `${c.from.amount.toFixed(2)} ${c.from.currency} → ${c.amount.toFixed(2)} ${c.currency}`,
      payerCountry: null,
      conversion: { amount: c.from.amount.toFixed(2), currency: c.from.currency },
    });
  }
  return rows;
}

/** PayPal wants RFC 3339 without fractions. */
function paypalTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class PaypalClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly credentials: PaypalCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = paypalBaseUrl(credentials.sandbox),
  ) {}

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new PaypalApiError("PayPal API is not reachable", "unavailable");
    }
  }

  async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const basic = Buffer.from(`${this.credentials.clientId}:${this.credentials.secret}`).toString("base64");
    const response = await this.request(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials",
    });
    if (response.status === 401 || response.status === 400) {
      throw new PaypalApiError("PayPal rejected the client id or secret", "invalid_credentials");
    }
    if (response.status === 429) throw new PaypalApiError("PayPal rate limit", "rate_limited");
    if (!response.ok) throw new PaypalApiError(`PayPal OAuth answered ${response.status}`, "unavailable");
    const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!body?.access_token) throw new PaypalApiError("PayPal OAuth response has no token", "bad_response");
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3000) * 1000 };
    return body.access_token;
  }

  /** Incoming payments, withdrawals to the bank and balance conversions between `from` and `to`, read in 31-day windows. */
  async fetchIncoming(from: Date, to: Date = new Date()): Promise<PaypalSyncedRow[]> {
    const rows: PaypalSyncedRow[] = [];
    // One window after another: PayPal rate-limits parallel reporting calls.
    for (const window of paypalWindows(from, to)) rows.push(...(await this.fetchWindow(window.from, window.to)));
    return rows;
  }

  private async fetchWindow(from: Date, to: Date): Promise<PaypalSyncedRow[]> {
    const rows: PaypalSyncedRow[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        start_date: paypalTime(from),
        end_date: paypalTime(to),
        fields: "transaction_info,payer_info,cart_info",
        transaction_status: "S",
        page_size: "500",
        page: String(page),
      });
      const response = await this.request(`${this.baseUrl}/v1/reporting/transactions?${params}`, {
        headers: { Authorization: `Bearer ${await this.token()}`, Accept: "application/json" },
      });
      if (response.status === 401) throw new PaypalApiError("PayPal rejected the access token", "invalid_credentials");
      if (response.status === 403) throw new PaypalApiError("Transaction search is not enabled for this app", "reporting_disabled");
      if (response.status === 429) throw new PaypalApiError("PayPal rate limit", "rate_limited");
      if (!response.ok) throw new PaypalApiError(`PayPal reporting answered ${response.status}`, "unavailable");
      const body = (await response.json().catch(() => null)) as
        | { transaction_details?: unknown; total_pages?: number; page?: number }
        | null;
      if (!body) throw new PaypalApiError("PayPal response is not JSON", "bad_response");
      rows.push(
        ...parsePaypalTransactions(body.transaction_details),
        ...parsePaypalWithdrawals(body.transaction_details),
        ...parsePaypalConversions(body.transaction_details),
      );
      if (!body.total_pages || page >= body.total_pages) break;
    }
    return rows;
  }
}
