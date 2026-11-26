import { describe, expect, it, vi } from "vitest";
import { BankConnectionsService } from "./bank-connections.service";
import { compileRule, importWordsFor, keepOnImport, validateRule, type ImportRuleLike } from "./bank-rules";

const row = (over: Partial<Parameters<typeof keepOnImport>[0]> = {}) => ({
  transactionDate: new Date("2026-11-20"),
  amount: "-1200.00",
  currency: "CZK",
  variableSymbol: null,
  counterpartyAccount: null,
  counterpartyName: null,
  message: null,
  ...over,
});

const importRule = (keywords: string | null, over: Partial<ImportRuleLike> = {}): ImportRuleLike => ({
  enabled: true,
  action: "import_only",
  conditions: { keywords },
  connectionId: null,
  ...over,
});

describe("import_only rules", () => {
  it("leaves a connection without an import rule to the old default", () => {
    expect(importWordsFor([], "revolut")).toBeNull();
    expect(importWordsFor([importRule("google", { connectionId: "other" })], "revolut")).toBeNull();
    expect(keepOnImport(row({ counterpartyName: "Grandma" }), null)).toBe(true);
  });

  it("applies a rule scoped to the connection and one for every connection", () => {
    expect(importWordsFor([importRule("Google", { connectionId: "revolut" })], "revolut")).toEqual(["google"]);
    expect(importWordsFor([importRule("Google")], "revolut")).toEqual(["google"]);
  });

  it("keeps a movement that fits any of the rules", () => {
    const words = importWordsFor([importRule("google", { connectionId: "revolut" }), importRule("meta; tiktok"), importRule("apple", { connectionId: "fio" })], "revolut");
    expect(words).toEqual(["google", "meta", "tiktok"]);
    expect(keepOnImport(row({ counterpartyName: "GOOGLE *ADS1234" }), words)).toBe(true);
    expect(keepOnImport(row({ message: "Meta ads" }), words)).toBe(true);
    expect(keepOnImport(row({ counterpartyName: "Apple" }), words)).toBe(false);
    expect(keepOnImport(row({ counterpartyName: "Albert", message: "groceries" }), words)).toBe(false);
  });

  it("matches like the old connection filter: lower case substring, no diacritics folding", () => {
    const words = importWordsFor([importRule("Šroubek")], "revolut");
    expect(keepOnImport(row({ counterpartyName: "ŠROUBEK s.r.o." }), words)).toBe(true);
    expect(keepOnImport(row({ counterpartyName: "Sroubek s.r.o." }), words)).toBe(false);
  });

  it("ignores disabled rules, other actions and a rule without words", () => {
    expect(importWordsFor([importRule("google", { enabled: false })], "revolut")).toBeNull();
    expect(importWordsFor([importRule("google", { action: "ignore" })], "revolut")).toBeNull();
    // Read as "keep everything" it would let every debit of a personal account in.
    expect(importWordsFor([importRule(" , ;")], "revolut")).toBeNull();
  });

  it("needs words and never acts on a stored payment", () => {
    expect(validateRule({ action: "import_only", conditions: { text: [], direction: "any", keywords: " ,; " } })).toBe("import_rule_needs_words");
    expect(validateRule({ action: "import_only", conditions: { text: [], direction: "any", keywords: "google" } })).toBeNull();
    const compiled = compileRule({
      action: "import_only",
      conditions: { text: [{ field: "any", operator: "contains", value: "google" }], direction: "any", keywords: "google" },
    });
    expect(compiled.matches({ amount: -100, currency: "CZK", counterpartyName: "Google", counterpartyAccount: null, message: null, variableSymbol: null })).toBe(false);
  });
});

describe("PSD2 sync with import_only rules", () => {
  const google = { ...row({ counterpartyName: "Google Ireland" }), externalId: "psd2:1" };
  const grandma = { ...row({ amount: "500.00", counterpartyName: "Grandma" }), externalId: "psd2:2" };

  async function syncWith(rules: { action: string; connectionId: string | null; conditions: unknown }[]) {
    const fetchIncoming = vi.fn(async () => [google, grandma]);
    const service = new BankConnectionsService({} as never);
    const internals = service as unknown as {
      psd2Client: () => unknown;
      storeFresh: (...args: unknown[]) => Promise<unknown>;
      sync: (...args: unknown[]) => Promise<unknown>;
    };
    internals.psd2Client = () => ({ fetchIncoming });
    const storeFresh = vi.fn(async () => ({ total: 0, matched: 0, unmatched: 0 }));
    internals.storeFresh = storeFresh;
    const db = {
      select: () => ({ from: () => ({ where: async () => rules }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    const connection = { id: "revolut", provider: "enable_banking", externalAccountId: "acc", lastSyncedAt: null, bankName: "Revolut", accountNumber: null };
    await internals.sync(db, "t1", connection, false);
    return { fetchIncoming, stored: (storeFresh.mock.calls[0] as unknown[])[4] };
  }

  it("asks for debits too and stores only what a rule keeps", async () => {
    const { fetchIncoming, stored } = await syncWith([{ action: "import_only", connectionId: "revolut", conditions: { keywords: "google" } }]);
    expect(fetchIncoming).toHaveBeenCalledWith("acc", expect.any(Date), true);
    expect(stored).toEqual([google]);
  });

  it("keeps incoming payments only, unfiltered, when no rule is for this connection", async () => {
    const { fetchIncoming, stored } = await syncWith([{ action: "import_only", connectionId: "fio", conditions: { keywords: "google" } }]);
    expect(fetchIncoming).toHaveBeenCalledWith("acc", expect.any(Date), false);
    expect(stored).toEqual([google, grandma]);
  });
});
