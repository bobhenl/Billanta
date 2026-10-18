/**
 * How a foreign-currency document converts to the company's home currency
 * (Settings → Faktury → Kurz u faktur v cizí měně). The home currency is
 * CZK, or EUR for a Slovak company (`homeCurrencyOf`). A Slovak company
 * always gets the ECB rate of the day before the tax point (§ 26 ods. 1
 * zákona č. 222/2004 Z. z.), stored as `ecb_daily`; the settings below are
 * the Czech ones. Two separate choices:
 *
 * What the document prints (`tenants.invoice_form_prefs.exchangeRateMode`):
 *  - `cnb_daily`: the ČNB rate valid on the taxable supply date (DUZP, else
 *    the issue date); ČNB answers a weekend or holiday with the last working
 *    day's list (§ 38 odst. 1 ZDPH). A VAT payer always gets this one;
 *  - `none`: no conversion printed. Only for a company that is not a VAT
 *    payer, on a document that charges no VAT: a payer's tax document in a
 *    foreign currency must state the VAT in CZK (§ 29 odst. 2 ZDPH).
 *
 * Which rate reports, CZK totals and the income-tax estimate use
 * (`reportRateMode`):
 *  - `daily`: the rate stored on each document;
 *  - `annual`: the "jednotný kurz" of the year (§ 38 odst. 1 zákona
 *    o daních z příjmů), computed from ČNB month-end rates (uniform-rate.ts)
 *    unless the company typed its own for that year (`annualRates`).
 *    It never goes on a document: VAT needs the daily rate.
 *
 * The printed mode is stored on the document at issue
 * (`invoices.exchange_rate_mode`), so changing the setting later never
 * rewrites an issued document. Documents issued before this existed have
 * null there and keep printing exactly what they printed before; documents
 * issued with the old "annual" invoice setting keep `annual`.
 */

import type { HomeCurrency } from "@faktur/cz-compliance";

export const EXCHANGE_RATE_SETTINGS = ["cnb_daily", "none"] as const;
export type ExchangeRateSetting = (typeof EXCHANGE_RATE_SETTINGS)[number];

export const REPORT_RATE_MODES = ["daily", "annual"] as const;
export type ReportRateMode = (typeof REPORT_RATE_MODES)[number];

/** Stored per document. `manual` = a rate typed by the user; `annual` only on documents from the old setting. */
export const STORED_RATE_MODES = ["cnb_daily", "ecb_daily", "annual", "manual", "none"] as const;
export type StoredRateMode = (typeof STORED_RATE_MODES)[number];

export interface AnnualRate {
  year: number;
  currency: string;
  /** CZK per 1 unit. */
  rate: number;
}

export interface ExchangeRateSettings {
  mode: ExchangeRateSetting;
  reportMode: ReportRateMode;
  /** The company's own jednotný kurz per year and currency; overrides the computed one. */
  annualRates: AnnualRate[];
}

type VatStatus = "payer" | "identified" | "non_payer";

/**
 * The company's rate settings from its stored prefs; old or unknown values
 * fall back to the daily ČNB rate. The old single setting "annual" (annual
 * rate printed on invoices) reads as daily on invoices + annual in reports.
 */
export function exchangeRateSettingsOf(prefs: unknown): ExchangeRateSettings {
  const p = (prefs ?? {}) as { exchangeRateMode?: unknown; reportRateMode?: unknown; annualRates?: unknown };
  const mode = (EXCHANGE_RATE_SETTINGS as readonly unknown[]).includes(p.exchangeRateMode) ? (p.exchangeRateMode as ExchangeRateSetting) : "cnb_daily";
  const reportMode = (REPORT_RATE_MODES as readonly unknown[]).includes(p.reportRateMode)
    ? (p.reportRateMode as ReportRateMode)
    : p.exchangeRateMode === "annual"
      ? "annual"
      : "daily";
  const annualRates = Array.isArray(p.annualRates)
    ? (p.annualRates as Partial<AnnualRate>[]).filter(
        (r): r is AnnualRate =>
          !!r &&
          typeof r.year === "number" &&
          Number.isInteger(r.year) &&
          typeof r.currency === "string" &&
          /^[A-Z]{3}$/.test(r.currency) &&
          typeof r.rate === "number" &&
          Number.isFinite(r.rate) &&
          r.rate > 0,
      )
    : [];
  return { mode, reportMode, annualRates };
}

