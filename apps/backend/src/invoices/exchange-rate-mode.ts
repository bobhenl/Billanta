/**
 * How a foreign-currency document converts to CZK (Settings → Faktury →
 * Kurz pro cizí měny), and what of it the document prints.
 *
 * Company setting (`tenants.invoice_form_prefs.exchangeRateMode`):
 *  - `cnb_daily`: the ČNB rate of the taxable supply date (DUZP, else the
 *    issue date); ČNB answers a weekend or holiday with the last working
 *    day's list (§4 odst. 5 ZDPH, §38 odst. 1 ZDPH);
 *  - `annual`: one rate per currency for the calendar year, set by the
 *    company ("jednotný kurz", §38 odst. 2 ZDPH);
 *  - `none`: no conversion printed. Only for a company that is not a VAT
 *    payer, on a document that charges no VAT: a payer's tax document in a
 *    foreign currency must state the VAT in CZK (§29 odst. 2 ZDPH).
 *
 * The mode actually used is stored on the document at issue
 * (`invoices.exchange_rate_mode`), so changing the setting later never
 * rewrites an issued document. Documents issued before this existed have
 * null there and keep printing exactly what they printed before.
 */

export const EXCHANGE_RATE_SETTINGS = ["cnb_daily", "annual", "none"] as const;
export type ExchangeRateSetting = (typeof EXCHANGE_RATE_SETTINGS)[number];

/** Stored per document. `manual` = a rate typed on the draft by the user. */
export const STORED_RATE_MODES = ["cnb_daily", "annual", "manual", "none"] as const;
export type StoredRateMode = (typeof STORED_RATE_MODES)[number];

export interface AnnualRate {
  year: number;
  currency: string;
  /** CZK per 1 unit. */
  rate: number;
}

export interface ExchangeRateSettings {
  mode: ExchangeRateSetting;
  annualRates: AnnualRate[];
}

type VatStatus = "payer" | "identified" | "non_payer";

/** The company's rate settings from its stored prefs; old or unknown values fall back to the daily ČNB rate. */
export function exchangeRateSettingsOf(prefs: unknown): ExchangeRateSettings {
  const p = (prefs ?? {}) as { exchangeRateMode?: unknown; annualRates?: unknown };
  const mode = (EXCHANGE_RATE_SETTINGS as readonly unknown[]).includes(p.exchangeRateMode) ? (p.exchangeRateMode as ExchangeRateSetting) : "cnb_daily";
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
  return { mode, annualRates };
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
 *  - a rate typed on the draft always wins (`manual`);
 *  - `annual` uses the company's rate for that year and currency, and falls
 *    back to the daily ČNB rate when there is none (printed as such, so the
 *    document never claims a rate it does not use);
 *  - `none` is honoured only when `mayHideConversion` allows it, otherwise
 *    the document prints the daily ČNB conversion. The rate is still kept
 *    on a hidden document, for reports and exports.
 */
export function resolveRateMode(input: {
  setting: ExchangeRateSetting;
  vatStatus: VatStatus;
  totalVat: number;
  manualRate: number | null;
  annualRate: number | null;
}): { mode: StoredRateMode; source: "manual" | "annual" | "cnb" } {
  const source = input.manualRate != null && input.manualRate > 0 ? "manual" : input.setting === "annual" && input.annualRate != null && input.annualRate > 0 ? "annual" : "cnb";
  if (input.setting === "none" && mayHideConversion(input.vatStatus, input.totalVat)) return { mode: "none", source };
  return { mode: source === "manual" ? "manual" : source === "annual" ? "annual" : "cnb_daily", source };
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
  labels: { fxRate: string; fxRateOn: string; fxRateAnnual: string; fxRateManual: string },
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
    case "cnb_daily": {
      const day = invoice.exchangeRateDate ? czechDay(invoice.exchangeRateDate) : fallbackDay ? czechDay(isoPragueDay(fallbackDay)) : null;
      // split/join: a bilingual label holds the placeholder twice.
      return day ? labels.fxRateOn.split("{date}").join(day) : labels.fxRate;
    }
    default:
      return labels.fxRate;
  }
}

/** Calendar day in Prague as YYYY-MM-DD (dates are stored as timestamps). */
export function isoPragueDay(day: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
}
