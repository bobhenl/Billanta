import { isVatStatus, type VatStatus } from './vat-status.js';
import { nextCzechWorkingDay } from './working-days.js';

/**
 * Czech tax & insurance deadlines for the dashboard reminder (a calendar only,
 * no filings are tracked). Tax rows come from the official Finanční správa
 * calendar (backend `dashboard/tax-calendar.ts`, passed in as `official`); insurance advances and the
 * annual overviews aren't in it, so those — and everything, when the official
 * source is unreachable — are computed here (shared by the dashboard widget and the iCal feed): statutory due days, with a day on
 * a weekend or public holiday moved to the next working day (§ 33 daňového řádu).
 */

export const TAX_DEADLINE_KINDS = [
  'vat_monthly',
  'vat_quarterly',
  'vat_other',
  'vat_identified',
  'ec_sales_list',
  'health',
  'social',
  'income_tax',
  'flat_tax',
  'overviews',
  'payroll',
  'road_tax',
  'property_tax'
] as const;
export type TaxDeadlineKind = (typeof TAX_DEADLINE_KINDS)[number];

export interface TaxDeadline {
  kind: TaxDeadlineKind;
  date: Date;
  /** Whole days from today (0 = today). */
  daysLeft: number;
  /** Official wording (Finanční správa rows of the same kind on that day). */
  details?: string[];
  /**
   * Due only if something happened in the period and the app could not see
   * that it did (identified person: a service bought from abroad; souhrnné
   * hlášení: a service to an EU business). Shown as "only if …".
   */
  conditional?: boolean;
}

/**
 * What decides which deadlines apply to the account. `activity` lists the
 * months ("YYYY-MM") the app saw something in; missing = unknown (iCal feed),
 * and the conditional rows are then kept and flagged.
 */
export interface TaxProfile {
  country: string;
  vatStatus: VatStatus;
  /** s.r.o., a.s. …: no OSVČ insurance advances, no flat tax, no overviews. */
  legalEntity: boolean;
  activity?: {
    /** Months with an issued invoice for a service to a business in another EU state. */
    euSalesMonths: string[];
    /** Months with an expense from a supplier abroad (identified person: VAT due under reverse charge). */
    foreignPurchaseMonths: string[];
  };
}

/** A row of `GET /api/v1/dashboard/tax-calendar`. */
export interface OfficialTaxEvent {
  date: string;
  tax: string;
  description: string;
  kind: 'vat' | 'vat_other' | 'income_tax' | 'flat_tax' | 'payroll' | 'road_tax' | 'property_tax' | 'other';
  quarterly: boolean;
}

/** Kinds the official calendar covers; the rest are always computed locally. */
const OFFICIAL_KINDS: readonly TaxDeadlineKind[] = ['vat_monthly', 'vat_quarterly', 'vat_other', 'income_tax', 'flat_tax', 'payroll', 'road_tax', 'property_tax'];

/** What a company sees until it picks its own set in the dashboard customizer (`true`/`false` = legacy plátce/neplátce). */
export function defaultTaxDeadlineKinds(status: VatStatus | boolean): TaxDeadlineKind[] {
  const s: VatStatus = isVatStatus(status) ? status : status ? 'payer' : 'non_payer';
  const vat: TaxDeadlineKind[] = s === 'payer' ? ['vat_monthly', 'ec_sales_list'] : s === 'identified' ? ['vat_identified', 'ec_sales_list'] : [];
  return [...vat, 'health', 'social', 'income_tax', 'overviews'];
}

const VAT_KINDS: readonly TaxDeadlineKind[] = ['vat_monthly', 'vat_quarterly', 'vat_other', 'vat_identified', 'ec_sales_list'];
/** Only a payer files the regular return and kontrolní hlášení (§101c ZDPH); OSS and the like are payer-only too. */
const PAYER_ONLY: readonly TaxDeadlineKind[] = ['vat_monthly', 'vat_quarterly', 'vat_other'];
const OSVC_ONLY: readonly TaxDeadlineKind[] = ['health', 'social', 'flat_tax', 'overviews'];
/** Czech-only: paušální daň and the ČSSZ / health-insurer overviews. */
const CZ_ONLY: readonly TaxDeadlineKind[] = ['flat_tax', 'overviews'];

