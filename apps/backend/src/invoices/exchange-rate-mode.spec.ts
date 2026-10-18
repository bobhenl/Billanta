import { describe, expect, it } from "vitest";
import { invoiceFormPrefsSchema } from "../tenants/invoice-form-prefs";
import { annualRateFor, exchangeRateSettingsOf, isCnbRate, mayHideConversion, rateLineLabel, resolveRateMode } from "./exchange-rate-mode";

const labels = { fxRate: "Kurz ČNB", fxRateOn: "Kurz ČNB k {date}", fxRateEcbOn: "Kurz ECB k {date}", fxRateAnnual: "Jednotný kurz pro rok {year}", fxRateManual: "Kurz" };

describe("exchangeRateSettingsOf", () => {
  it("defaults to the daily ČNB rate for prefs saved before the setting", () => {
    expect(exchangeRateSettingsOf({})).toEqual({ mode: "cnb_daily", reportMode: "daily", annualRates: [] });
    expect(exchangeRateSettingsOf(null)).toEqual({ mode: "cnb_daily", reportMode: "daily", annualRates: [] });
    expect(exchangeRateSettingsOf({ exchangeRateMode: "weird", reportRateMode: "weird" })).toMatchObject({ mode: "cnb_daily", reportMode: "daily" });
  });
  it("reads the old single 'annual' setting as daily on invoices, annual in reports", () => {
    expect(exchangeRateSettingsOf({ exchangeRateMode: "annual" })).toMatchObject({ mode: "cnb_daily", reportMode: "annual" });
    expect(exchangeRateSettingsOf({ exchangeRateMode: "none", reportRateMode: "annual" })).toMatchObject({ mode: "none", reportMode: "annual" });
  });
  it("keeps valid annual rates and drops broken ones", () => {
    const s = exchangeRateSettingsOf({
      exchangeRateMode: "annual",
      annualRates: [{ year: 2026, currency: "EUR", rate: 24.5 }, { year: 2026, currency: "eur", rate: 1 }, { year: 2026, currency: "USD", rate: 0 }, null],
    });
    expect(s).toEqual({ mode: "cnb_daily", reportMode: "annual", annualRates: [{ year: 2026, currency: "EUR", rate: 24.5 }] });
  });
});

describe("invoiceFormPrefsSchema rate fields", () => {
  it("stores both modes and the annual rates in camelCase, newest year first", () => {
    const p = invoiceFormPrefsSchema.parse({
      exchange_rate_mode: "none",
      report_rate_mode: "annual",
      annual_rates: [
        { year: 2025, currency: "EUR", rate: 25.1 },
        { year: 2026, currency: "EUR", rate: 24.6 },
      ],
    });
    expect(p).toMatchObject({ exchangeRateMode: "none", reportRateMode: "annual" });
    expect(p.annualRates.map((r) => r.year)).toEqual([2026, 2025]);
  });
  it("defaults to the daily rate everywhere", () => {
    expect(invoiceFormPrefsSchema.parse({})).toMatchObject({ exchangeRateMode: "cnb_daily", reportRateMode: "daily" });
  });
  it("takes the old 'annual' from an old client as daily on invoices, annual in reports", () => {
    expect(invoiceFormPrefsSchema.parse({ exchange_rate_mode: "annual" })).toMatchObject({ exchangeRateMode: "cnb_daily", reportRateMode: "annual" });
    expect(invoiceFormPrefsSchema.parse({ exchange_rate_mode: "annual", report_rate_mode: "daily" })).toMatchObject({ exchangeRateMode: "cnb_daily", reportRateMode: "daily" });
  });
  it("rejects two rates for the same year and currency, CZK and non-positive rates", () => {
    expect(invoiceFormPrefsSchema.safeParse({ annual_rates: [{ year: 2026, currency: "EUR", rate: 24 }, { year: 2026, currency: "EUR", rate: 25 }] }).success).toBe(false);
    expect(invoiceFormPrefsSchema.safeParse({ annual_rates: [{ year: 2026, currency: "CZK", rate: 1 }] }).success).toBe(false);
    expect(invoiceFormPrefsSchema.safeParse({ annual_rates: [{ year: 2026, currency: "EUR", rate: 0 }] }).success).toBe(false);
  });
});

describe("annualRateFor", () => {
  const rates = [
    { year: 2026, currency: "EUR", rate: 24.6 },
    { year: 2025, currency: "EUR", rate: 25.1 },
  ];
  it("picks the rate of the right year and currency", () => {
    expect(annualRateFor(rates, "eur", 2025)).toBe(25.1);
    expect(annualRateFor(rates, "EUR", 2026)).toBe(24.6);
  });
  it("is null when the company has no rate for that year", () => {
    expect(annualRateFor(rates, "EUR", 2024)).toBeNull();
    expect(annualRateFor(rates, "USD", 2026)).toBeNull();
  });
});

