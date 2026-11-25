import { describe, expect, it, vi } from "vitest";
import {
  PaypalApiError,
  PaypalClient,
  parsePaypalTransactions,
  paypalBackfillRange,
  paypalBaseUrl,
  paypalWindows,
} from "./paypal-client";

const credentials = { clientId: "client-id-123", secret: "secret-value-123", sandbox: true };

function detail(overrides: Record<string, unknown> = {}, payer: Record<string, unknown> | null = null) {
  return {
    transaction_info: {
      transaction_id: "9AB12345CD678901E",
      transaction_event_code: "T0006",
      transaction_initiation_date: "2026-09-30T14:03:11+0000",
      transaction_amount: { currency_code: "EUR", value: "121.00" },
      fee_amount: { currency_code: "EUR", value: "-4.48" },
      transaction_status: "S",
      invoice_id: "2026014",
      ...overrides,
    },
    payer_info: payer ?? { email_address: "buyer@example.test", payer_name: { given_name: "Jana", surname: "Nováková" } },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("parsePaypalTransactions", () => {
  it("maps a received payment with its fee", () => {
    expect(parsePaypalTransactions([detail()])).toEqual([
      {
        externalId: "paypal:9AB12345CD678901E",
        transactionDate: new Date(Date.UTC(2026, 8, 30)),
        amount: "121.00",
        currency: "EUR",
        variableSymbol: "2026014",
        counterpartyAccount: "buyer@example.test",
        counterpartyName: "Jana Nováková",
        fee: "4.48",
        netAmount: null,
        netCurrency: null,
        message: null,
        payerCountry: null,
      },
    ]);
  });

  function conversion(amount: string, currency: string, overrides: Record<string, unknown> = {}) {
    return {
      transaction_info: {
        transaction_id: `CONV${currency}${amount}`,
        transaction_event_code: "T0200",
        transaction_initiation_date: "2026-09-30T14:03:11+0000",
        transaction_amount: { currency_code: currency, value: amount },
        transaction_status: "S",
        ...overrides,
      },
    };
  }

  it("takes the converted amount from the conversion that references the payment", () => {
    const [row] = parsePaypalTransactions([
      detail({ transaction_initiation_date: "2026-09-30T10:00:00+0000" }),
      // An unrelated conversion at the payment's second must lose to the reference.
      conversion("-10.00", "EUR", { transaction_initiation_date: "2026-09-30T10:00:00+0000" }),
      conversion("240.00", "CZK", { transaction_initiation_date: "2026-09-30T10:00:00+0000" }),
      conversion("-116.52", "EUR", { paypal_reference_id: "9AB12345CD678901E", transaction_initiation_date: "2026-09-30T10:00:05+0000" }),
      conversion("2803.47", "CZK", { paypal_reference_id: "9AB12345CD678901E", transaction_initiation_date: "2026-09-30T10:00:05+0000" }),
    ]);
    expect(row).toMatchObject({ amount: "121.00", currency: "EUR", netAmount: "2803.47", netCurrency: "CZK" });
  });

  it("pairs a conversion without a reference by its timestamp and source currency", () => {
    const [row] = parsePaypalTransactions([
      detail(),
      conversion("-116.52", "EUR"),
      conversion("2803.47", "CZK"),
    ]);
    expect(row).toMatchObject({ netAmount: "2803.47", netCurrency: "CZK" });
  });

  it("follows a credit that references the debit leg, which references the payment", () => {
    const [row] = parsePaypalTransactions([
      detail(),
      // Not the payment minus its fee, so only the reference chain can pair it.
      conversion("-116.00", "EUR", { transaction_id: "DEBIT1", paypal_reference_id: "9AB12345CD678901E", transaction_initiation_date: "2026-09-30T14:03:40+0000" }),
      conversion("2803.47", "CZK", { paypal_reference_id: "DEBIT1", transaction_initiation_date: "2026-09-30T14:03:41+0000" }),
    ]);
    expect(row).toMatchObject({ netAmount: "2803.47", netCurrency: "CZK" });
  });

  it("falls back to a same-day conversion of exactly the payment minus its fee", () => {
    const payment = detail({ transaction_amount: { currency_code: "USD", value: "45.00" }, fee_amount: { currency_code: "USD", value: "-2.41" } });
    const later = { transaction_initiation_date: "2026-09-30T14:05:00+0000" };
    const [row] = parsePaypalTransactions([
      payment,
      conversion("-10.00", "USD", { transaction_initiation_date: "2026-09-30T09:00:00+0000" }),
      conversion("230.00", "CZK", { transaction_initiation_date: "2026-09-30T09:00:00+0000" }),
      conversion("-42.59", "USD", later),
      conversion("1017.23", "CZK", later),
    ]);
    expect(row).toMatchObject({ amount: "45.00", currency: "USD", netAmount: "1017.23", netCurrency: "CZK" });
    // Another day, or another amount, is not this payment's conversion.
    const nextDay = { transaction_initiation_date: "2026-10-01T14:05:00+0000" };
    expect(
      parsePaypalTransactions([payment, conversion("-42.59", "USD", nextDay), conversion("1017.23", "CZK", nextDay), conversion("-45.00", "USD", later), conversion("1074.80", "CZK", later)])[0],
    ).toMatchObject({ netAmount: null });
  });

  it("leaves the net empty when nothing was converted or a conversion at that time came from another currency", () => {
    expect(parsePaypalTransactions([detail()])[0]).toMatchObject({ netAmount: null, netCurrency: null });
    expect(parsePaypalTransactions([detail(), conversion("-30.00", "USD"), conversion("690.00", "CZK")])[0]).toMatchObject({
      netAmount: null,
    });
  });

  it("keeps the subject as the message and the payer's country", () => {
    const [row] = parsePaypalTransactions([
      detail(
        { transaction_subject: "VIP rank", transaction_note: "Díky" },
        { email_address: "buyer@example.test", country_code: "sk", payer_name: { alternate_full_name: "Ján Kováč" } },
      ),
    ]);
    expect(row).toMatchObject({ message: "VIP rank – Díky", payerCountry: "SK", counterpartyName: "Ján Kováč" });
  });

  it("reads the variable symbol from the note when there is no invoice id", () => {
    const [row] = parsePaypalTransactions([detail({ invoice_id: null, transaction_note: "Faktura VS 2026015" })]);
    expect(row!.variableSymbol).toBe("2026015");
  });

  it("skips pending, outgoing and non-payment events", () => {
    expect(
      parsePaypalTransactions([
        detail({ transaction_status: "P" }),
        detail({ transaction_amount: { currency_code: "EUR", value: "-50.00" } }),
        detail({ transaction_event_code: "T0400" }),
        detail({ transaction_event_code: "T0200" }),
        { transaction_info: null },
      ]),
    ).toEqual([]);
    expect(parsePaypalTransactions(null)).toEqual([]);
  });

  it("leaves the fee empty when PayPal kept none", () => {
    const [row] = parsePaypalTransactions([detail({ fee_amount: undefined })]);
    expect(row!.fee).toBeNull();
  });
});

describe("paypalWindows", () => {
  it("covers the period in back-to-back windows of at most 31 days", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-03-15T12:00:00Z");
    const windows = paypalWindows(from, to);
    expect(windows.map((w) => [w.from.toISOString(), w.to.toISOString()])).toEqual([
      ["2026-01-01T00:00:00.000Z", "2026-01-31T23:59:59.000Z"],
      ["2026-02-01T00:00:00.000Z", "2026-03-03T23:59:59.000Z"],
      ["2026-03-04T00:00:00.000Z", "2026-03-15T12:00:00.000Z"],
    ]);
    expect(paypalWindows(to, to)).toEqual([]);
  });
});

describe("paypalBackfillRange", () => {
  const now = new Date("2026-11-25T10:00:00Z");

  it("reads from the start of the requested day up to now", () => {
    expect(paypalBackfillRange(new Date("2026-01-01T15:30:00Z"), now)).toEqual({ from: new Date("2026-01-01T00:00:00Z"), to: now });
  });

  it("stops three years back, with a day of margin", () => {
    expect(paypalBackfillRange(new Date("2020-05-01T00:00:00Z"), now)!.from).toEqual(new Date("2023-11-26T00:00:00Z"));
  });

  it("refuses a day that is not in the past", () => {
    expect(paypalBackfillRange(new Date("2026-12-01T00:00:00Z"), now)).toBeNull();
    expect(paypalBackfillRange(new Date("2026-11-25T00:00:00Z"), now)).not.toBeNull();
  });
});

describe("paypalBaseUrl", () => {
  it("picks live or sandbox, with an override", () => {
    expect(paypalBaseUrl(false, {})).toBe("https://api-m.paypal.com");
    expect(paypalBaseUrl(true, {})).toBe("https://api-m.sandbox.paypal.com");
    expect(paypalBaseUrl(false, { PAYPAL_API_BASE_URL: "http://localhost:9/" })).toBe("http://localhost:9");
  });
});

describe("PaypalClient", () => {
  it("authenticates once and follows pages", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ transaction_details: [detail()], total_pages: 2, page: 1 }))
      .mockResolvedValueOnce(json({ transaction_details: [detail({ transaction_id: "SECOND" })], total_pages: 2, page: 2 }));
    const client = new PaypalClient(credentials, fetchImpl as unknown as typeof fetch, "https://pp.test");
    const rows = await client.fetchIncoming(new Date("2026-09-20T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));

    expect(rows.map((r) => r.externalId)).toEqual(["paypal:9AB12345CD678901E", "paypal:SECOND"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0]!;
    expect(tokenUrl).toBe("https://pp.test/v1/oauth2/token");
    expect(tokenInit.headers.Authorization).toBe(`Basic ${Buffer.from("client-id-123:secret-value-123").toString("base64")}`);
    const searchUrl = new URL(fetchImpl.mock.calls[1]![0]);
    expect(searchUrl.pathname).toBe("/v1/reporting/transactions");
    expect(searchUrl.searchParams.get("start_date")).toBe("2026-09-20T00:00:00Z");
    expect(searchUrl.searchParams.get("page")).toBe("1");
    expect(fetchImpl.mock.calls[2]![1].headers.Authorization).toBe("Bearer tok");
  });

  it("splits long periods into 31-day windows", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/oauth2/token") ? json({ access_token: "tok" }) : json({ transaction_details: [], total_pages: 1 }),
    );
    const client = new PaypalClient(credentials, fetchImpl as unknown as typeof fetch, "https://pp.test");
    await client.fetchIncoming(new Date("2026-07-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
    // 92 days → 3 windows, one token request.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("maps credential and permission errors", async () => {
    const bad = new PaypalClient(credentials, vi.fn().mockResolvedValue(json({ error: "invalid_client" }, 401)) as never, "https://pp.test");
    await expect(bad.fetchIncoming(new Date(Date.now() - 1000))).rejects.toMatchObject({ code: "invalid_credentials" });

    const forbidden = new PaypalClient(
      credentials,
      vi.fn().mockResolvedValueOnce(json({ access_token: "tok" })).mockResolvedValueOnce(json({ name: "NOT_AUTHORIZED" }, 403)) as never,
      "https://pp.test",
    );
    await expect(forbidden.fetchIncoming(new Date(Date.now() - 1000))).rejects.toMatchObject({ code: "reporting_disabled" });

    const offline = new PaypalClient(credentials, vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never, "https://pp.test");
    await expect(offline.token()).rejects.toBeInstanceOf(PaypalApiError);
  });
});