/** Drops the kinds that can't apply to this account (a chosen kind that doesn't fit is hidden, not deleted). */
export function relevantTaxDeadlineKinds(kinds: readonly TaxDeadlineKind[], profile: TaxProfile): TaxDeadlineKind[] {
  const sk = profile.country.toUpperCase() === 'SK';
  return kinds.filter((k) => {
    if (profile.legalEntity && OSVC_ONLY.includes(k)) return false;
    if (sk && CZ_ONLY.includes(k)) return false;
    if (profile.vatStatus === 'non_payer' && VAT_KINDS.includes(k)) return false;
    if (profile.vatStatus === 'identified' && PAYER_ONLY.includes(k)) return false;
    if (profile.vatStatus === 'payer' && k === 'vat_identified') return false;
    return true;
  });
}

const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Applies the account's activity to the conditional kinds; a deadline on the
 * 25th covers the month before it. Souhrnné hlášení without an EU service
 * that month is dropped. An identified person's return without a seen
 * foreign purchase stays, flagged "only if …" (ads bought abroad are often
 * not booked as an expense).
 */
export function applyTaxActivity(deadlines: TaxDeadline[], profile: TaxProfile): TaxDeadline[] {
  const out: TaxDeadline[] = [];
  for (const d of deadlines) {
    if (d.kind !== 'ec_sales_list' && d.kind !== 'vat_identified') {
      out.push(d);
      continue;
    }
    const period = monthKeyOf(new Date(d.date.getFullYear(), d.date.getMonth() - 1, 1));
    const months = profile.activity ? (d.kind === 'ec_sales_list' ? profile.activity.euSalesMonths : profile.activity.foreignPurchaseMonths) : null;
    if (months?.includes(period)) out.push(d);
    else if (d.kind === 'vat_identified' || !months) out.push({ ...d, conditional: true });
  }
  return out;
}

/** Upcoming deadlines for this account: relevant kinds only, conditional rows flagged or dropped (see `applyTaxActivity`). */
export function taxDeadlinesFor(
  kinds: readonly TaxDeadlineKind[],
  profile: TaxProfile,
  official: OfficialTaxEvent[] | null,
  today = new Date(),
  horizonDays = 45
): TaxDeadline[] {
  return applyTaxActivity(mergeTaxDeadlines(relevantTaxDeadlineKinds(kinds, profile), official, today, horizonDays), profile);
}

/** s.r.o., spol. s r.o., a.s., v.o.s., k.s., z.s., z.ú., o.p.s., družstvo, SE at the end of the registered name. */
const LEGAL_FORM = /(s\.?\s?r\.\s?o\.|spol\.|a\.\s?s\.|v\.\s?o\.\s?s\.|k\.\s?s\.|z\.\s?s\.|z\.\s?ú\.|o\.\s?p\.\s?s\.|družstvo|\bSE)\s*$/i;

/** A company (not an OSVČ / SZČO), told from the legal form at the end of its registered name. */
export const isLegalEntityName = (legalName: string | null | undefined) => LEGAL_FORM.test((legalName ?? '').trim());

const day = (y: number, m: number, d: number) => new Date(y, m, d);

