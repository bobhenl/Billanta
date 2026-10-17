import { describe, expect, it } from "vitest";
import {
  buyerDetailsSchema,
  DEFAULT_BUYER_DETAILS_REQUIRED,
  missingRequired,
  newBuyerDetailsToken,
  normalizeToken,
  requestBlock,
  requiredFieldsOf,
  sameCompanyName,
  resolveBuyerContact,
  shouldAutoIssue,
  submitBlock,
  TOKEN_PATTERN,
  type BuyerContact,
  type BuyerDetails,
} from "./buyer-details.util";

const TOKEN = "3f2b8c1e-9a4d-4c2e-8b7a-1d2e3f4a5b6c";

const state = (over: Partial<Parameters<typeof submitBlock>[0] & object> = {}) => ({
  status: "draft",
  documentType: "invoice",
  buyerDetailsToken: TOKEN,
  buyerDetailsSubmittedAt: null as Date | null,
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  isPerson: false,
  name: "Nová firma s.r.o.",
  email: "Fakturace@Firma.cz",
  street: "Dlouhá 1",
  city: "Praha",
  postalCode: "110 00",
  country: "CZ",
  ico: "12345678",
  dic: "CZ12345678",
  ...over,
});

const parse = (over: Record<string, unknown> = {}) => buyerDetailsSchema.safeParse(input(over));
const messages = (over: Record<string, unknown>) => {
  const r = parse(over);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

const details = (over: Partial<BuyerDetails> = {}): BuyerDetails => ({
  isPerson: false,
  legalName: "Nová firma s.r.o.",
  email: "fakturace@firma.cz",
  phone: null,
  addressStreet: "Dlouhá 1",
  addressCity: "Praha",
  addressPostalCode: "110 00",
  addressCountry: "CZ",
  ico: "12345678",
  dic: "CZ12345678",
  ...over,
});

const contact = (over: Partial<BuyerContact> = {}): BuyerContact => ({
  id: "c-attached",
  legalName: "Nová firma s.r.o.",
  isPerson: false,
  email: null,
  phone: null,
  ico: null,
  dic: null,
  addressStreet: null,
  addressCity: null,
  addressPostalCode: null,
  addressCountry: "CZ",
  ...over,
});

describe("token", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(TOKEN_PATTERN.test(TOKEN)).toBe(true);
    expect(TOKEN_PATTERN.test(TOKEN.toUpperCase())).toBe(true);
    expect(TOKEN_PATTERN.test("x")).toBe(false);
    expect(TOKEN_PATTERN.test(`${TOKEN}' OR 1=1`)).toBe(false);
    expect(TOKEN_PATTERN.test(`a${TOKEN}`)).toBe(false);
  });
  it("accepts the short base62 tokens and nothing near them", () => {
    expect(TOKEN_PATTERN.test("aZ09bY18cX27")).toBe(true);
    expect(TOKEN_PATTERN.test("aZ09bY18cX2")).toBe(false);
    expect(TOKEN_PATTERN.test("aZ09bY18cX27a")).toBe(false);
    expect(TOKEN_PATTERN.test("aZ09bY18cX2-")).toBe(false);
  });
  it("normalizes UUIDs to lower case but keeps short tokens exact", () => {
    expect(normalizeToken(TOKEN.toUpperCase())).toBe(TOKEN);
    expect(normalizeToken("aZ09bY18cX27")).toBe("aZ09bY18cX27");
  });
  it("generates 12 base62 characters that pass the pattern", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = newBuyerDetailsToken();
      expect(t).toMatch(/^[0-9A-Za-z]{12}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });
  it("skips the bytes that would bias the alphabet", () => {
    // 248..255 are dropped, so 255 never maps to a character; 61 -> "z", 0 -> "0", 124 -> 124 % 62 = 0.
    const bytes = Buffer.from([255, 61, 248, 0, 124, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(newBuyerDetailsToken(() => bytes)).toBe("z00123456789");
  });
});

describe("requestBlock", () => {
  it("allows drafts of invoices, proformas and quotes", () => {
    expect(requestBlock(state())).toBeNull();
    expect(requestBlock(state({ status: "pending_review" }))).toBeNull();
    expect(requestBlock(state({ documentType: "proforma" }))).toBeNull();
    expect(requestBlock(state({ documentType: "quote" }))).toBeNull();
  });
  it("never allows an issued document", () => {
    for (const status of ["issued", "sent", "paid", "overdue", "cancelled"]) expect(requestBlock(state({ status }))).toBe("not_draft");
  });
  it("refuses credit notes", () => {
    expect(requestBlock(state({ documentType: "credit_note" }))).toBe("wrong_type");
  });
});

