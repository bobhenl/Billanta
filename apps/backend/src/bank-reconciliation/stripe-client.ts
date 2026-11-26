import type { ParsedBankTransactionRow } from "./csv-parser";
import { extractVariableSymbol } from "./enable-banking-client";
import { parseDay } from "./paypal-client";

/**
 * Minimal client for Stripe's balance transactions
 * (https://docs.stripe.com/api/balance_transactions/list). The company
 * creates a restricted key with read access to balance transactions,
 * charges and customers and pastes it here. The key only reads.
 *
 * This is separate from card payments on the invoice link
 * (`src/card-payments/`): that books Billanta's own checkouts, this pulls
 * every payment the account received, e.g. from Stripe Payment Links or a
 * web shop, and matches it like a bank payment.
 */

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_credentials" | "permissions_missing" | "rate_limited" | "unavailable" | "bad_response",
  ) {
    super(message);
  }
}

/** Restricted keys only: a full secret key (sk_) could write, and we never need it to. */
export const STRIPE_RESTRICTED_KEY_PATTERN = /^rk_(live|test)_[A-Za-z0-9]{16,}$/;

export interface StripeSyncedRow extends ParsedBankTransactionRow {
  /** When Stripe recorded the payment, to the second. */
  occurredAt: Date | null;
  /** `stripe:<charge or payment id>` (the balance transaction id when Stripe sent no source), as in the CSV import. */
  externalId: string;
  /** Fee Stripe kept, positive decimal string in `currency`, or null. */
  fee: string | null;
  /**
   * What Stripe credited to a balance in another currency (after its fee and
   * rate), or null when the payment stayed in `currency`.
   */
  netAmount: string | null;
  netCurrency: string | null;
  /** Two-letter country from the card's billing address, for a new contact. */
  payerCountry: string | null;
}

/** Stripe's zero-decimal currencies (https://docs.stripe.com/currencies#zero-decimal). */
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
/** Payments land here; payouts, refunds, fees and adjustments are not invoice payments. */
const INCOMING_TYPES = ["charge", "payment"] as const;
const MAX_PAGES = 20;
/** A history download may read up to 10,000 payments per type. */
export const STRIPE_BACKFILL_MAX_PAGES = 100;
const PAGE_SIZE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Metadata keys a shop or Stripe integration commonly uses for the invoice number. */
const INVOICE_METADATA_KEYS = ["variable_symbol", "vs", "invoice_number", "invoice_no", "invoice", "faktura", "cislo_faktury"];

export function stripeBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.STRIPE_API_BASE_URL?.trim();
  return override ? override.replace(/\/$/, "") : "https://api.stripe.com";
}

export function fromStripeMinor(minor: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? minor : minor / 100;
}

type RawCustomer = { name?: string | null; email?: string | null; deleted?: boolean } | string | null | undefined;
type RawCharge = {
  id?: string | null;
  object?: string;
  amount?: number | null;
  amount_captured?: number | null;
  currency?: string | null;
  status?: string | null;
  paid?: boolean | null;
  refunded?: boolean | null;
  description?: string | null;
  metadata?: Record<string, string> | null;
  billing_details?: { name?: string | null; email?: string | null; address?: { country?: string | null } | null } | null;
  customer?: RawCustomer;
};
type RawBalanceTransaction = {
  id?: string | null;
  type?: string | null;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
  fee?: number | null;
  net?: number | null;
  exchange_rate?: number | null;
  created?: number | null;
  description?: string | null;
  source?: RawCharge | string | null;
};

/**
 * Unix seconds → the calendar day in Prague, at UTC midnight, the same rule
 * as PayPal (`parseDay`). A payment at 23:30 UTC is already the next day for
 * a Czech company and its tax date.
 */
export function stripeDay(created: number | null | undefined): Date | null {
  if (typeof created !== "number" || !Number.isFinite(created)) return null;
  return parseDay(new Date(created * 1000).toISOString());
}

function metadataInvoiceNumber(metadata: Record<string, string> | null | undefined): string | null {
  if (!metadata) return null;
  for (const wanted of INVOICE_METADATA_KEYS) {
    const key = Object.keys(metadata).find((k) => k.toLowerCase() === wanted);
    const value = key ? metadata[key]?.trim() : "";
    if (value) return value;
  }
  return null;
}

/**
 * Keeps received payments only: balance transactions of type charge or
 * payment, available or pending, with a positive amount and a charge that
 * was paid and not refunded in full. The amount and fee are in the charge
 * currency, the one the customer paid and the invoice was issued in; when
 * Stripe settled into another balance currency the fee is converted back
 * with the transaction's `exchange_rate`.
 */
