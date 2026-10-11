import { describe, expect, it, vi } from "vitest";
import { PaypalApiError, PaypalClient, parsePaypalTransactions, paypalBaseUrl } from "./paypal-client";

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
      },
    ]);
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