describe("submitBlock", () => {
  it("lets the exact open token submit once on a draft", () => {
    expect(submitBlock(state(), TOKEN)).toBeNull();
    expect(submitBlock(state(), TOKEN.toUpperCase())).toBeNull();
    expect(submitBlock(state({ buyerDetailsToken: "aZ09bY18cX27" }), "aZ09bY18cX27")).toBeNull();
    // Short tokens are case-sensitive: a different case is a different token.
    expect(submitBlock(state({ buyerDetailsToken: "aZ09bY18cX27" }), "az09by18cx27")).toBe("not_found");
  });
  it("is not_found for a missing invoice, a closed request, a malformed or a different token", () => {
    expect(submitBlock(null, TOKEN)).toBe("not_found");
    expect(submitBlock(state({ buyerDetailsToken: null }), TOKEN)).toBe("not_found");
    expect(submitBlock(state(), "nope")).toBe("not_found");
    expect(submitBlock(state(), "3f2b8c1e-9a4d-4c2e-8b7a-1d2e3f4a5b6d")).toBe("not_found");
  });
  it("is closed once the document is no longer a draft", () => {
    expect(submitBlock(state({ status: "issued" }), TOKEN)).toBe("closed");
    expect(submitBlock(state({ status: "paid", buyerDetailsSubmittedAt: new Date() }), TOKEN)).toBe("closed");
  });
  it("is submitted after the first submission", () => {
    expect(submitBlock(state({ buyerDetailsSubmittedAt: new Date() }), TOKEN)).toBe("submitted");
  });
});

describe("buyerDetailsSchema", () => {
  it("normalizes a valid Czech company", () => {
    const r = parse({ ico: "1234 5678", dic: "cz 12345678", email: " Fakturace@Firma.cz " });
    expect(r.success && r.data).toEqual(details());
  });
  it("pads a short IČO and adds the CZ prefix to a bare DIČ", () => {
    const r = parse({ ico: "123456", dic: "00123456" });
    expect(r.success && [r.data.ico, r.data.dic]).toEqual(["00123456", "CZ00123456"]);
  });
  it("leaves required fields to missingRequired, so a supplier can drop the IČO", () => {
    expect(parse({ ico: "" }).success).toBe(true);
  });
  it("accepts a phone number and rejects text", () => {
    const r = parse({ phone: " +420  777 123 456 " });
    expect(r.success && r.data.phone).toBe("+420 777 123 456");
    expect(messages({ phone: "call me" })).toContain("phone_format");
    expect(parse({ phone: "" }).success).toBe(true);
  });
  it("rejects a malformed IČO", () => {
    expect(messages({ ico: "12AB5678" })).toContain("ico_format");
    expect(messages({ ico: "123456789" })).toContain("ico_format");
  });
  it("rejects an IČO for a foreign company", () => {
    expect(messages({ country: "DE", ico: "12345678", dic: "DE123456789" })).toContain("ico_foreign");
  });
  it("checks the DIČ format per country", () => {
    expect(messages({ dic: "CZ1234" })).toContain("dic_format");
    expect(messages({ country: "SK", dic: "SK123" })).toContain("dic_format");
    expect(messages({ country: "SK", dic: "2020123456" })).toEqual([]);
    expect(messages({ country: "DE", ico: null, dic: "FR12345678901" })).toContain("dic_format");
    expect(messages({ country: "DE", ico: null, dic: "DE123456789" })).toEqual([]);
    expect(messages({ country: "GR", ico: null, dic: "123456789" })).toEqual([]);
  });
  it("accepts a plain tax number outside the EU", () => {
    const r = parse({ country: "US", ico: null, dic: "12-3456789" });
    expect(r.success && r.data.dic).toBe("123456789");
    expect(messages({ country: "US", ico: null, dic: "12" })).toContain("dic_format");
  });
  it("drops IČO and DIČ for a private person and needs neither", () => {
    const r = parse({ isPerson: true, name: "Jan Novák", ico: "12345678", dic: "CZ12345678" });
    expect(r.success && [r.data.ico, r.data.dic]).toEqual([null, null]);
    expect(messages({ isPerson: true, ico: null, dic: null })).toEqual([]);
  });
  it("requires a name, address and a valid e-mail, and a two-letter country", () => {
    expect(parse({ name: "x" }).success).toBe(false);
    expect(parse({ street: "" }).success).toBe(false);
    expect(parse({ city: "" }).success).toBe(false);
    expect(parse({ postalCode: "" }).success).toBe(false);
    expect(parse({ email: "not-an-email" }).success).toBe(false);
    expect(parse({ country: "CZE" }).success).toBe(false);
    expect(parse({ email: "" }).success).toBe(true);
  });
});

