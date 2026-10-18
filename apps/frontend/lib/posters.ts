import { SITE_URL } from '@/lib/site';

/** Who the poster speaks to. Each one has its own copy under `posters.templates.<id>`. */
export const POSTER_TEMPLATES = ['school', 'creators', 'event', 'local', 'generic'] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];

export const POSTER_LANGS = ['cs', 'sk', 'en'] as const;
export type PosterLang = (typeof POSTER_LANGS)[number];

/**
 * Where the QR code leads. The segment pages (/for-schools, /for-creators,
 * /events) are public slugs, the same in every locale.
 */
export const POSTER_TARGETS = {
  demo: '/demo',
  pricing: '/pricing',
  signup: '/signup',
  home: '',
  forSchools: '/for-schools',
  forCreators: '/for-creators',
  events: '/events'
} as const;
export type PosterTarget = keyof typeof POSTER_TARGETS;

/**
 * `a6x4` is four A6 flyers on one A4 sheet with cut lines, for an office
 * printer. Everything on the sheet is sized in `em`, so `fontMm` alone scales
 * a layout between sizes (A5 and A6 are A4 shrunk by √2 and 2).
 */
export const POSTER_SIZES = {
  a4: { page: 'A4', widthMm: 210, heightMm: 297, fontMm: 4.6, tabs: 8 },
  a5: { page: 'A5', widthMm: 148, heightMm: 210, fontMm: 3.25, tabs: 6 },
  a6: { page: 'A6', widthMm: 105, heightMm: 148, fontMm: 2.3, tabs: 4 },
  a6x4: { page: 'A4', widthMm: 105, heightMm: 148, fontMm: 2.3, tabs: 4 }
} as const;
export type PosterSize = keyof typeof POSTER_SIZES;

export interface PosterOptions {
  template: PosterTemplate;
  lang: PosterLang;
  target: PosterTarget;
  size: PosterSize;
  promo: string;
  event: string;
  tabs: boolean;
}

/** The segment page that fits each audience best, picked when the form has no target yet. */
const DEFAULT_TARGET: Record<PosterTemplate, PosterTarget> = {
  school: 'forSchools',
  creators: 'forCreators',
  event: 'events',
  local: 'demo',
  generic: 'demo'
};

function pick<T extends string>(list: readonly T[], value: string | undefined, fallback: T): T {
  return (list as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

/** Reads the generator's GET form. Anything unknown falls back to a sensible default. */
export function parsePosterOptions(q: Record<string, string | undefined>, uiLocale: string): PosterOptions {
  const template = pick(POSTER_TEMPLATES, q.template, 'generic');
  const lang = pick(POSTER_LANGS, q.lang, pick(POSTER_LANGS, uiLocale, 'cs'));
  const target = pick(Object.keys(POSTER_TARGETS) as PosterTarget[], q.target, DEFAULT_TARGET[template]);
  const size = pick(Object.keys(POSTER_SIZES) as PosterSize[], q.size, 'a4');
  // Codes are printed and typed by hand: only letters, digits and dashes.
  const promo = (q.promo ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 20);
  const event = (q.event ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  // Notice boards get tear-off strips unless the form says otherwise.
  const tabs = q.submitted ? q.tabs === '1' : template === 'local';
  return { template, lang, target, size, promo, event, tabs };
}

/** The URL the QR code encodes. */
export function posterUrl(o: Pick<PosterOptions, 'lang' | 'target' | 'promo'>, origin = SITE_URL): string {
  const url = `${origin}/${o.lang}${POSTER_TARGETS[o.target]}`;
  return o.promo ? `${url}?promo=${encodeURIComponent(o.promo)}` : url;
}

/** The same URL as people type it: no scheme, no `www.`. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
}
