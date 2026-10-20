import { isValidCzechBankAccount, isValidIban } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import { toEnglish } from "./english";
import { buildBankTransactions, buildDemoDataset, DEMO_KINDS, type SeededInvoice } from "./index";

const NOW = new Date("2026-10-18T14:30:00Z");

/** CZ/SK IČO checksum (weights 8..2, mod 11). */
function icoValid(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  const sum = [...ico.slice(0, 7)].reduce((acc, d, i) => acc + Number(d) * (8 - i), 0);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(ico[7]);
}

// Real brands must never show up in the made-up data.
const DENYLIST = ["alza", "rohlik", "seznam", "o2", "vodafone", "t-mobile", "orlen", "shell", "ikea", "adobe", "google", "microsoft", "slovnaft", "tesco", "lidl", "kaufland"];

describe.each(DEMO_KINDS)("demo dataset %s", (kind) => {
  const ds = buildDemoDataset(kind, NOW);

  it("covers every document state", () => {
    const states = new Set(ds.invoices.map((i) => i.state));
    for (const s of ["draft", "ai_draft", "issued", "partial", "paid", "cancelled", "quote_open", "quote_accepted", "quote_rejected", "quote_expired"] as const) {
      expect(states, s).toContain(s);
    }
    const types = new Set(ds.invoices.map((i) => i.documentType));
    expect([...types].sort()).toEqual(["credit_note", "invoice", "proforma", "quote"]);
  });

  it("has invoices overdue by a few days, weeks and months", () => {
    const overdueDays = ds.invoices
      .filter((i) => i.state === "issued" && i.documentType === "invoice" && i.dueDate < NOW)
      .map((i) => Math.round((NOW.getTime() - i.dueDate.getTime()) / 86_400_000));
    expect(overdueDays.some((d) => d <= 5)).toBe(true);
    expect(overdueDays.some((d) => d > 10 && d < 30)).toBe(true);
    expect(overdueDays.some((d) => d > 60)).toBe(true);
  });

  it("never dates a payment or issue in the future", () => {
    for (const i of ds.invoices) {
      expect(i.issueDate.getTime(), i.key).toBeLessThanOrEqual(NOW.getTime());
      if (i.paidAt) expect(i.paidAt.getTime(), i.key).toBeLessThanOrEqual(NOW.getTime());
      if (i.paidAt && !i.convertFrom) expect(i.paidAt.getTime(), i.key).toBeGreaterThanOrEqual(i.issueDate.getTime());
    }
    for (const e of ds.expenses) if (e.paidAt) expect(e.paidAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    for (const t of ds.time.entries) expect(t.startedAt.getTime()).toBeLessThan(NOW.getTime());
    for (const r of ds.recurring) expect(r.nextRunDate.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("converts only from an earlier document of the same dataset", () => {
    const keys = ds.invoices.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of ds.invoices.filter((x) => x.convertFrom)) {
      const src = ds.invoices.find((x) => x.key === i.convertFrom);
      expect(src, i.key).toBeDefined();
      expect(src!.issueDate.getTime()).toBeLessThan(i.issueDate.getTime());
    }
  });

  it("uses only known contacts", () => {
    const contactKeys = new Set(ds.contacts.map((c) => c.key));
    for (const i of ds.invoices) expect(contactKeys, i.key).toContain(i.contactKey);
    for (const p of ds.time.projects) expect(contactKeys).toContain(p.contactKey);
    for (const r of ds.recurring) expect(contactKeys).toContain(r.contactKey);
  });

  it("charges no VAT when the supplier is not a payer", () => {
    const lines = [...ds.invoices.flatMap((i) => i.lines), ...ds.recurring.flatMap((r) => r.lines)];
    for (const l of lines) {
      if (ds.supplier.payer) expect(l.vatRate).toBe(ds.supplier.vatRate);
      else expect(l.vatRate).toBeNull();
    }
  });

  it("keeps identities fictional and well-formed", () => {
    expect(icoValid(ds.supplier.tenant.ico)).toBe(true);
    for (const c of ds.contacts) if (c.ico) expect(icoValid(c.ico), c.legalName).toBe(true);
    const emails = [ds.supplier.tenant.email, ...ds.contacts.map((c) => c.email).filter((e): e is string => !!e)];
    for (const e of emails) expect(e).toMatch(/\.example$/);
    for (const b of ds.supplier.bank) {
      expect(isValidIban(b.iban), b.iban).toBe(true);
      if (b.iban.startsWith("CZ")) expect(isValidCzechBankAccount(`${b.account_number}/${b.bank_code}`)).toBe(true);
    }
  });

  it("names no real brand", () => {
    const text = JSON.stringify(ds).toLowerCase();
    for (const brand of DENYLIST) expect(text, brand).not.toMatch(new RegExp(`\\b${brand}\\b`));
  });

  it("never uses the long dash", () => {
    expect(JSON.stringify(ds)).not.toContain("—");
  });

  it("builds a statement whose matched lines point at paid invoices", () => {
    const seeded: SeededInvoice[] = ds.invoices
      .filter((i) => !["draft", "ai_draft"].includes(i.state))
      .map((spec, n) => ({ spec, id: `id-${n}`, variableSymbol: String(2026000 + n), total: 1000, counterpartyName: spec.contactKey }));
    const tx = buildBankTransactions(kind, NOW, seeded);
    const statuses = new Set(tx.map((t) => t.status));
    expect([...statuses].sort()).toEqual(["ignored", "matched", "unmatched"]);
    for (const t of tx.filter((x) => x.status === "matched")) {
      const s = seeded.find((x) => x.id === t.matchedInvoiceId);
      expect(s?.spec.paidAt).toBeTruthy();
    }
  });
});

describe.each(["sk_vat_sro", "sk_freelancer", "sk_vat_freelancer"] as const)("demo dataset %s", (kind) => {
  const ds = buildDemoDataset(kind, NOW);
  it("is a Slovak EUR company", () => {
    expect(ds.supplier.home).toBe("EUR");
    expect(ds.supplier.tenant.default_locale).toBe("sk");
    if (ds.supplier.payer) expect(ds.supplier.tenant.dic).toMatch(/^SK\d{10}$/);
    else expect(ds.supplier.tenant.dic).toBeNull();
    const domestic = ds.invoices.filter((i) => i.currency === "EUR" && !i.reverseCharge);
    expect(domestic.every((i) => i.language === "sk")).toBe(true);
    for (const b of ds.supplier.bank) expect(b.iban).toMatch(/^SK/);
  });
});

describe.each(["sk_freelancer", "sk_vat_freelancer"] as const)("demo dataset %s", (kind) => {
  const ds = buildDemoDataset(kind, NOW);
  it("is a živnostník with a Slovak registry note", () => {
    expect(ds.supplier.tenant.registry_note).toContain("živnostenskom registri");
    expect(ds.supplier.tenant.registry_note).toContain("okresného úradu");
  });
});

describe("demo dataset sk_freelancer", () => {
  const ds = buildDemoDataset("sk_freelancer", NOW);
  it("sells to no business in another EU state (that would need VAT registration, §7a ZoDPH)", () => {
    const foreign = ds.contacts.filter((c) => c.addressCountry !== "SK");
    expect(foreign.length).toBeGreaterThan(0);
    for (const c of foreign) expect(["GB", "US", "CH", "NO"], c.legalName).toContain(c.addressCountry);
    expect(ds.invoices.every((i) => !i.reverseCharge)).toBe(true);
    expect(ds.expenses.every((e) => !e.reverseCharge && e.currency === "EUR")).toBe(true);
  });
});

describe.each(DEMO_KINDS)("demo dataset %s in English", (kind) => {
  const ds = buildDemoDataset(kind, NOW, "en");

  it("has a translation for every text", () => {
    const missing: string[] = [];
    toEnglish(buildDemoDataset(kind, NOW), missing);
    expect(missing).toEqual([]);
  });

  it("issues every document in English and keeps the numbers", () => {
    const own = buildDemoDataset(kind, NOW);
    expect(ds.language).toBe("en");
    expect(ds.supplier.tenant.default_locale).toBe("en");
    expect(ds.invoices.every((i) => i.language === "en")).toBe(true);
    expect(ds.invoices.map((i) => i.lines.map((l) => l.unitPrice * l.quantity))).toEqual(own.invoices.map((i) => i.lines.map((l) => l.unitPrice * l.quantity)));
  });

  it("writes bank messages in English", () => {
    const seeded: SeededInvoice[] = ds.invoices
      .filter((i) => !["draft", "ai_draft"].includes(i.state))
      .map((spec, n) => ({ spec, id: `id-${n}`, variableSymbol: String(2026000 + n), total: 1000, counterpartyName: spec.contactKey }));
    for (const t of buildBankTransactions(kind, NOW, seeded, "en")) if (t.message) expect(t.message).toMatch(/^[ -~]+$/);
  });
});