/** The company's own rate for `currency` in `year`, or null when it has none. */
export function annualRateFor(rates: readonly AnnualRate[], currency: string, year: number): number | null {
  const code = currency.toUpperCase();
  return rates.find((r) => r.year === year && r.currency === code)?.rate ?? null;
}

/**
 * Whether the conversion may be left off the document: never for a VAT
 * payer, and only on a document that charges no VAT.
 */
export function mayHideConversion(vatStatus: VatStatus, totalVat: number): boolean {
  return vatStatus !== "payer" && Math.abs(totalVat) < 0.005;
}

/**
 * The mode a document gets at issue and where its rate comes from.
 *  - a rate typed on the draft wins (`manual`), unless it is the ČNB rate
 *    of the document's day (the form's "Načíst z ČNB" button): the caller
 *    passes `manualIsCnb` and it is stored as `cnb_daily`;
 *  - `none` is honoured only when `mayHideConversion` allows it, otherwise
 *    the document prints the daily ČNB conversion. The rate is still kept
 *    on a hidden document, for reports and exports.
 */
export function resolveRateMode(input: {
  setting: ExchangeRateSetting;
  vatStatus: VatStatus;
  totalVat: number;
  manualRate: number | null;
  manualIsCnb?: boolean;
  /** Home currency; EUR (a Slovak company) converts at the ECB rate. */
  home?: HomeCurrency;
}): { mode: StoredRateMode; source: "manual" | "cnb" | "ecb" } {
  const daily = input.home === "EUR" ? "ecb" : "cnb";
  const source = input.manualRate != null && input.manualRate > 0 && !input.manualIsCnb ? "manual" : daily;
  if (input.setting === "none" && mayHideConversion(input.vatStatus, input.totalVat)) return { mode: "none", source };
  return { mode: source === "manual" ? "manual" : source === "ecb" ? "ecb_daily" : "cnb_daily", source };
}

/**
 * Whether a typed rate is the ČNB rate (`cnb`, CZK per 1 unit): the form
 * fills the button's rate rounded to 4 decimals.
 */
export function isCnbRate(typed: number, cnb: number | null | undefined): boolean {
  return cnb != null && cnb > 0 && Math.abs(typed - cnb) < 0.00005 + 1e-9;
}

/** Year of the day the rate belongs to (DUZP, else the issue date), in Prague time. */
export function rateYearOf(day: Date): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric" }).format(day));
}

/** "DD.MM.YYYY" from a stored "YYYY-MM-DD". */
export function czechDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * The words before the rate on the PDF, per stored mode; null = print no
 * conversion at all. Documents from before the setting (`mode` null) keep
 * the old wording.
 */
export function rateLineLabel(
  labels: { fxRate: string; fxRateOn: string; fxRateEcbOn: string; fxRateAnnual: string; fxRateManual: string },
  invoice: { exchangeRateMode: string | null; exchangeRateDate: string | null },
  fallbackDay: Date | null,
): string | null {
  switch (invoice.exchangeRateMode) {
    case "none":
      return null;
    case "annual": {
      const year = invoice.exchangeRateDate ? invoice.exchangeRateDate.slice(0, 4) : fallbackDay ? String(rateYearOf(fallbackDay)) : "";
      return labels.fxRateAnnual.split("{year}").join(year).trim();
    }
    case "manual":
      return labels.fxRateManual;
    case "cnb_daily":
    case "ecb_daily": {
      const day = invoice.exchangeRateDate ? czechDay(invoice.exchangeRateDate) : fallbackDay ? czechDay(isoPragueDay(fallbackDay)) : null;
      const label = invoice.exchangeRateMode === "ecb_daily" ? labels.fxRateEcbOn : labels.fxRateOn;
      // split/join: a bilingual label holds the placeholder twice.
      return day ? label.split("{date}").join(day) : labels.fxRate;
    }
    default:
      return labels.fxRate;
  }
}

/** Calendar day in Prague as YYYY-MM-DD (dates are stored as timestamps). */
export function isoPragueDay(day: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
}
