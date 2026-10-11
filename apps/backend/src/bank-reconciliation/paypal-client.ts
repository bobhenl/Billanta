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
}

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 20;

export function paypalBaseUrl(sandbox: boolean, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PAYPAL_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  return sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

type Money = { currency_code?: string | null; value?: string | number | null } | null | undefined;
type RawDetail = {
  transaction_info?: {
    transaction_id?: string | null;
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
    const payer = detail.payer_info;
    const name =
      payer?.payer_name?.alternate_full_name?.trim() ||
      [payer?.payer_name?.given_name, payer?.payer_name?.surname].filter(Boolean).join(" ").trim() ||
      null;
    rows.push({
      externalId: `paypal:${info.transaction_id}`,
      transactionDate,
      amount: amount.toFixed(2),
      currency: (info.transaction_amount?.currency_code ?? "EUR").toUpperCase().slice(0, 3),
      variableSymbol: extractVariableSymbol([info.invoice_id, info.custom_field, info.transaction_subject, info.transaction_note]),
      counterpartyAccount: payer?.email_address?.trim() || null,
      counterpartyName: name,
      fee: fee !== null && fee !== 0 ? Math.abs(fee).toFixed(2) : null,
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

  /** Incoming payments between `from` and `to`, read in 31-day windows. */
  async fetchIncoming(from: Date, to: Date = new Date()): Promise<PaypalSyncedRow[]> {
    const rows: PaypalSyncedRow[] = [];
    for (let start = from.getTime(); start < to.getTime(); start += MAX_WINDOW_MS) {
      const end = Math.min(start + MAX_WINDOW_MS - 1000, to.getTime());
      rows.push(...(await this.fetchWindow(new Date(start), new Date(end))));
    }
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
