/**
 * Every UI language and what the rest of the site needs to know about it.
 * Kept free of next-intl imports so middleware, sitemap and plain helpers
 * can read it.
 *
 * `indexed`: whether search engines may index the locale. A locale whose
 * catalog is still partly English (see i18n/messages.ts) is served, but its
 * pages are `noindex` (X-Robots-Tag from middleware.ts and the page
 * metadata), it is left out of hreflang alternates, the sitemap and
 * llms.txt. Flip it to true once the translation is complete and reviewed.
 *
 * `intl`: the BCP 47 tag for Intl formatting and speech recognition, where
 * a bare language code would pick the wrong region.
 */
export const LOCALE_INFO = {
  cs: { name: 'Čeština', intl: 'cs-CZ', indexed: true },
  sk: { name: 'Slovenčina', intl: 'sk-SK', indexed: true },
  en: { name: 'English', intl: 'en-GB', indexed: true },
  de: { name: 'Deutsch', intl: 'de-DE', indexed: false },
  pl: { name: 'Polski', intl: 'pl-PL', indexed: false },
  uk: { name: 'Українська', intl: 'uk-UA', indexed: false },
  hu: { name: 'Magyar', intl: 'hu-HU', indexed: false },
  ro: { name: 'Română', intl: 'ro-RO', indexed: false },
  fr: { name: 'Français', intl: 'fr-FR', indexed: false },
  es: { name: 'Español', intl: 'es-ES', indexed: false },
  it: { name: 'Italiano', intl: 'it-IT', indexed: false },
  nl: { name: 'Nederlands', intl: 'nl-NL', indexed: false },
  pt: { name: 'Português', intl: 'pt-PT', indexed: false }
} as const satisfies Record<string, { name: string; intl: string; indexed: boolean }>;

export type AppLocale = keyof typeof LOCALE_INFO;

export const LOCALES = Object.keys(LOCALE_INFO) as AppLocale[];

/** `cs|sk|en|…` for path regexes. next.config.mjs and public/sw.js keep their own copy. */
export const LOCALE_PATTERN = LOCALES.join('|');

/** Locales with a complete catalog of their own; the rest fall back to English key by key. */
export const FULL_LOCALES = ['cs', 'sk', 'en'] as const satisfies readonly AppLocale[];
export type FullLocale = (typeof FULL_LOCALES)[number];

export const INDEXED_LOCALES: readonly AppLocale[] = LOCALES.filter((l) => LOCALE_INFO[l].indexed);

export function isIndexedLocale(locale: string): boolean {
  return (INDEXED_LOCALES as readonly string[]).includes(locale);
}

/**
 * The locale to read hand-written content in (glossary texts, school
 * lessons, OG section labels and the like, which exist in cs/sk/en only):
 * the locale itself when it has one, English otherwise.
 */
export function contentLocale(locale: string): FullLocale {
  return (FULL_LOCALES as readonly string[]).includes(locale) ? (locale as FullLocale) : 'en';
}

/** BCP 47 tag with region for Intl and the Web Speech API. */
export function intlLocale(locale: string): string {
  return LOCALE_INFO[locale as AppLocale]?.intl ?? LOCALE_INFO.cs.intl;
}

/** `/de/...` → 'de' when that is a locale that must not be indexed. */
export function unindexedLocaleOfPath(pathname: string): AppLocale | null {
  const first = pathname.split('/')[1] ?? '';
  return first in LOCALE_INFO && !isIndexedLocale(first) ? (first as AppLocale) : null;
}
