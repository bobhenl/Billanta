import { COUNTRY_PACKS } from './countries/index.js';
import { homeCurrencyOf } from './home-currency.js';

/**
 * The tax country of a company (`tenants.country`): the jurisdiction whose
 * VAT rules, deadlines and exports apply. It is chosen at onboarding and
 * locked after the first issued invoice. The postal address
 * (`address_country`) is a separate, freely editable field, and the UI
 * language never decides it (docs/expansion/architecture.md §2.1, §2.4).
 *
 * The database only checks the ISO 3166 shape; which countries a company can
 * pick lives here, so opening a country is a code change, not a migration.
 */
export const ACTIVE_COUNTRIES = ['CZ', 'SK'] as const;
export type ActiveCountry = (typeof ACTIVE_COUNTRIES)[number];

export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

export const isActiveCountry = (code: string | null | undefined): code is ActiveCountry =>
  (ACTIVE_COUNTRIES as readonly string[]).includes(code ?? '');

/**
 * The rule every row followed before `tenants.country` existed: Slovak
 * address = Slovak company, anything else Czech. Used by the backfill and
 * for rows that still lack a country.
 */
export const countryFromAddress = (addressCountry: string | null | undefined): ActiveCountry =>
  addressCountry?.toUpperCase() === 'SK' ? 'SK' : 'CZ';

/** CZK / EUR for CZ and SK (as `homeCurrencyOf`), the pack's currency for a registered country. */
export function homeCurrencyForCountry(code: string | null | undefined): string {
  const upper = code?.toUpperCase();
  if (!upper || isActiveCountry(upper)) return homeCurrencyOf(upper);
  return COUNTRY_PACKS[upper]?.currency ?? homeCurrencyOf(upper);
}

export interface OnboardingCountry {
  code: string;
  /** False = shown as "coming soon", not selectable. */
  active: boolean;
}

/**
 * "Where is your business registered?": CZ and SK, then the registered
 * country packs named in `preview` as "coming soon". Off by default: a
 * pack shows up only when the deployment lists it (EXTRA_COUNTRIES in the
 * frontend), or every pack with `'all'`.
 */
export function onboardingCountries(preview: readonly string[] | 'all' = []): OnboardingCountry[] {
  const wanted = preview === 'all' ? null : new Set(preview.map((c) => c.toUpperCase()));
  const soon = Object.keys(COUNTRY_PACKS)
    .map((c) => c.toUpperCase())
    .filter((c) => COUNTRY_CODE_PATTERN.test(c) && !isActiveCountry(c) && (!wanted || wanted.has(c)))
    .sort();
  return [...ACTIVE_COUNTRIES.map((code) => ({ code, active: true })), ...[...new Set(soon)].map((code) => ({ code, active: false }))];
}
