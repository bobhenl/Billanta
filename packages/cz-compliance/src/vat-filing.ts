import { DATASET_CHECKED } from './legislation-datasets.js';
import { nextCzechWorkingDay } from './working-days.js';

/**
 * Facts about Czech VAT filings shared by the backend XML generators, the
 * in-app export box and the public filing guide, so the "form version / last
 * checked" line the user reads always matches the files we generate.
 *
 * VAT_FORM_VERSIONS is the `verzePis` written into each EPO XML. When
 * Finanční správa publishes a new structure, update it here together with
 * the generator (apps/backend/src/exports/vat-returns.ts) and move
 * VAT_INFO_CHECKED to the day the guide and the rules were re-read.
 */
export const VAT_FORM_VERSIONS = {
  DPHDP3: '01.02',
  DPHKH1: '03.01',
  DPHSHV: '02.01'
} as const;

/**
 * The day the VAT guide text and form versions were last compared with
 * financnisprava.gov.cz by hand (YYYY-MM-DD). Pages prefer the monitor's
 * date via datasetChecked('vat_forms', …); this stays as the fallback.
 */
export const VAT_INFO_CHECKED = DATASET_CHECKED.vat_forms;

/** Official source the guide and the export box link to. */
export const VAT_OFFICIAL_URL = 'https://financnisprava.gov.cz/cs/dane/dane/dan-z-pridane-hodnoty';

export interface VatDeadlines {
  /** Next monthly deadline (přiznání + kontrolní + souhrnné hlášení) and the month it is for (1st day). */
  monthly: { date: Date; period: Date; days: number };
  /** Next quarterly deadline and the quarter it is for. */
  quarterly: { date: Date; quarter: number; year: number; days: number };
}

/**
 * The next VAT filing deadlines from `now`: the 25th of the following month
 * (monthly payers) or of the month after a quarter (quarterly payers), moved
 * to the next working day when it falls on a weekend or holiday (§ 33 DŘ).
 */
export function nextVatDeadlines(now = new Date()): VatDeadlines {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // This month's 25th if still ahead, else next month's.
  let monthly = nextCzechWorkingDay(new Date(now.getFullYear(), now.getMonth(), 25));
  if (monthly < today) monthly = nextCzechWorkingDay(new Date(now.getFullYear(), now.getMonth() + 1, 25));
  const periodOf = (d: Date) => new Date(d.getFullYear(), d.getMonth() - 1, 1);
  // Quarterly payers: 25th of Jan/Apr/Jul/Oct.
  let q = Math.floor(now.getMonth() / 3) * 3;
  let quarterly = nextCzechWorkingDay(new Date(now.getFullYear(), q, 25));
  if (quarterly < today) {
    q += 3;
    quarterly = nextCzechWorkingDay(new Date(now.getFullYear(), q, 25));
  }
  const qPeriod = new Date(quarterly.getFullYear(), quarterly.getMonth() - 3, 1);
  const days = (d: Date) => Math.round((d.getTime() - today.getTime()) / 86_400_000);
  return {
    monthly: { date: monthly, period: periodOf(monthly), days: days(monthly) },
    quarterly: { date: quarterly, quarter: Math.floor(qPeriod.getMonth() / 3) + 1, year: qPeriod.getFullYear(), days: days(quarterly) }
  };
}