describe("sameCompanyName", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    expect(sameCompanyName("Čokoláda, s.r.o.", "COKOLADA s. r. o.")).toBe(true);
  });
  it("says no to a different name or a missing one", () => {
    expect(sameCompanyName("Alfa s.r.o.", "Alfa Plus s.r.o.")).toBe(false);
    expect(sameCompanyName(null, "Alfa")).toBe(false);
    expect(sameCompanyName("", "")).toBe(false);
  });
});

describe("missingRequired", () => {
  const d = (over: Partial<BuyerDetails> = {}) => details({ phone: null, ...over });
  it("defaults to e-mail and IČO", () => {
    expect(requiredFieldsOf(null)).toEqual(DEFAULT_BUYER_DETAILS_REQUIRED);
    expect(requiredFieldsOf(["phone", "bogus", "email"])).toEqual(["email", "phone"]);
    expect(requiredFieldsOf([])).toEqual([]);
  });
  it("lists the empty required fields of a company", () => {
    expect(missingRequired(d({ email: null, ico: null }), ["email", "phone", "ico", "dic"])).toEqual(["email", "phone", "ico"]);
    expect(missingRequired(d(), ["email", "ico"])).toEqual([]);
  });
  it("never asks a private person for IČO or DIČ", () => {
    expect(missingRequired(d({ isPerson: true, ico: null, dic: null }), ["email", "ico", "dic"])).toEqual([]);
  });
  it("asks for an IČO only in Czechia and Slovakia", () => {
    expect(missingRequired(d({ addressCountry: "SK", ico: null }), ["ico"])).toEqual(["ico"]);
    expect(missingRequired(d({ addressCountry: "DE", ico: null }), ["ico"])).toEqual([]);
  });
});

