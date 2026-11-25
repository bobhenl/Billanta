import { describe, expect, it, vi } from "vitest";
import { parseBankStatementCsv } from "./csv-parser";
import {
  STRIPE_RESTRICTED_KEY_PATTERN,
  StripeApiError,
  StripeClient,
  fromStripeMinor,
  parseStripeBalanceTransactions,
  stripeBaseUrl,
  stripeDay,
} from "./stripe-client";

const KEY = "rk_" + "test_" + "xxAbCdEfGhIjKlMnOpQrStUv";
/** 2026-09-30 12:00 UTC */
const NOON = Date.UTC(2026, 8, 30, 12) / 1000;

function charge(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch_1A",
    object: "charge",
    amount: 12100,
    amount_captured: 12100,
    currency: "eur",
    status: "succeeded",
    paid: true,
    refunded: false,
    description: "Faktura VS 2026014",
    metadata: {},
    billing_details: { name: "Jana Nováková", email: "jana@example.test", address: { country: "sk" } },
    customer: null,
    ...overrides,
  };
}

function bt(overrides: Record<string, unknown> = {}, source: Record<string, unknown> | string | null = charge()) {
  return {
    id: "txn_1A",
    object: "balance_transaction",
    type: "charge",
    status: "available",
    amount: 12100,
    currency: "eur",
    fee: 197,
    net: 11903,
    exchange_rate: null,
    created: NOON,
    source,
    ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("parseStripeBalanceTransactions", () => {
  it("maps a charge with its fee and payer", () => {
    expect(parseStripeBalanceTransactions([bt()])).toEqual([
      {
        externalId: "stripe:ch_1A",
        transactionDate: new Date(Date.UTC(2026, 8, 30)),
        amount: "121.00",
        currency: "EUR",
        variableSymbol: "2026014",
        counterpartyAccount: "jana@example.test",
        counterpartyName: "Jana Nováková",
        message: "Faktura VS 2026014",
        fee: "1.97",
        netAmount: null,
        netCurrency: null,
        payerCountry: "SK",
      },
    ]);
  });

  it("keys a charge like the Stripe CSV import, so an uploaded export and the sync dedupe", () => {
    const csv = [
      "id,Created (UTC),Amount,Amount Refunded,Currency,Captured,Fee,Status,Description",
      "ch_1A,2026-09-30 12:00:00,121.00,0.00,eur,true,1.97,Paid,Faktura VS 2026014",
    ].join("\n");
    const [fromCsv] = parseBankStatementCsv(csv);
    const [fromApi] = parseStripeBalanceTransactions([bt()]);
    expect(fromApi).toMatchObject({ externalId: fromCsv!.externalId, transactionDate: fromCsv!.transactionDate, amount: fromCsv!.amount });
    // An unexpanded source is its id; with no source at all the balance transaction id is the key.
    expect(parseStripeBalanceTransactions([bt({}, "py_9")])[0]!.externalId).toBe("stripe:py_9");
    expect(parseStripeBalanceTransactions([bt({}, null)])[0]!.externalId).toBe("stripe:txn_1A");
  });

  it("puts a payment at 23:30 UTC on the next Prague day", () => {
    const [row] = parseStripeBalanceTransactions([bt({ created: Date.UTC(2026, 8, 30, 23, 30) / 1000 })]);
    expect(row!.transactionDate).toEqual(new Date(Date.UTC(2026, 9, 1)));
    // Winter time (UTC+1): 22:59 UTC is still the same day, 23:00 is the next.
    expect(stripeDay(Date.UTC(2026, 11, 31, 22, 59) / 1000)).toEqual(new Date(Date.UTC(2026, 11, 31)));
    expect(stripeDay(Date.UTC(2026, 11, 31, 23, 0) / 1000)).toEqual(new Date(Date.UTC(2027, 0, 1)));
  });

  it("prefers the invoice number from metadata over the description", () => {
    const [row] = parseStripeBalanceTransactions([bt({}, charge({ metadata: { Invoice_Number: "2026077" }, description: "Objednávka VS 99" }))]);
    expect(row!.variableSymbol).toBe("2026077");
  });

  it("falls back to the customer when the charge has no billing details", () => {
    const [row] = parseStripeBalanceTransactions([
      bt({}, charge({ billing_details: { name: null, email: null }, customer: { name: "ACME s.r.o.", email: "acme@example.test" } })),
    ]);
    expect(row).toMatchObject({ counterpartyName: "ACME s.r.o.", counterpartyAccount: "acme@example.test" });
  });

  it("keeps the charge currency, converts the fee back and keeps the net when Stripe settled into another currency", () => {
    // 100.00 EUR charge settled as 2 500.00 CZK at 25.0, fee 87.50 CZK = 3.50 EUR, 2 412.50 CZK credited.
    const [row] = parseStripeBalanceTransactions([
      bt(
        { amount: 250000, currency: "czk", fee: 8750, net: 241250, exchange_rate: 25 },
        charge({ amount: 10000, amount_captured: 10000, currency: "eur" }),
      ),
    ]);
    expect(row).toMatchObject({ amount: "100.00", currency: "EUR", fee: "3.50", netAmount: "2412.50", netCurrency: "CZK" });
  });

  it("leaves the fee empty when a conversion has no exchange rate", () => {
    const [row] = parseStripeBalanceTransactions([bt({ amount: 250000, currency: "czk", fee: 8750 }, charge({ amount: 10000, currency: "eur" }))]);
    expect(row!.fee).toBeNull();
  });

  it("reads zero-decimal currencies as whole units", () => {
    const [row] = parseStripeBalanceTransactions([bt({ amount: 5000, currency: "jpy", fee: 180 }, charge({ amount: 5000, amount_captured: 5000, currency: "jpy" }))]);
    expect(row).toMatchObject({ amount: "5000.00", currency: "JPY", fee: "180.00" });
    expect(fromStripeMinor(5000, "czk")).toBe(50);
  });

  it("uses the balance amount when the source was not expanded", () => {
    const [row] = parseStripeBalanceTransactions([bt({ type: "payment", status: "pending" }, "py_123")]);
    expect(row).toMatchObject({ amount: "121.00", currency: "EUR", counterpartyName: null, variableSymbol: null });
  });

  it("skips payouts, refunds, fees, adjustments, refunded charges and Billanta checkouts", () => {
    expect(
      parseStripeBalanceTransactions([
        bt({ type: "payout", amount: -50000 }),
        bt({ type: "refund", amount: -12100 }),
        bt({ type: "stripe_fee", amount: -500 }),
        bt({ type: "adjustment", amount: 300 }),
        bt({ amount: -100 }),
        bt({ status: "void" }),
        bt({}, charge({ refunded: true })),
        bt({}, charge({ paid: false })),
        bt({}, charge({ metadata: { invoice_id: "3f2b8c1e-5d4a-4e7b-9c1d-0a1b2c3d4e5f" } })),
        bt({ id: null }),
      ]),
    ).toEqual([]);
    expect(parseStripeBalanceTransactions(null)).toEqual([]);
  });
});

describe("stripe key and base url", () => {
  it("accepts restricted keys only", () => {
    expect(STRIPE_RESTRICTED_KEY_PATTERN.test(KEY)).toBe(true);
    expect(STRIPE_RESTRICTED_KEY_PATTERN.test("rk_" + "live_" + "xxAbCdEfGhIjKlMnOpQrStUv")).toBe(true);
    expect(STRIPE_RESTRICTED_KEY_PATTERN.test("sk_" + "live_" + "xxAbCdEfGhIjKlMnOpQrStUv")).toBe(false);
    expect(STRIPE_RESTRICTED_KEY_PATTERN.test("rk_" + "test_" + "short")).toBe(false);
  });

  it("allows an override for local tests", () => {
    expect(stripeBaseUrl({})).toBe("https://api.stripe.com");
    expect(stripeBaseUrl({ STRIPE_API_BASE_URL: "http://localhost:9/" })).toBe("http://localhost:9");
  });
});

describe("StripeClient", () => {
  it("asks for charges and payments since `from`, expanded, and follows pages", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [bt({ id: "txn_1" }, charge({ id: "ch_1" }))], has_more: true }))
      .mockResolvedValueOnce(json({ data: [bt({ id: "txn_2" }, charge({ id: "ch_2" }))], has_more: false }))
      .mockResolvedValueOnce(json({ data: [bt({ id: "txn_3", type: "payment" }, "py_3")], has_more: false }));
    const client = new StripeClient(KEY, fetchImpl as unknown as typeof fetch, "https://stripe.test");
    const rows = await client.fetchIncoming(new Date("2026-09-20T00:00:00Z"));

    expect(rows.map((r) => r.externalId)).toEqual(["stripe:ch_1", "stripe:ch_2", "stripe:py_3"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const first = new URL(fetchImpl.mock.calls[0]![0]);
    expect(first.pathname).toBe("/v1/balance_transactions");
    expect(first.searchParams.get("type")).toBe("charge");
    expect(first.searchParams.get("created[gte]")).toBe(String(Date.UTC(2026, 8, 20) / 1000));
    expect(first.searchParams.getAll("expand[]")).toEqual(["data.source", "data.source.customer"]);
    expect(first.searchParams.get("starting_after")).toBeNull();
    expect(first.searchParams.get("created[lte]")).toBeNull();
    expect(new URL(fetchImpl.mock.calls[1]![0]).searchParams.get("starting_after")).toBe("txn_1");
    expect(new URL(fetchImpl.mock.calls[2]![0]).searchParams.get("type")).toBe("payment");
    expect(fetchImpl.mock.calls[0]![1].headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("bounds a history download by `to` and stops at the page cap", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => json({ data: [bt({ id: `txn_${fetchImpl.mock.calls.length}` })], has_more: true }));
    const client = new StripeClient(KEY, fetchImpl as unknown as typeof fetch, "https://stripe.test");
    const rows = await client.fetchIncoming(new Date("2025-01-01T00:00:00Z"), new Date("2026-09-30T12:00:00Z"), 2);

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(rows).toHaveLength(4);
    expect(new URL(fetchImpl.mock.calls[0]![0]).searchParams.get("created[lte]")).toBe(String(NOON));
  });

  it("maps credential and permission errors without the key in the message", async () => {
    const bad = new StripeClient(KEY, vi.fn().mockResolvedValue(json({ error: { message: `Invalid API Key provided: ${KEY}` } }, 401)) as never, "https://stripe.test");
    const err = await bad.fetchIncoming(new Date()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "invalid_credentials" });
    expect((err as Error).message).not.toContain(KEY);

    const forbidden = new StripeClient(KEY, vi.fn().mockResolvedValue(json({ error: { type: "permission_error" } }, 403)) as never, "https://stripe.test");
    await expect(forbidden.fetchIncoming(new Date())).rejects.toMatchObject({ code: "permissions_missing" });

    const limited = new StripeClient(KEY, vi.fn().mockResolvedValue(json({}, 429)) as never, "https://stripe.test");
    await expect(limited.fetchIncoming(new Date())).rejects.toMatchObject({ code: "rate_limited" });

    const offline = new StripeClient(KEY, vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never, "https://stripe.test");
    await expect(offline.fetchIncoming(new Date())).rejects.toBeInstanceOf(StripeApiError);
  });
});
