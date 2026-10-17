import { describe, expect, it } from "vitest";
import {
  buyerDetailsSchema,
  requestBlock,
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
  it("requires an IČO for a Czech or Slovak company", () => {
    expect(messages({ ico: "" })).toContain("ico_required");
    expect(messages({ ico: null, country: "SK", dic: null })).toContain("ico_required");
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
