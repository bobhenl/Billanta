import { BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactsService } from "../contacts/contacts.service";
import { AiService } from "./ai.service";

const { parseMock, retrieveMock, ctorKeys, FakeAuthError } = vi.hoisted(() => {
  class FakeApiError extends Error {}
  class FakeAuthError extends FakeApiError {}
  return { parseMock: vi.fn(), retrieveMock: vi.fn(), ctorKeys: [] as string[], FakeAuthError };
});

// The credit counter is SQL with its own spec; here it records what it was asked.
const usage = vi.hoisted(() => ({
  consumeUsage: vi.fn(async () => ({ ok: true, count: 1 })),
  refundUsage: vi.fn(async () => undefined),
  readUsage: vi.fn(async () => [] as { metric: string; count: number }[]),
}));
vi.mock("../billing/usage.repository", () => usage);

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static AuthenticationError = FakeAuthError;
    static PermissionDeniedError = class extends Error {};
    static NotFoundError = class extends Error {};
    static RateLimitError = class extends Error {};
    static BadRequestError = class extends Error {};
    beta = { messages: { parse: parseMock } };
    models = { retrieve: retrieveMock };
    constructor(opts: { apiKey: string }) {
      ctorKeys.push(opts.apiKey);
    }
  }
  return { default: Anthropic };
});

const ENC_KEY = "a".repeat(64);
const TENANT = {
  id: "t1",
  aiMode: "platform",
  aiApiKeyEncrypted: null as string | null,
  aiApiKeyLast4: null as string | null,
  dicVatPayer: true,
};

/** Fake tenant db: every select resolves to `rows`, updates are recorded. */
function fakeDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  const updates: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(queue.shift() ?? []));
  return {
    updates,
    db: {
      select: vi.fn(() => chain),
      update: vi.fn(() => ({ set: (patch: unknown) => ({ where: () => (updates.push(patch), Promise.resolve()) }) })),
    },
  };
}

const SUGGESTION = {
  customer: { ico: "27604977", name: "Novák Consulting" },
  items: [{ description: "Konzultace", quantity: 3, unit_price: 1500, vat_rate: 21 }],
  currency: "CZK",
  due_in_days: 14,
  issue_date: null,
};

