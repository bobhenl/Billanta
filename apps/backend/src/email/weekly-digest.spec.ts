import { describe, expect, it } from "vitest";
import { digestIsEmpty, renderWeeklyDigest, type DigestData } from "./weekly-digest";
import { chosenTaxKinds } from "./weekly-digest.cron";

const base: DigestData = {
  companyName: "Novák Design",
  unpaidTotals: ["12 100,00 Kč", "500,00 €"],
  unpaidCount: 3,
  overdue: [{ number: "2026-0007", customer: "ACME s.r.o.", amount: "1 210,00 Kč", date: new Date("2026-10-01T00:00:00Z"), url: "https://x.cz/cs/invoices/7" }],
  overdueCount: 12,
  paid: [{ number: "2026-0005", customer: null, amount: "3 000,00 Kč", date: new Date("2026-10-09T10:00:00Z"), url: "https://x.cz/cs/invoices/5" }],
  paidTotals: ["3 000,00 Kč"],
  deadlines: [{ label: "DPH a kontrolní hlášení", date: new Date("2026-10-26T00:00:00Z"), conditional: true }],
  dashboardUrl: "https://x.cz/cs/dashboard",
  unsubscribeUrl: "https://x.cz/cs/unsubscribe/t",
};

describe("renderWeeklyDigest", () => {
  it("lists unpaid totals, overdue, last week's payments and deadlines", () => {
    const { subject, html, text } = renderWeeklyDigest(base, "cs");
    expect(subject).toBe("Týdenní přehled: Novák Design");
    expect(text).toContain("Neuhrazeno celkem: 12 100,00 Kč + 500,00 € (3 faktur)");
    expect(text).toContain("Po splatnosti (12)");
    expect(text).toContain("2026-0007 (https://x.cz/cs/invoices/7) · ACME s.r.o. · 1 210,00 Kč (splatnost 1. 10. 2026)");
    expect(text).toContain("a další 11…");
    expect(text).toContain("26. 10. 2026 · DPH a kontrolní hlášení (jen pokud se vás týká)");
    expect(html).toContain('href="https://x.cz/cs/unsubscribe/t"');
  });

  it("says so when nothing is unpaid or paid, in Slovak", () => {
    const { text } = renderWeeklyDigest({ ...base, unpaidCount: 0, unpaidTotals: [], overdue: [], overdueCount: 0, paid: [], paidTotals: [] }, "sk");
    expect(text).toContain("Všetky faktúry sú uhradené.");
    expect(text).toContain("Minulý týždeň neprišla žiadna platba.");
    expect(text).not.toContain("Po splatnosti");
  });

  it("is skipped when there is nothing to say", () => {
    expect(digestIsEmpty(base)).toBe(false);
    expect(digestIsEmpty({ ...base, unpaidCount: 0, paid: [], deadlines: [] })).toBe(true);
    expect(digestIsEmpty({ ...base, unpaidCount: 0, paid: [] })).toBe(false);
  });
});

describe("renderWeeklyDigest – tax-return line", () => {
  it("adds the link in spring when the cron passes one", () => {
    const { text, html } = renderWeeklyDigest({ ...base, taxReturn: { year: 2025, url: "https://x.cz/cs/reports/tax-return?year=2025" } }, "cs");
    expect(text).toContain("Daňové přiznání za 2025");
    expect(html).toContain('href="https://x.cz/cs/reports/tax-return?year=2025"');
    expect(renderWeeklyDigest({ ...base, taxReturn: { year: 2025, url: "https://x.cz" } }, "sk").text).toContain("Daňové priznanie za 2025");
  });

  it("no line without it", () => {
    expect(renderWeeklyDigest(base, "cs").text).not.toContain("Daňové přiznání");
    expect(renderWeeklyDigest({ ...base, taxReturn: null }, "en").text).not.toContain("Tax return");
  });
});

describe("chosenTaxKinds", () => {
  const profile = { country: "CZ", vatStatus: "non_payer", legalEntity: false } as const;
  it("uses the member's dashboard choice, dropping unknown kinds", () => {
    expect(chosenTaxKinds({ taxDeadlines: ["health", "bogus"] }, profile)).toEqual(["health"]);
    expect(chosenTaxKinds({ taxDeadlines: [] }, profile)).toEqual([]);
  });
  it("falls back to the defaults for the VAT status", () => {
    expect(chosenTaxKinds(null, profile).length).toBeGreaterThan(0);
    expect(chosenTaxKinds(null, profile)).not.toContain("vat_monthly");
  });
});