export function parseStripeBalanceTransactions(data: unknown): StripeSyncedRow[] {
  if (!Array.isArray(data)) return [];
  const rows: StripeSyncedRow[] = [];
  for (const bt of data as RawBalanceTransaction[]) {
    if (!bt?.id || !bt.currency) continue;
    if (!(INCOMING_TYPES as readonly string[]).includes(bt.type ?? "")) continue;
    if (bt.status !== "available" && bt.status !== "pending") continue;
    const transactionDate = stripeDay(bt.created);
    if (!transactionDate || typeof bt.amount !== "number" || bt.amount <= 0) continue;

    const charge = bt.source && typeof bt.source === "object" ? bt.source : null;
    if (charge?.refunded === true || charge?.paid === false || charge?.status === "failed") continue;
    // Billanta's own card checkout on the invoice link already marked the invoice paid.
    if (charge?.metadata?.invoice_id && UUID.test(charge.metadata.invoice_id)) continue;

    const balanceCurrency = bt.currency.toUpperCase();
    const chargeMinor = charge?.amount_captured || charge?.amount;
    const chargeCurrency = charge?.currency && typeof chargeMinor === "number" ? charge.currency.toUpperCase() : null;
    const currency = chargeCurrency ?? balanceCurrency;
    const amount = chargeCurrency ? fromStripeMinor(chargeMinor!, chargeCurrency) : fromStripeMinor(bt.amount, balanceCurrency);

    let fee: number | null = null;
    if (typeof bt.fee === "number" && bt.fee > 0) {
      const settled = fromStripeMinor(bt.fee, balanceCurrency);
      if (currency === balanceCurrency) fee = settled;
      else if (bt.exchange_rate) fee = settled / bt.exchange_rate;
    }
    // `net` is in the balance currency: worth keeping only when it differs from what the customer paid in.
    const converted = currency !== balanceCurrency && typeof bt.net === "number" && bt.net > 0;

    // Keyed by the charge (ch_…/py_…) like the CSV imports in fintech-csv.ts, so an
    // uploaded Stripe export and this sync never store the same payment twice.
    const sourceId = typeof bt.source === "string" ? bt.source : charge?.id;
    const customer = charge?.customer && typeof charge.customer === "object" && !charge.customer.deleted ? charge.customer : null;
    const description = charge?.description ?? bt.description ?? null;
    const invoiceNumber = metadataInvoiceNumber(charge?.metadata);
    rows.push({
      externalId: `stripe:${sourceId?.trim() || bt.id}`,
      transactionDate,
      occurredAt: new Date(bt.created! * 1000),
      amount: amount.toFixed(2),
      currency: currency.slice(0, 3),
      // Metadata is set by the merchant's own checkout, so it beats a "VS" typed into the description.
      variableSymbol:
        (invoiceNumber ? extractVariableSymbol([invoiceNumber]) : null) ??
        extractVariableSymbol([description]) ??
        invoiceNumber?.slice(0, 20) ??
        null,
      counterpartyAccount: charge?.billing_details?.email?.trim() || customer?.email?.trim() || null,
      counterpartyName: charge?.billing_details?.name?.trim() || customer?.name?.trim() || null,
      message: description,
      fee: fee !== null ? fee.toFixed(2) : null,
      netAmount: converted ? fromStripeMinor(bt.net!, balanceCurrency).toFixed(2) : null,
      netCurrency: converted ? balanceCurrency : null,
      payerCountry: charge?.billing_details?.address?.country?.trim().toUpperCase().slice(0, 2) || null,
    });
  }
  return rows;
}

export class StripeClient {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = stripeBaseUrl(),
  ) {}

  private async request(url: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.secretKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new StripeApiError("Stripe API is not reachable", "unavailable");
    }
  }

  /** Received payments created from `from` (up to `to`), newest first per type. */
  async fetchIncoming(from: Date, to?: Date, maxPages = MAX_PAGES): Promise<StripeSyncedRow[]> {
    const rows: StripeSyncedRow[] = [];
    for (const type of INCOMING_TYPES) rows.push(...(await this.fetchType(type, from, to, maxPages)));
    return rows;
  }

  private async fetchType(type: string, from: Date, to: Date | undefined, maxPages: number): Promise<StripeSyncedRow[]> {
    const rows: StripeSyncedRow[] = [];
    let startingAfter: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), type, "created[gte]": String(Math.floor(from.getTime() / 1000)) });
      if (to) params.set("created[lte]", String(Math.floor(to.getTime() / 1000)));
      params.append("expand[]", "data.source");
      params.append("expand[]", "data.source.customer");
      if (startingAfter) params.set("starting_after", startingAfter);
      const response = await this.request(`${this.baseUrl}/v1/balance_transactions?${params}`);
      // Stripe's error bodies can echo part of the key: they are never read or logged.
      if (response.status === 401) throw new StripeApiError("Stripe rejected the key", "invalid_credentials");
      if (response.status === 403) throw new StripeApiError("The restricted key lacks a read permission", "permissions_missing");
      if (response.status === 429) throw new StripeApiError("Stripe rate limit", "rate_limited");
      if (!response.ok) throw new StripeApiError(`Stripe answered ${response.status}`, "unavailable");
      const body = (await response.json().catch(() => null)) as { data?: unknown; has_more?: boolean } | null;
      if (!body || !Array.isArray(body.data)) throw new StripeApiError("Stripe response is not a list", "bad_response");
      rows.push(...parseStripeBalanceTransactions(body.data));
      const last = body.data[body.data.length - 1] as { id?: string } | undefined;
      if (!body.has_more || !last?.id) break;
      startingAfter = last.id;
    }
    return rows;
  }
}