describe("resolveBuyerContact", () => {
  it("completes the draft's own contact, filling only empty fields", () => {
    const attached = contact({ email: "old@firma.cz" });
    const r = resolveBuyerContact({ attached, match: null, submitted: details() });
    expect(r.mode).toBe("filled");
    expect(r.contactId).toBe("c-attached");
    expect(r.mode !== "created" && r.patch).toEqual({
      ico: "12345678",
      dic: "CZ12345678",
      addressStreet: "Dlouhá 1",
      addressCity: "Praha",
      addressPostalCode: "110 00",
      addressCountry: "CZ",
    });
    expect(r.filled).toEqual(["ico", "dic", "address"]);
    expect(r.conflicts).toEqual([{ field: "email", saved: "old@firma.cz", submitted: "fakturace@firma.cz" }]);
  });
  it("never overwrites a saved address, it reports it", () => {
    const attached = contact({ addressStreet: "Krátká 2", addressCity: "Brno", addressPostalCode: "60200" });
    const r = resolveBuyerContact({ attached, match: null, submitted: details() });
    expect(r.mode !== "created" && r.patch.addressStreet).toBeUndefined();
    expect(r.conflicts.map((c) => c.field)).toEqual(["address"]);
  });
  it("treats an equal address (spacing, diacritics, case) as no conflict", () => {
    const attached = contact({ addressStreet: "dlouha 1", addressCity: "PRAHA", addressPostalCode: "11000" });
    const r = resolveBuyerContact({ attached, match: null, submitted: details() });
    expect(r.conflicts).toEqual([]);
  });
  it("creates a new contact when the details belong to someone else than the draft's contact", () => {
    const attached = contact({ legalName: "Úplně jiná a.s." });
    const r = resolveBuyerContact({ attached, match: null, submitted: details() });
    expect(r.mode).toBe("created");
    expect(r.mode === "created" && r.values.legalName).toBe("Nová firma s.r.o.");
  });
  it("creates a new contact when the draft's contact has a different IČO", () => {
    const attached = contact({ ico: "87654321" });
    expect(resolveBuyerContact({ attached, match: null, submitted: details() }).mode).toBe("created");
  });
  it("uses a saved contact with the same IČO and fills its empty fields when it is the draft's contact", () => {
    const saved = contact({ ico: "12345678" });
    const r = resolveBuyerContact({ attached: saved, match: saved, submitted: details() });
    expect(r.mode).toBe("existing");
    expect(r.filled).toContain("email");
    expect(r.conflicts).toEqual([]);
  });
  it("never writes to a matched contact that is not the draft's contact", () => {
    const attached = contact({ id: "c-attached", legalName: "Jan" });
    const other = contact({ id: "c-other", ico: "12345678", legalName: "Nová firma s.r.o." });
    const r = resolveBuyerContact({ attached, match: other, submitted: details() });
    expect(r.mode).toBe("existing");
    expect(r.contactId).toBe("c-other");
    expect(r.mode !== "created" && r.patch).toEqual({});
    expect(r.filled).toEqual([]);
    expect(r.conflicts.map((c) => c.field)).toEqual(["email", "dic", "address"]);
  });
  it("creates a contact for a draft without a customer when nothing matches", () => {
    const r = resolveBuyerContact({ attached: null, match: null, submitted: details() });
    expect(r.mode).toBe("created");
    expect(r.mode === "created" && r.values).toMatchObject({ legalName: "Nová firma s.r.o.", ico: "12345678", dic: "CZ12345678" });
  });
  it("on a draft without a customer, uses a saved contact found by IČO/DIČ but never writes to it", () => {
    const saved = contact({ id: "c-saved", ico: "12345678", email: null });
    const r = resolveBuyerContact({ attached: null, match: saved, submitted: details() });
    expect(r.mode).toBe("existing");
    expect(r.contactId).toBe("c-saved");
    expect(r.mode !== "created" && r.patch).toEqual({});
    expect(r.filled).toEqual([]);
    expect(r.conflicts.map((c) => c.field)).toEqual(["email", "dic", "address"]);
  });
  it("flips private person only on a contact without IDs", () => {
    const person = resolveBuyerContact({ attached: contact(), match: null, submitted: details({ isPerson: true, ico: null, dic: null }) });
    expect(person.mode !== "created" && person.patch.isPerson).toBe(true);
    const company = contact({ ico: "12345678" });
    const r = resolveBuyerContact({ attached: company, match: company, submitted: details({ isPerson: true, ico: null, dic: null }) });
    expect(r.mode !== "created" && r.patch.isPerson).toBeUndefined();
    expect(r.conflicts.map((c) => c.field)).toContain("isPerson");
  });
});

describe("shouldAutoIssue", () => {
  const clean = { conflicts: [], mode: "filled" as const, contactId: "c-attached" };
  it("needs the user's opt-in", () => {
    expect(shouldAutoIssue(false, clean, "c-attached")).toBe(false);
    expect(shouldAutoIssue(true, clean, "c-attached")).toBe(true);
  });
  it("waits for the user when anything conflicts", () => {
    expect(shouldAutoIssue(true, { ...clean, conflicts: [{ field: "email", saved: "a", submitted: "b" }] }, "c-attached")).toBe(false);
  });
  it("waits when the details moved the draft to a different saved contact", () => {
    expect(shouldAutoIssue(true, { conflicts: [], mode: "existing", contactId: "c-other" }, "c-attached")).toBe(false);
    expect(shouldAutoIssue(true, { conflicts: [], mode: "existing", contactId: "c-attached" }, "c-attached")).toBe(true);
  });
  it("issues to a newly created contact", () => {
    expect(shouldAutoIssue(true, { conflicts: [], mode: "created", contactId: null }, "c-attached")).toBe(true);
  });
  it("on a draft without a customer: issues to a new contact, waits for a matched saved one", () => {
    expect(shouldAutoIssue(true, { conflicts: [], mode: "created", contactId: null }, null)).toBe(true);
    expect(shouldAutoIssue(true, { conflicts: [], mode: "existing", contactId: "c-saved" }, null)).toBe(false);
  });
});
