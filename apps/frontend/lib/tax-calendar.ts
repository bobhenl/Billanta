import { taxCalendarYear, withImpliedTaxDeadlineKinds, type TaxCalendarEntry, type TaxDeadlineKind } from '@faktur/cz-compliance';

/**
 * The public tax calendar (/calculators/tax-calendar and its .ics feed):
 * which deadlines a visitor's situation brings, as a profile that fits in a
 * query string, so the page and the calendar subscription agree. The dates
 * themselves come from cz-compliance (`taxCalendarYear`, the same rules as
 * the dashboard reminder, CZ or SK, moved off weekends and holidays).
 */

export const CAL_COUNTRIES = ['CZ', 'SK'] as const;
export const CAL_ENTITIES = ['osvc', 'flat', 'company'] as const;
export const CAL_VAT = ['none', 'monthly', 'quarterly', 'identified'] as const;
export const CAL_EXTRAS = ['payroll', 'road_tax', 'property_tax'] as const;

export type CalCountry = (typeof CAL_COUNTRIES)[number];
export type CalEntity = (typeof CAL_ENTITIES)[number];
export type CalVat = (typeof CAL_VAT)[number];
export type CalExtra = (typeof CAL_EXTRAS)[number];

export interface CalendarProfile {
  country: CalCountry;
  /** OSVČ / SZČO, OSVČ in the paušální režim (CZ only), or a company (s.r.o., a.s.). */
  entity: CalEntity;
  vat: CalVat;
  extras: CalExtra[];
}

export const DEFAULT_PROFILE: CalendarProfile = { country: 'CZ', entity: 'osvc', vat: 'none', extras: [] };

/** Extras with a fixed day in the country: SK payroll and property tax have none (see rawDatesSk). */
export const extrasFor = (country: CalCountry): readonly CalExtra[] => (country === 'SK' ? ['road_tax'] : CAL_EXTRAS);

/**
 * The paušální režim exists only in CZ and only for a non-payer (§ 2a ZDP:
 * a VAT payer can't enter it), so anything else falls back to a regular
 * OSVČ instead of showing an impossible mix.
 */
export function normalizeProfile(p: CalendarProfile): CalendarProfile {
  const entity = p.entity === 'flat' && (p.country === 'SK' || p.vat === 'monthly' || p.vat === 'quarterly') ? 'osvc' : p.entity;
  const allowed = extrasFor(p.country);
  return { ...p, entity, extras: CAL_EXTRAS.filter((e) => p.extras.includes(e) && allowed.includes(e)) };
}

export function kindsFor(profile: CalendarProfile): TaxDeadlineKind[] {
  const p = normalizeProfile(profile);
  const kinds: TaxDeadlineKind[] = [];
  if (p.vat === 'monthly') kinds.push('vat_monthly', 'ec_sales_list');
  if (p.vat === 'quarterly') kinds.push('vat_quarterly', 'ec_sales_list');
  if (p.vat === 'identified') kinds.push('vat_identified', 'ec_sales_list');
  if (p.entity === 'flat') kinds.push('flat_tax');
  if (p.entity === 'osvc') kinds.push('health', 'social', 'income_tax', ...(p.country === 'CZ' ? (['overviews'] as const) : []));
  if (p.entity === 'company') kinds.push('income_tax');
  kinds.push(...p.extras);
  return withImpliedTaxDeadlineKinds(kinds, { country: p.country, legalEntity: p.entity === 'company' });
}

/** Due only if something happened that month (a service to an EU business, a service bought from abroad). */
export const isConditional = (kind: TaxDeadlineKind) => kind === 'ec_sales_list' || kind === 'vat_identified';

export function calendarFor(profile: CalendarProfile, year: number): TaxCalendarEntry[] {
  return taxCalendarYear(kindsFor(profile), year, profile.country);
}

const pick = <T extends string>(list: readonly T[], v: string | null | undefined, fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

export function profileFromParams(get: (key: string) => string | null | undefined): CalendarProfile {
  return normalizeProfile({
    country: pick(CAL_COUNTRIES, get('country')?.toUpperCase(), DEFAULT_PROFILE.country),
    entity: pick(CAL_ENTITIES, get('entity'), DEFAULT_PROFILE.entity),
    vat: pick(CAL_VAT, get('vat'), DEFAULT_PROFILE.vat),
    extras: (get('extras') ?? '').split(',').filter((e): e is CalExtra => (CAL_EXTRAS as readonly string[]).includes(e))
  });
}

export function profileToParams(profile: CalendarProfile): URLSearchParams {
  const p = normalizeProfile(profile);
  const q = new URLSearchParams({ country: p.country, entity: p.entity, vat: p.vat });
  if (p.extras.length) q.set('extras', p.extras.join(','));
  return q;
}

/**
 * What a deadline is for, from its statutory day: most are for the month
 * before, the quarterly return for the quarter before, the yearly filings
 * and road tax for the year before. The paušální daň is paid for the
 * running month (§ 38lc ZDP) and the property tax for the running year.
 */
export type CalPeriod = { type: 'month'; year: number; month: number } | { type: 'quarter'; year: number; quarter: number } | { type: 'year'; year: number };

export function periodOf(kind: TaxDeadlineKind, statutory: Date): CalPeriod {
  const y = statutory.getFullYear();
  const m = statutory.getMonth();
  switch (kind) {
    case 'flat_tax':
      return { type: 'month', year: y, month: m };
    case 'vat_quarterly':
      return m === 0 ? { type: 'quarter', year: y - 1, quarter: 4 } : { type: 'quarter', year: y, quarter: Math.floor(m / 3) };
    case 'income_tax':
    case 'overviews':
    case 'road_tax':
      return { type: 'year', year: y - 1 };
    case 'property_tax':
      return { type: 'year', year: y };
    default:
      return m === 0 ? { type: 'month', year: y - 1, month: 11 } : { type: 'month', year: y, month: m - 1 };
  }
}

export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type PeriodKey = 'month' | 'quarter' | 'year' | 'yearAhead';

/** "za září 2026", "za 3. čtvrtletí 2026", "za rok 2025", "na rok 2026", worded by `tr` (messages `period.*`). */
export function periodText(tr: (key: PeriodKey, values: Record<string, string | number>) => string, locale: string, kind: TaxDeadlineKind, statutory: Date): string {
  const p = periodOf(kind, statutory);
  if (p.type === 'month') {
    const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(p.year, p.month, 15));
    return tr('month', { month });
  }
  if (p.type === 'quarter') return tr('quarter', { quarter: p.quarter, year: p.year });
  return tr(kind === 'property_tax' ? 'yearAhead' : 'year', { year: p.year });
}