/** Statutory (unshifted) due days of one kind falling in `year`. */
function rawDates(kind: TaxDeadlineKind, year: number): Date[] {
  const months = Array.from({ length: 12 }, (_, m) => m);
  switch (kind) {
    // DPH přiznání + kontrolní hlášení (+ souhrnné hlášení) za předchozí měsíc.
    case 'vat_monthly':
      return months.map((m) => day(year, m, 25));
    // Čtvrtletní plátce: 25. den po skončení čtvrtletí.
    case 'vat_quarterly':
      return [0, 3, 6, 9].map((m) => day(year, m, 25));
    // OSS/CESOP/SME podání: only from the official calendar.
    case 'vat_other':
      return [];
    // Identifikovaná osoba: přiznání do 25 dnů po měsíci, ve kterém měla povinnost přiznat daň (§101/1 a 5 ZDPH).
    case 'vat_identified':
      return months.map((m) => day(year, m, 25));
    // Souhrnné hlášení do 25 dnů po skončení měsíce (§102 ZDPH; SK súhrnný výkaz §80 ZoDPH).
    case 'ec_sales_list':
      return months.map((m) => day(year, m, 25));
    // Záloha OSVČ na zdravotní pojištění za předchozí měsíc.
    case 'health':
      return months.map((m) => day(year, m, 8));
    // Záloha OSVČ na sociální pojištění za předchozí měsíc.
    case 'social':
      return months.map((m) => day(year, m, 20));
    // Přiznání DPFO/DPPO podané elektronicky (papírově do 1. 4., s poradcem do 1. 7.).
    case 'income_tax':
      return [day(year, 4, 1)];
    // Splatnost měsíční zálohy v paušálním režimu.
    case 'flat_tax':
      return months.map((m) => day(year, m, 20));
    // Zaměstnavatel: odvod záloh na daň ze závislé činnosti za předchozí měsíc.
    case 'payroll':
      return months.map((m) => day(year, m, 20));
    // Přehledy OSVČ pro ČSSZ a zdravotní pojišťovnu (měsíc po elektronickém přiznání).
    case 'overviews':
      return [day(year, 5, 1)];
    case 'road_tax':
      return [day(year, 0, 31)];
    case 'property_tax':
      return [day(year, 4, 31)];
  }
}

const parseIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return day(y!, m! - 1, d!);
};

function officialKind(e: OfficialTaxEvent, kinds: readonly TaxDeadlineKind[]): TaxDeadlineKind | null {
  if (e.kind === 'vat') {
    if (kinds.includes('vat_monthly')) return 'vat_monthly';
    return kinds.includes('vat_quarterly') && e.quarterly ? 'vat_quarterly' : null;
  }
  if (e.kind === 'other') return null;
  return kinds.includes(e.kind) ? e.kind : null;
}

/**
 * Upcoming deadlines: official rows for the tax kinds (grouped per kind and
 * day) plus locally computed insurance ones. `official` = null → all local.
 */
export function mergeTaxDeadlines(
  kinds: readonly TaxDeadlineKind[],
  official: OfficialTaxEvent[] | null,
  today = new Date(),
  horizonDays = 45
): TaxDeadline[] {
  if (!official) return upcomingTaxDeadlines(kinds, today, horizonDays);
  const start = day(today.getFullYear(), today.getMonth(), today.getDate());
  const groups = new Map<string, TaxDeadline>();
  for (const e of official) {
    const kind = officialKind(e, kinds);
    if (!kind) continue;
    const date = parseIso(e.date);
    const daysLeft = Math.round((date.getTime() - start.getTime()) / 86_400_000);
    if (daysLeft < 0 || daysLeft > horizonDays) continue;
    const id = `${kind}-${e.date}`;
    const group = groups.get(id) ?? { kind, date, daysLeft, details: [] };
    group.details!.push(e.description);
    groups.set(id, group);
  }
  const local = upcomingTaxDeadlines(
    kinds.filter((k) => !OFFICIAL_KINDS.includes(k)),
    today,
    horizonDays
  );
  return [...groups.values(), ...local].sort((a, b) => a.daysLeft - b.daysLeft || TAX_DEADLINE_KINDS.indexOf(a.kind) - TAX_DEADLINE_KINDS.indexOf(b.kind));
}

/** Upcoming deadlines of the chosen kinds within `horizonDays`, soonest first (computed locally). */
export function upcomingTaxDeadlines(kinds: readonly TaxDeadlineKind[], today = new Date(), horizonDays = 45): TaxDeadline[] {
  const start = day(today.getFullYear(), today.getMonth(), today.getDate());
  const out: TaxDeadline[] = [];
  for (const kind of kinds) {
    for (const year of [start.getFullYear(), start.getFullYear() + 1]) {
      for (const raw of rawDates(kind, year)) {
        const date = nextCzechWorkingDay(raw);
        const daysLeft = Math.round((date.getTime() - start.getTime()) / 86_400_000);
        if (daysLeft >= 0 && daysLeft <= horizonDays) out.push({ kind, date, daysLeft });
      }
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || TAX_DEADLINE_KINDS.indexOf(a.kind) - TAX_DEADLINE_KINDS.indexOf(b.kind));
}
