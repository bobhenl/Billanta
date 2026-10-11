import { defineRouting } from 'next-intl/routing';

/**
 * Supported locales per blueprint §7 (i18n) and §9 — CZ/SK/EN from day one.
 * `localePrefix: 'always'` keeps routing unambiguous (/cs/..., /sk/..., /en/...)
 * rather than hiding the default locale's prefix, since the tenant's
 * `default_locale` (blueprint §4) should still resolve to an explicit,
 * bookmarkable URL.
 */
export const routing = defineRouting({
  locales: ['cs', 'sk', 'en'],
  defaultLocale: 'cs',
  localePrefix: 'always'
});

export type AppLocale = (typeof routing.locales)[number];
