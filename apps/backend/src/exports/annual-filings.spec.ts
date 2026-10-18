import { describe, expect, it } from "vitest";
import { computeCssz, computeDpfo, computeHealth, dpfdpFormFor, FormNotPublishedError, generateCsszOsvc, generateDpfdp, type FilingPerson } from "./annual-filings";

const person: FilingPerson = {
  submitter: {
    dic: "CZ8001011234",
    typDs: "F",
    jmeno: "Jana",
    prijmeni: "Nováková",
    nazevPravOsoby: "",
    obec: "Brno",
    ulice: "Masarykova",
    cPop: "12",
    cOrient: "3a",
    psc: "602 00",
    stat: "ČESKÁ REPUBLIKA",
    email: "jana@example.cz",
    telefon: "",
  },
  birthNumber: "800101/1234",
  taxOffice: 462,
};

describe("DPFO lines", () => {
  it("2025, 60 % flat expenses, basic credit and paid advances", () => {
    const d = computeDpfo({ year: 2025, income: 1_000_000, actualExpenses: 0, flatRate: 60, basis: "cash", taxAdvancesPaid: 10_000 });
    expect(d.rows).toMatchObject({ r101: 1_000_000, r102: 600_000, r113: 400_000, r56: 400_000, r57: 60_000, r60: 60_000, r64: 30_840, r71: 29_160, r84: 10_000, r91: 19_160 });
  });

  it("caps flat expenses (60 % → 1 200 000 Kč) and rounds the base down to hundreds", () => {
    const d = computeDpfo({ year: 2025, income: 2_100_050, actualExpenses: 0, flatRate: 60, basis: "cash" });
    expect(d.rows.r102).toBe(1_200_000);
    expect(d.rows.r56).toBe(900_000);
  });

  it("uses 48× the average wage for the 23 % rate in 2023 and 36× from 2024", () => {
    const d23 = computeDpfo({ year: 2023, income: 2_000_000, actualExpenses: 0, flatRate: null, basis: "cash" });
    expect(d23.rows.r57).toBe(305_155.84);
    const d24 = computeDpfo({ year: 2024, income: 2_000_000, actualExpenses: 0, flatRate: null, basis: "cash" });
    expect(d24.rows.r57).toBe(Math.round((1_582_812 * 0.15 + 417_188 * 0.23) * 100) / 100);
  });

  it("the spouse credit lowers the tax, never below zero", () => {
    const d = computeDpfo({ year: 2025, income: 300_000, actualExpenses: 0, flatRate: 60, basis: "cash", spouseCredit: true });
    expect(d.rows.r65a).toBe(24_840);
    expect(d.rows.r71).toBe(0);
  });

  it("a loss goes to ř. 61 and leaves the base at zero", () => {
    const d = computeDpfo({ year: 2025, income: 100_000, actualExpenses: 150_000, flatRate: null, basis: "accrual" });
    expect(d.rows.r113).toBe(-50_000);
    expect(d.rows.r61).toBe(50_000);
    expect(d.rows.r56).toBe(0);
  });
});

describe("DPFDP XML", () => {
  it("picks the form by tax year", () => {
    expect(dpfdpFormFor(2023)?.form).toBe("DPFDP6");
    expect(dpfdpFormFor(2025)?.form).toBe("DPFDP7");
    expect(dpfdpFormFor(2026)).toBeNull();
  });

  it("writes the EPO structure with flat-rate and accounting fields", () => {
    const xml = generateDpfdp(computeDpfo({ year: 2025, income: 1_000_000, actualExpenses: 0, flatRate: 60, basis: "cash" }), person);
    expect(xml).toContain('<DPFDP7 verzePis="01.01">');
    expect(xml).toMatch(/<VetaD dokument="DP7" k_uladis="DPF" dap_typ="B" rok="2025" c_ufo_cil="462"/);
    expect(xml).toContain('da_dan16="60000.00"');
    expect(xml).toMatch(/<VetaT kc_prij7="1000000" kc_vyd7="600000" kc_hosp_rozd="400000" kc_zd7p="400000" vyd7proc="A" uc_soust="1" m_podnik="12" pr_sazba="60"/);
    expect(xml).toMatch(/<VetaP dic="8001011234" rod_c="8001011234" jmeno="Jana" prijmeni="Nováková"/);
    expect(xml).toContain('c_pop="12" c_orient="3a" psc="60200"');
  });

  it("marks accounting (účetnictví) and actual expenses", () => {
    const xml = generateDpfdp(computeDpfo({ year: 2023, income: 500_000, actualExpenses: 200_000, flatRate: null, basis: "accrual" }), person);
    expect(xml).toContain('<DPFDP6 verzePis="03.01">');
    expect(xml).toContain('vyd7proc="N" uc_soust="2"');
    expect(xml).not.toContain("pr_sazba");
  });

  it("refuses a year without a published form", () => {
    expect(() => generateDpfdp(computeDpfo({ year: 2026, income: 1, actualExpenses: 0, flatRate: 60, basis: "cash" }), person)).toThrow(FormNotPublishedError);
  });
});

