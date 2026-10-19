import { SITE_URL } from '@/lib/site';

/** Who the poster speaks to. Each one has its own copy under `posters.templates.<id>`. */
export const POSTER_TEMPLATES = [
  'school',
  'courses',
  'creators',
  'communities',
  'event',
  'coworking',
  'local',
  'expats',
  'generic'
] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];

export const POSTER_LANGS = ['cs', 'sk', 'en'] as const;
export type PosterLang = (typeof POSTER_LANGS)[number];

/**
 * Where the QR code leads when the poster has no code. The segment pages
 * are public slugs, the same in every locale.
 */
export const POSTER_TARGETS = {
  demo: '/demo',
  pricing: '/pricing',
  signup: '/signup',
  home: '',
  forSchools: '/for-schools',
  forCreators: '/for-creators',
  forCourses: '/for-courses',
  forCommunities: '/for-communities',
  forExpats: '/for-expats',
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
  courses: 'forCourses',
  creators: 'forCreators',
  communities: 'forCommunities',
  event: 'events',
  coworking: 'demo',
  local: 'demo',
  expats: 'forExpats',
  generic: 'demo'
};

function pick<T extends string>(list: readonly T[], value: string | undefined, fallback: T): T {
  return (list as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

/** Reads the generator's GET form. Anything unknown falls back to a sensible default. */
export function parsePosterOptions(q: Record<string, string | undefined>, uiLocale: string): PosterOptions {
  const template = pick(POSTER_TEMPLATES, q.template, 'generic');
  // Expats get the English poster unless someone picks another language.
  const lang = pick(POSTER_LANGS, q.lang, template === 'expats' ? 'en' : pick(POSTER_LANGS, uiLocale, 'cs'));
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

/**
 * The URL the QR code encodes. With a code it is that code's join page, which
 * applies the code; without one, the chosen target page.
 */
export function posterUrl(o: Pick<PosterOptions, 'lang' | 'target' | 'promo'>, origin = SITE_URL): string {
  if (o.promo) return `${origin}/${o.lang}/join/${encodeURIComponent(o.promo)}`;
  return `${origin}/${o.lang}${POSTER_TARGETS[o.target]}`;
}

/** Where people type a code by hand, printed next to it. */
export function joinUrl(origin = SITE_URL): string {
  return `${origin}/join`;
}

/** The same URL as people type it: no scheme, no `www.`. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
}
