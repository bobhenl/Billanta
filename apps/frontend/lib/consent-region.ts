/**
 * Where the cookie banner is required. Ported from VoxelRank's
 * src/consentRegion.js; the lists and the safe-side rules are the same.
 *
 * Billanta has one optional category, `analytics`, and the only thing in it
 * is Microsoft Clarity (heatmaps + session recordings, public pages only).
 * So VoxelRank's three answers fold into one here:
 *
 *   banner  the visitor must say yes before Clarity starts. True in the
 *           opt-in countries (ePrivacy/GDPR and look-alikes), and in the
 *           US all-party-consent wiretap states, where recording a visit
 *           without asking is the CIPA-style session-replay claim. False
 *           elsewhere: Clarity starts by default and the footer's "Cookie
 *           settings" turns it off.
 *
 * Global Privacy Control is honoured everywhere, in lib/consent.ts, before
 * the region is even asked for.
 *
 * The country comes from the CDN in front of the site: Cloudflare's
 * `cf-ipcountry` / `cf-region-code` (the "Add visitor location headers"
 * managed transform), or Vercel's `x-vercel-ip-country(-region)`. With no
 * header at all — local development, Caddy without Cloudflare — every
 * visitor gets the banner, the safe side.
 */

/** ISO 3166-1 alpha-2 codes where optional cookies wait for an explicit yes. */
export const OPT_IN_COUNTRIES = Object.freeze([
  // EU member states: ePrivacy Directive art. 5(3) + GDPR.
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
  // Parts of the EU with their own ISO code (Åland, outermost regions).
  'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF',
  // EEA outside the EU.
  'IS', 'LI', 'NO',
  // United Kingdom (PECR + UK GDPR), Crown Dependencies and Gibraltar.
  'GB', 'GG', 'JE', 'IM', 'GI',
  // Switzerland (revFADP; Clarity itself treats CH as consent-required).
  'CH',
  // Brazil (LGPD + ANPD cookie guidance).
  'BR',
  // Canada (PIPEDA, Quebec Law 25; the province is not in the header).
  'CA',
]);

/**
 * US states (ISO 3166-2 subdivision, as `cf-region-code` sends it) where
 * session replay waits for a yes: the all-party-consent wiretap states —
 * CA (CIPA), PA, FL, MA, WA, MD, IL, MT, NH — plus CT, MI, NV, OR, DE on
 * the safe side. A US visitor with no usable state waits too.
 */
export const REPLAY_ASK_STATES = Object.freeze([
  'CA', 'CT', 'DE', 'FL', 'IL', 'MA', 'MD', 'MI', 'MT', 'NH', 'NV', 'OR', 'PA', 'WA',
]);

const OPT_IN = new Set<string>(OPT_IN_COUNTRIES);
const REPLAY_ASK = new Set<string>(REPLAY_ASK_STATES);
const CODE = /^[A-Z]{2}$/;

const clean = (value: string | null | undefined) => String(value ?? '').trim().toUpperCase();

/**
 * Whether optional cookies wait for a yes in `country`. Anything that is not
 * a clean two-letter code — no header, Cloudflare's `XX` (unknown) or `T1`
 * (Tor) — counts as yes, the safe side.
 */
export function optInFor(country: string | null | undefined): boolean {
  const code = clean(country);
  if (!CODE.test(code) || code === 'XX' || code === 'T1') return true;
  return OPT_IN.has(code);
}

/** Whether Clarity must wait for a yes (shows the banner) for this visitor. */
export function bannerFor(country: string | null | undefined, region: string | null | undefined): boolean {
  if (optInFor(country)) return true;
  if (clean(country) !== 'US') return false;
  const state = clean(region);
  return !CODE.test(state) || REPLAY_ASK.has(state);
}

/** Read the visitor's location from the CDN headers, Cloudflare first. */
export function regionHeaders(headers: Headers): { country: string | null; region: string | null } {
  return {
    country: headers.get('cf-ipcountry') ?? headers.get('x-vercel-ip-country'),
    region: headers.get('cf-region-code') ?? headers.get('x-vercel-ip-country-region'),
  };
}

/** The route the browser asks (app/api/consent/region/route.ts). */
export const REGION_PATH = '/api/consent/region';
export const REGION_STORAGE_KEY = 'billanta-region';
export const REGION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
