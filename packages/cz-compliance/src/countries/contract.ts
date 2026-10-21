import type { CountryPack } from './types.js';

/**
 * Sanity checks every country pack must pass. Each pack's test calls this, so
 * a pack cannot ship with an unsorted rate history, an example ID that fails
 * its own validator or holidays outside the year.
 */
export function countryPackProblems(pack: CountryPack): string[] {
  const problems: string[] = [];
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;

  if (!/^[A-Z]{2}$/.test(pack.code)) problems.push(`code ${pack.code} is not ISO 3166-1 alpha-2`);
  if (!/^[A-Z]{3}$/.test(pack.currency)) problems.push(`currency ${pack.currency} is not ISO 4217`);
  if (!isoDate.test(pack.verifiedAt)) problems.push('verifiedAt is not an ISO date');
  if (pack.locales.length === 0) problems.push('no locales');
  if (pack.sources.length === 0) problems.push('no sources');

  for (const id of pack.taxIds) {
    if (!id.validate(id.normalize(id.example))) problems.push(`example ${id.example} fails ${id.label.en}`);
    if (id.validate('')) problems.push(`${id.label.en} accepts an empty string`);
  }

  const sets = pack.indirectTax.rateSets;
  if (pack.indirectTax.kind !== 'none' && sets.length === 0) problems.push('tax without rate sets');
  for (let i = 1; i < sets.length; i++) {
    const prev = sets[i - 1]!;
    const cur = sets[i]!;
    if (prev.subdivision === cur.subdivision && prev.validFrom > cur.validFrom) {
      problems.push(`rate sets not sorted at ${cur.validFrom}`);
    }
  }
  for (const set of sets) {
    if (!isoDate.test(set.validFrom)) problems.push(`rate set date ${set.validFrom}`);
    for (const r of set.rates) if (r.rate < 0 || r.rate >= 100) problems.push(`rate ${r.rate} out of range`);
  }

  for (const m of pack.einvoicing) {
    if (m.from !== 'in_force' && !isoDate.test(m.from)) problems.push(`mandate date ${m.from}`);
  }

  const year = 2026;
  for (const d of pack.holidays(year)) {
    if (!isoDate.test(d) || !d.startsWith(`${year}-`)) problems.push(`holiday ${d} not in ${year}`);
  }
  for (const d of pack.deadlines?.(year) ?? []) {
    if (!isoDate.test(d.date)) problems.push(`deadline ${d.kind} date ${d.date}`);
  }

  return problems;
}
