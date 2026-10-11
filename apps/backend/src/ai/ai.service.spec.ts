import { BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactsService } from "../contacts/contacts.service";
import { AiService } from "./ai.service";

const { parseMock, retrieveMock, ctorKeys, FakeAuthError } = vi.hoisted(() => {
  class FakeApiError extends Error {}
  class FakeAuthError extends FakeApiError {}
  return { parseMock: vi.fn(), retrieveMock: vi.fn(), ctorKeys: [] as string[], FakeAuthError };
});

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
});
