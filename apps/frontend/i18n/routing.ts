import { defineRouting } from 'next-intl/routing';
import { LOCALES } from './locales';

/**
 * Supported locales per blueprint §7 (i18n) and §9 — CZ/SK/EN from day one,
 * DE/PL/UK/HU/RO/FR/ES/IT/NL/PT added for the expansion (list and flags in ./locales.ts).
 * `localePrefix: 'always'` keeps routing unambiguous (/cs/..., /sk/..., /en/...)
 * rather than hiding the default locale's prefix, since the tenant's
 * `default_locale` (blueprint §4) should still resolve to an explicit,
 * bookmarkable URL.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: 'cs',
  localePrefix: 'always'
});

export type { AppLocale } from './locales';
