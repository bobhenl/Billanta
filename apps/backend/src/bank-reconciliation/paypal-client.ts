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

/** "2026-09-30T14:03:11+0000" → that calendar day at UTC midnight (same as the other sources). */
function parseDay(raw: string | null | undefined): Date | null {
  const match = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
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
      amount: amount.toFixed(2),
      currency,
      variableSymbol: extractVariableSymbol([info.invoice_id, info.custom_field, info.transaction_subject, info.transaction_note]),
      counterpartyAccount: payer?.email_address?.trim() || null,
      counterpartyName: name,
      fee: fee !== null && fee !== 0 ? Math.abs(fee).toFixed(2) : null,
      netAmount: converted && converted.currency !== currency ? converted.amount.toFixed(2) : null,
      netCurrency: converted && converted.currency !== currency ? converted.currency : null,
      message: [info.transaction_subject, info.transaction_note].map((t) => t?.trim()).filter(Boolean).join(" – ") || null,
      payerCountry: payer?.country_code?.trim().toUpperCase().slice(0, 2) || null,
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
  const byReference = new Map<string, { amount: number; currency: string }>();
  const byTime = new Map<string, { amount: number; currency: string }>();
  const byNet = new Map<string, { amount: number; currency: string }>();
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
  for (const credit of credits) {
    const { info } = credit;
    const value = { amount: credit.amount, currency: credit.currency };
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
    if (debit) byNet.set(netKey(debit.info.transaction_initiation_date, debit.currency, debit.amount), value);
  }
  return { byReference, byTime, byNet };
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

  /** Incoming payments between `from` and `to`, read in 31-day windows. */
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
        fields: "transaction_info,payer_info",
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
      rows.push(...parsePaypalTransactions(body.transaction_details));
      if (!body.total_pages || page >= body.total_pages) break;
    }
    return rows;
  }
}