describe("přehled ČSSZ", () => {
  it("2025 main activity above the minimum; next advance at the 2026 minimum (ČSSZ zadání ř. 35/36)", () => {
    const c = computeCssz({ year: 2025, profit: 400_000, activity: "H", paidAdvances: 12 * 4759 });
    expect(c.rows).toMatchObject({ r20: 400_000, r21: 12, r24: 400_000, r25: 220_000, r27: 195_540, r28: 220_000, r32: 64_240, r33: 57_108, r34: 7_132 });
    expect(c.rows.r35).toBe(19_587);
    expect(c.rows.r36).toBe(5_720);
  });

  it("2026 minimum payer is settled at 35 % for the whole year", () => {
    const c = computeCssz({ year: 2026, profit: 0, activity: "H", paidAdvances: 6 * 5720 + 6 * 5005 });
    expect(c.rows.r28).toBe(205_668);
    expect(c.rows.r32).toBe(60_056);
    // Jan–Jun were paid at 40 %: that difference comes back.
    expect(c.rows.r34).toBe(60_056 - 64_350);
  });

  it("secondary activity below the rozhodná částka is not insured", () => {
    const low = computeCssz({ year: 2025, profit: 100_000, activity: "V", paidAdvances: 0 });
    expect(low.insured).toBe(false);
    expect(low.rows.r28).toBe(0);
    const high = computeCssz({ year: 2025, profit: 200_000, activity: "V", paidAdvances: 0 });
    expect(high.insured).toBe(true);
    expect(high.rows.r27).toBe(61_464);
    expect(high.rows.r28).toBe(110_000);
  });

  it("part of the year lowers the minimum by month", () => {
    const c = computeCssz({ year: 2025, profit: 0, activity: "H", months: [7, 8, 9, 10, 11, 12], paidAdvances: 0 });
    expect(c.rows.r21).toBe(6);
    expect(c.rows.r27).toBe(6 * 16_295);
  });

  it("writes the OSVC XML of the right year; the discount elements only from 2025", () => {
    const x25 = generateCsszOsvc(computeCssz({ year: 2025, profit: 400_000, activity: "H", paidAdvances: 0 }), person, new Date("2026-04-20T10:00:00Z"));
    expect(x25).toContain('xmlns="http://schemas.cssz.cz/OSVC2025"');
    expect(x25).toContain('<pvv pri="400000">');
    expect(x25).toContain("<m13>A</m13>");
    expect(x25).toContain("<pojposlev>64240</pojposlev>");
    expect(x25).toContain('<dat dre="2026-04-20" />');
    const x24 = generateCsszOsvc(computeCssz({ year: 2024, profit: 400_000, activity: "H", paidAdvances: 0 }), person);
    expect(x24).toContain("OSVC2024");
    expect(x24).not.toContain("pojposlev");
    expect(() => generateCsszOsvc(computeCssz({ year: 2026, profit: 1, activity: "H", paidAdvances: 0 }), person)).toThrow(FormNotPublishedError);
  });
});

describe("přehled pro zdravotní pojišťovnu", () => {
  it("50 % of profit, at least the monthly minimum × months, 13.5 %", () => {
    const low = computeHealth({ year: 2025, profit: 400_000, paidAdvances: 12 * 3143 });
    expect(low.base).toBe(12 * 23_279);
    expect(low.premium).toBe(37_712);
    expect(low.balance).toBe(37_712 - 37_716);
    const high = computeHealth({ year: 2025, profit: 1_000_000, paidAdvances: 0 });
    expect(high.base).toBe(500_000);
    expect(high.premium).toBe(67_500);
    expect(high.nextAdvance).toBe(5_625);
  });
});
