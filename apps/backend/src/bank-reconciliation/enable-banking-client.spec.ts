import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  EnableBankingClient,
  EnableBankingError,
  enableBankingConfig,
  extractVariableSymbol,
  parseTransactions,
  signAppJwt,
} from "./enable-banking-client";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config = { appId: "app-123", privateKey: pem, baseUrl: "https://api.example.test" };

describe("extractVariableSymbol", () => {
  it("reads common CZ/SK remittance forms", () => {
    expect(extractVariableSymbol(["/VS/2026001/SS//KS/0308"])).toBe("2026001");
    expect(extractVariableSymbol(["Faktura VS: 0002026002"])).toBe("2026002");
    expect(extractVariableSymbol(["VS2026003"])).toBe("2026003");
  });

  it("falls back to a digits-only reference", () => {
    expect(extractVariableSymbol(["Platba za služby", null, "  0042  "])).toBe("42");
  });

  it("returns null without a symbol", () => {
    expect(extractVariableSymbol(["Úhrada faktury", undefined])).toBeNull();
    expect(extractVariableSymbol(["ADVISORY 5"])).toBeNull();
  });
});

describe("parseTransactions", () => {
  const rows = parseTransactions("acc-1", [
    {
      entry_reference: "E1",
      transaction_amount: { amount: "12100.5", currency: "czk" },
      credit_debit_indicator: "CRDT",
      status: "BOOK",
      booking_date: "2026-09-30",
      debtor: { name: "Odběratel s.r.o." },
      debtor_account: { iban: "CZ6508000000192000145399" },
      remittance_information: ["/VS/2026001"],
    },
    { entry_reference: "E2", transaction_amount: { amount: "100" }, credit_debit_indicator: "DBIT", status: "BOOK", booking_date: "2026-09-30" },
    { entry_reference: "E3", transaction_amount: { amount: "100" }, credit_debit_indicator: "CRDT", status: "PDNG", booking_date: "2026-09-30" },
    { transaction_amount: { amount: "50" }, credit_debit_indicator: "CRDT", value_date: "2026-10-01", remittance_information: ["77"] },
  ]);

  it("keeps booked incoming payments only", () => {
    expect(rows).toHaveLength(2);
  });

  it("maps fields", () => {
    expect(rows[0]).toMatchObject({
      externalId: "psd2:acc-1:E1",
      amount: "12100.50",
      currency: "CZK",
      variableSymbol: "2026001",
      counterpartyAccount: "CZ6508000000192000145399",
      counterpartyName: "Odběratel s.r.o.",
    });
    expect(rows[0]!.transactionDate.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("fingerprints movements without a bank reference", () => {
    expect(rows[1]!.externalId).toBe("psd2:acc-1:2026-10-01|50.00|77|");
    expect(rows[1]!.variableSymbol).toBe("77");
  });
});

describe("signAppJwt", () => {
  it("produces an RS256 JWT verifiable with the public key", () => {
    const token = signAppJwt(config, Date.UTC(2026, 9, 9) );
    const [h, p, sig] = token.split(".");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(header).toEqual({ typ: "JWT", alg: "RS256", kid: "app-123" });
    expect(payload.aud).toBe("api.enablebanking.com");
    expect(payload.exp - payload.iat).toBe(3600);
    const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig!, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("enableBankingConfig", () => {
  it("is null until app id and key are set", () => {
    expect(enableBankingConfig({})).toBeNull();
    expect(enableBankingConfig({ ENABLE_BANKING_APP_ID: "x" })).toBeNull();
    const cfg = enableBankingConfig({ ENABLE_BANKING_APP_ID: "x", ENABLE_BANKING_PRIVATE_KEY: "a\\nb" });
    expect(cfg).toEqual({ appId: "x", privateKey: "a\nb", baseUrl: "https://api.enablebanking.com" });
  });
});

describe("EnableBankingClient", () => {
  const json = (status: number, body: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("follows continuation keys", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { transactions: [{ entry_reference: "A", transaction_amount: { amount: "1" }, credit_debit_indicator: "CRDT", booking_date: "2026-10-01" }], continuation_key: "next" }))
      .mockResolvedValueOnce(json(200, { transactions: [{ entry_reference: "B", transaction_amount: { amount: "2" }, credit_debit_indicator: "CRDT", booking_date: "2026-10-02" }] }));
    const client = new EnableBankingClient(config, fetchImpl as unknown as typeof fetch);
    const rows = await client.fetchIncoming("acc", new Date("2026-09-01T00:00:00Z"));
    expect(rows.map((r) => r.externalId)).toEqual(["psd2:acc:A", "psd2:acc:B"]);
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("continuation_key=next");
    expect(fetchImpl.mock.calls[0]![1].headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("maps an expired consent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(401, { error: "EXPIRED_SESSION" }));
    const client = new EnableBankingClient(config, fetchImpl as unknown as typeof fetch);
    await expect(client.fetchIncoming("acc", new Date())).rejects.toMatchObject({ code: "consent_expired" });
  });

  it("maps rate limiting and outages", async () => {
    const client429 = new EnableBankingClient(config, vi.fn().mockResolvedValue(json(429, {})) as unknown as typeof fetch);
    await expect(client429.listBanks("CZ")).rejects.toMatchObject({ code: "rate_limited" });
    const down = new EnableBankingClient(config, vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch);
    await expect(down.listBanks("CZ")).rejects.toBeInstanceOf(EnableBankingError);
  });

  it("parses sessions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(200, {
        session_id: "s1",
        accounts: [{ uid: "u1", account_id: { iban: "CZ01" }, name: "Běžný" }, { name: "no uid" }],
        access: { valid_until: "2027-01-07T10:00:00Z" },
      }),
    );
    const session = await new EnableBankingClient(config, fetchImpl as unknown as typeof fetch).createSession("code");
    expect(session).toEqual({
      sessionId: "s1",
      accounts: [{ uid: "u1", iban: "CZ01", name: "Běžný", currency: null }],
      validUntil: new Date("2027-01-07T10:00:00Z"),
    });
  });
});