describe("mayHideConversion", () => {
  it("never for a VAT payer", () => {
    expect(mayHideConversion("payer", 0)).toBe(false);
    expect(mayHideConversion("payer", 120)).toBe(false);
  });
  it("for a non-payer, and for an identified person only on a document without VAT", () => {
    expect(mayHideConversion("non_payer", 0)).toBe(true);
    expect(mayHideConversion("identified", 0)).toBe(true);
    expect(mayHideConversion("identified", 42)).toBe(false);
  });
});

describe("resolveRateMode", () => {
  const base = { vatStatus: "payer" as const, totalVat: 210, manualRate: null };
  it("uses the daily ČNB rate by default", () => {
    expect(resolveRateMode({ ...base, setting: "cnb_daily" })).toEqual({ mode: "cnb_daily", source: "cnb" });
  });
  it("a rate typed on the draft wins", () => {
    expect(resolveRateMode({ ...base, setting: "cnb_daily", manualRate: 25 })).toEqual({ mode: "manual", source: "manual" });
  });
  it("a typed rate that is ČNB's for the day is the daily ČNB rate", () => {
    expect(resolveRateMode({ ...base, setting: "cnb_daily", manualRate: 25.12, manualIsCnb: true })).toEqual({ mode: "cnb_daily", source: "cnb" });
  });
  it("hides the conversion for a non-payer but still keeps a rate for reports", () => {
    expect(resolveRateMode({ ...base, vatStatus: "non_payer", totalVat: 0, setting: "none" })).toEqual({ mode: "none", source: "cnb" });
  });
  it("ignores 'none' for a VAT payer and prints the daily ČNB conversion", () => {
    expect(resolveRateMode({ ...base, setting: "none" })).toEqual({ mode: "cnb_daily", source: "cnb" });
    expect(resolveRateMode({ ...base, totalVat: 0, setting: "none" })).toEqual({ mode: "cnb_daily", source: "cnb" });
  });
  it("ignores 'none' for an identified person on a document with VAT", () => {
    expect(resolveRateMode({ ...base, vatStatus: "identified", totalVat: 21, setting: "none" }).mode).toBe("cnb_daily");
  });
  it("a Slovak company converts at the ECB rate", () => {
    expect(resolveRateMode({ ...base, home: "EUR", setting: "cnb_daily" })).toEqual({ mode: "ecb_daily", source: "ecb" });
    expect(resolveRateMode({ ...base, home: "EUR", vatStatus: "non_payer", totalVat: 0, setting: "none" })).toEqual({ mode: "none", source: "ecb" });
  });
});

describe("isCnbRate", () => {
  it("matches the ČNB rate as the form rounds it (4 decimals)", () => {
    expect(isCnbRate(25.12, 25.12)).toBe(true);
    expect(isCnbRate(0.1612, 0.16123)).toBe(true);
    expect(isCnbRate(0.1613, 0.16123)).toBe(false);
    expect(isCnbRate(25.5, 25.12)).toBe(false);
    expect(isCnbRate(25.12, null)).toBe(false);
  });
});

describe("rateLineLabel", () => {
  const day = new Date("2026-03-14T10:00:00Z");
  it("names the ČNB list day", () => {
    expect(rateLineLabel(labels, { exchangeRateMode: "cnb_daily", exchangeRateDate: "2026-03-13" }, day)).toBe("Kurz ČNB k 13.03.2026");
  });
  it("names the year of an annual rate", () => {
    expect(rateLineLabel(labels, { exchangeRateMode: "annual", exchangeRateDate: "2026-01-01" }, day)).toBe("Jednotný kurz pro rok 2026");
  });
  it("names the ECB fixing day", () => {
    expect(rateLineLabel(labels, { exchangeRateMode: "ecb_daily", exchangeRateDate: "2026-03-13" }, day)).toBe("Kurz ECB k 13.03.2026");
  });
  it("prints nothing for a hidden conversion", () => {
    expect(rateLineLabel(labels, { exchangeRateMode: "none", exchangeRateDate: null }, day)).toBeNull();
  });
  it("keeps the old wording for documents issued before the setting", () => {
    expect(rateLineLabel(labels, { exchangeRateMode: null, exchangeRateDate: null }, day)).toBe("Kurz ČNB");
  });
  it("a typed rate does not claim to be ČNB's", () => {
    expect(rateLineLabel(labels, { exchangeRateMode: "manual", exchangeRateDate: null }, day)).toBe("Kurz");
  });
  it("fills the date in both halves of a bilingual label", () => {
    const bi = { ...labels, fxRateOn: "Kurz ČNB k {date} / ČNB rate as of {date}" };
    expect(rateLineLabel(bi, { exchangeRateMode: "cnb_daily", exchangeRateDate: "2026-03-13" }, day)).toBe("Kurz ČNB k 13.03.2026 / ČNB rate as of 13.03.2026");
  });
});
