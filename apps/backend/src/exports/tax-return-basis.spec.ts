import { computeTaxReturnBasis, type TaxReturnBasisInput } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import { taxReturnCsv, taxReturnFileName, taxReturnPdf, taxReturnSections, type TaxReturnReport } from "./tax-return-basis";

const report = (over: Partial<TaxReturnBasisInput> = {}, extra: Partial<TaxReturnReport> = {}): TaxReturnReport => ({
  ...computeTaxReturnBasis({
    country: "CZ",
    year: 2025,
    income: 800_000,
    expensesByCategory: { software: 30_000, travel: 20_000, "": 5_000, "Školení": 1_000 },
    vatPayer: false,
    legalEntity: false,
    ...over,
  }),
  companyName: "Jana Nováková",
  basis: "cash",
  vatPayer: over.vatPayer ?? false,
  flatTaxRegime: false,
  counts: { invoices: 12, expenses: 40, missingRates: 0 },
  ...extra,
});

describe("taxReturnCsv", () => {
  it("Czech sheet: BOM, semicolons, CRLF, decimal comma, translated and free-text categories", () => {
    const csv = taxReturnCsv(report());
    expect(csv.startsWith("﻿Podklady pro daňové přiznání 2025\r\n")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines).toContain("Příjmy z uhrazených faktur (po odečtení dobropisů);800000,00");
    expect(lines).toContain("Software;30000,00");
    expect(lines).toContain("Cestovné;20000,00");
    expect(lines).toContain("Bez kategorie;5000,00");
    expect(lines).toContain("Školení;1000,00");
    expect(lines).toContain("Skutečné výdaje celkem;56000,00");
    expect(lines).toContain("Paušál 60 % (max. 1200000,00);480000,00");
    expect(lines).toContain("Listinně;1. 4. 2026");
    expect(lines).toContain("Elektronicky;4. 5. 2026");
    expect(csv).toContain("nejde o daňové poradenství");
    expect(csv).not.toContain("—");
  });

  it("marks a capped paušál", () => {
    expect(taxReturnCsv(report({ income: 2_500_000 }))).toContain("Paušál 60 % (max. 1200000,00);1200000,00 (strop)");
  });

  it("a VAT payer is told the paušální daň is not available", () => {
    const csv = taxReturnCsv(report({ vatPayer: true }));
    expect(csv).toContain("Plátce DPH;ano – částky bez DPH");
    expect(csv).toContain("Nelze – plátce DPH.");
  });

  it("the paušální režim note appears only for a company in the regime", () => {
    expect(taxReturnCsv(report({}, { flatTaxRegime: true }))).toContain("Jste v paušálním režimu");
    expect(taxReturnCsv(report())).not.toContain("Jste v paušálním režimu");
  });

  it("a company gets the sums, deadlines and the DPPO note, no paušály", () => {
    const csv = taxReturnCsv(report({ legalEntity: true }, { basis: "accrual", companyName: "Alfa s.r.o." }));
    expect(csv).toContain("Příjmy z vystavených faktur");
    expect(csv).toContain("DPPO");
    expect(csv).not.toContain("Výdajové paušály");
    expect(csv).not.toContain("Paušální daň");
  });

  it("a year without parameters says so instead of estimating", () => {
    const csv = taxReturnCsv(report({ year: 2031 }));
    expect(csv).toContain("Pro rok 2031 zatím nemáme zveřejněné sazby a limity");
    expect(csv).not.toContain("S paušálem – Daň z příjmů");
  });

  it("quotes cells with a semicolon", () => {
    expect(taxReturnCsv(report({}, { companyName: "A; B" }))).toContain('Firma;"A; B"');
  });

  it("defuses free-text categories that Excel would run as a formula, but keeps negative amounts as numbers", () => {
    const csv = taxReturnCsv(report({ expensesByCategory: { '=HYPERLINK("http://x";"y")': 100, "-2+3": 200, "@SUM(A1)": -50 } }));
    const lines = csv.split("\r\n");
    expect(lines).toContain(`"'=HYPERLINK(""http://x"";""y"")";100,00`);
    expect(lines).toContain("'-2+3;200,00");
    expect(lines).toContain("'@SUM(A1);-50,00");
  });

  it("Slovak sheet in Slovak, with the SK deadlines and the 20 000 € paušál", () => {
    const csv = taxReturnCsv(report({ country: "SK", income: 30_000, expensesByCategory: { rent: 6_000 } }));
    expect(csv.startsWith("﻿Podklady k daňovému priznaniu 2025")).toBe(true);
    expect(csv).toContain("Nájom;6000,00");
    expect(csv).toContain("Paušál 60 % (max. 20000,00);18000,00");
    expect(csv).toContain("Riadny termín;31. 3. 2026");
    expect(csv).not.toContain("Paušálna daň");
    expect(taxReturnFileName({ country: "SK", year: 2025 })).toBe("podklady-dp-2025");
    expect(taxReturnFileName({ country: "CZ", year: 2025 })).toBe("podklady-dap-2025");
  });
});

describe("taxReturnSections", () => {
  it("lists the estimate for both kinds of expenses when the year has parameters", () => {
    const est = taxReturnSections(report(), String).find((s) => s.head === "Orientační odhad daně a pojistného")!;
    expect(est.rows.map(([k]) => k)).toContain("S paušálem – Celkem za rok");
    expect(est.rows.map(([k]) => k)).toContain("Se skutečnými výdaji – Celkem za rok");
  });
});

describe("taxReturnPdf", () => {
  it("renders a PDF", async () => {
    const pdf = await taxReturnPdf(report());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