describe("AiService", () => {
  const contacts = { aresLookup: vi.fn() } as unknown as ContactsService;

  beforeEach(() => {
    process.env.AI_KEY_ENCRYPTION_KEY = ENC_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-platform";
    parseMock.mockReset();
    retrieveMock.mockReset();
    ctorKeys.length = 0;
    usage.consumeUsage.mockReset().mockResolvedValue({ ok: true, count: 1 });
    usage.refundUsage.mockClear();
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("refuses settings changes from non-admin roles", async () => {
    const { db } = fakeDb([[TENANT]]);
    await expect(
      new AiService(contacts).updateSettings(db as never, "t1", "viewer", { mode: "off" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("will not switch to own-key mode without a stored key", async () => {
    const { db } = fakeDb([[TENANT]]);
    await expect(
      new AiService(contacts).updateSettings(db as never, "t1", "owner", { mode: "own" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stores a verified own key encrypted, never in plain text", async () => {
    retrieveMock.mockResolvedValue({ id: "claude-opus-5" });
    const { db, updates } = fakeDb([[TENANT], [{ ...TENANT, aiMode: "own", aiApiKeyEncrypted: "x", aiApiKeyLast4: "WXYZ" }]]);
    const key = "sk-ant-api03-SECRETSECRETSECRETWXYZ";

    const result = await new AiService(contacts).updateSettings(db as never, "t1", "owner", { apiKey: key, mode: "own" });

    const patch = updates[0] as { aiApiKeyEncrypted: string; aiApiKeyLast4: string; aiMode: string };
    expect(patch.aiApiKeyEncrypted).not.toContain("SECRET");
    expect(patch.aiApiKeyEncrypted.split(":")).toHaveLength(3);
    expect(patch.aiApiKeyLast4).toBe("WXYZ");
    expect(patch.aiMode).toBe("own");
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it("rejects a key the provider does not accept", async () => {
    retrieveMock.mockRejectedValue(new FakeAuthError("bad key"));
    const { db, updates } = fakeDb([[TENANT]]);
    await expect(
      new AiService(contacts).updateSettings(db as never, "t1", "owner", { apiKey: "sk-ant-api03-not-a-real-key-000000" }),
    ).rejects.toMatchObject({ response: { error: "ai_key_invalid" } });
    expect(updates).toHaveLength(0);
  });

  it("suggests an invoice and matches the customer to an existing contact", async () => {
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: SUGGESTION });
    const contact = { id: "c1", legalName: "Novák Consulting s.r.o.", ico: "27604977" };
    const { db } = fakeDb([[TENANT], [contact]]);

    const result = await new AiService(contacts).suggestInvoice(db as never, "t1", "faktura pro 27604977, 3h po 1500");

    expect(result.contact).toEqual(contact);
    expect(result.suggestion.items[0]?.unit_price).toBe(1500);
    expect(ctorKeys).toEqual(["sk-ant-platform"]);
    const request = parseMock.mock.calls[0]![0];
    expect(request.fallbacks).toBe("default");
    expect(request.messages[0].content).toContain("a VAT payer");
  });

  it("uses the tenant's own decrypted key in own mode", async () => {
    const { encryptSecret } = await import("../backup-destinations/encryption.util");
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { ...SUGGESTION, customer: { ico: null, name: null } } });
    const own = { ...TENANT, aiMode: "own", aiApiKeyEncrypted: encryptSecret("sk-ant-own-key", ENC_KEY) };
    const { db } = fakeDb([[own]]);

    await new AiService(contacts).suggestInvoice(db as never, "t1", "3 hodiny konzultace");

    expect(ctorKeys).toEqual(["sk-ant-own-key"]);
  });

  it("does not call the provider when AI is off or the platform key is missing", async () => {
    const off = fakeDb([[{ ...TENANT, aiMode: "off" }]]);
    await expect(new AiService(contacts).suggestInvoice(off.db as never, "t1", "abc")).rejects.toBeInstanceOf(ForbiddenException);

    delete process.env.ANTHROPIC_API_KEY;
    const noKey = fakeDb([[TENANT]]);
    await expect(new AiService(contacts).suggestInvoice(noKey.db as never, "t1", "abc")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("caps platform-key use per tenant per day", async () => {
    parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { ...SUGGESTION, customer: { ico: null, name: null } } });
    const service = new AiService(contacts);
    const limit = Number(process.env.AI_PLATFORM_DAILY_LIMIT ?? 50);
    for (let i = 0; i < limit; i++) {
      await service.suggestInvoice(fakeDb([[TENANT]]).db as never, "t1", "x y z");
    }
    await expect(service.suggestInvoice(fakeDb([[TENANT]]).db as never, "t1", "x y z")).rejects.toBeInstanceOf(HttpException);
  });

  describe("AI credits", () => {
    // A company on Free from after plan limits: 5 credits a month.
    const FREE = { ...TENANT, planEnforced: true, subscriptionStatus: "none", isDemo: false };
    const blank = { stop_reason: "end_turn", parsed_output: { ...SUGGESTION, customer: { ico: null, name: null } } };

    it("spends one of the plan's credits per call on Billanta's key", async () => {
      parseMock.mockResolvedValue(blank);
      await new AiService(contacts).suggestInvoice(fakeDb([[FREE]]).db as never, "t1", "x y z");
      expect(usage.consumeUsage).toHaveBeenCalledWith(expect.anything(), "t1", "ai_credits", expect.stringMatching(/^\d{4}-\d{2}$/), 5);
    });

    it("refuses with ai_credits_exhausted and never reaches the provider", async () => {
      usage.consumeUsage.mockResolvedValue({ ok: false, count: 5 });
      const err = await new AiService(contacts).suggestInvoice(fakeDb([[FREE]]).db as never, "t1", "x y z").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ error: "ai_credits_exhausted", limit: 5, used: 5, plan: "start" });
      expect(parseMock).not.toHaveBeenCalled();
    });

    it("gives the credit back when the provider fails", async () => {
      parseMock.mockRejectedValue(new Error("overloaded"));
      await expect(new AiService(contacts).suggestInvoice(fakeDb([[FREE]]).db as never, "t1", "x y z")).rejects.toBeDefined();
      expect(usage.refundUsage).toHaveBeenCalledWith(expect.anything(), "t1", "ai_credits", expect.any(String));
    });

    it("does not count calls on the company's own key", async () => {
      const { encryptSecret } = await import("../backup-destinations/encryption.util");
      parseMock.mockResolvedValue(blank);
      const own = { ...FREE, aiMode: "own", aiApiKeyEncrypted: encryptSecret("sk-ant-own-key", ENC_KEY) };
      await new AiService(contacts).suggestInvoice(fakeDb([[own]]).db as never, "t1", "x y z");
      expect(usage.consumeUsage).not.toHaveBeenCalled();
    });

    it("counts a receipt read too", async () => {
      parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { supplier: { ico: null, name: null } } });
      await new AiService(contacts).readReceipt(fakeDb([[FREE]]).db as never, "t1", { buffer: Buffer.from("x"), mediaType: "image/png" });
      expect(usage.consumeUsage).toHaveBeenCalledWith(expect.anything(), "t1", "ai_credits", expect.any(String), 5);
    });
  });

  describe("receipts in Důvěrný režim", () => {
    const FREE = { ...TENANT, planEnforced: true, subscriptionStatus: "none", isDemo: false };

    it("refuses an encrypted receipt before the model or the credits see it", async () => {
      const { generateDataKey, sealFile } = await import("@faktur/cz-compliance");
      const { body } = await sealFile(await generateDataKey(), new TextEncoder().encode("%PDF-1.7"), { name: "a.pdf", mime: "application/pdf" });
      const err = await new AiService(contacts)
        .readReceipt(fakeDb([[FREE]]).db as never, "t1", { buffer: Buffer.from(body), mediaType: "application/pdf" })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(409);
      expect((err as HttpException).message).toBe("encrypted_file");
      expect(parseMock).not.toHaveBeenCalled();
      expect(usage.consumeUsage).not.toHaveBeenCalled();
    });

    it("reads a decrypted receipt once without storing or logging it", async () => {
      const marker = "UCTENKA-7f3a-DUVERNE";
      const file = Buffer.from(`%PDF-1.7 ${marker}`);
      const b64 = file.toString("base64");
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
      const { Logger } = await import("@nestjs/common");
      const loggerSpies = (["log", "warn", "error", "debug", "verbose"] as const).map((m) => vi.spyOn(Logger.prototype, m).mockImplementation(() => {}));
      parseMock.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { supplier: { ico: null, name: null }, amount: 100 } });
      const fake = fakeDb([[FREE]]);
      const insert = vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => []) })) }));
      const db = { ...fake.db, insert, execute: vi.fn(async () => []) };
      try {
        const result = await new AiService(contacts).readReceipt(db as never, "t1", { buffer: file, mediaType: "application/pdf" });
        expect(result.suggestion).toMatchObject({ amount: 100 });
        // The model got the file...
        expect(JSON.stringify(parseMock.mock.calls)).toContain(b64);
        // ...and nothing else did: no row, no update, no usage record, no log line.
        expect(insert).not.toHaveBeenCalled();
        expect(db.execute).not.toHaveBeenCalled();
        const elsewhere = JSON.stringify([fake.updates, usage.consumeUsage.mock.calls, ...spies.map((s) => s.mock.calls), ...loggerSpies.map((s) => s.mock.calls)]);
        expect(elsewhere).not.toContain(b64);
        expect(elsewhere).not.toContain(marker);
      } finally {
        spies.forEach((s) => s.mockRestore());
        loggerSpies.forEach((s) => s.mockRestore());
      }
    });
  });
});
