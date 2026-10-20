/**
 * First-touch signup attribution: where a visitor first came from (utm_*
 * tags, or another site that linked here), kept 90 days and saved with the
 * account when they sign up (`users.signup_attribution` / `signup_source`),
 * so signups can be counted per source. Set by middleware.ts, read by the
 * signup route and the OAuth `createUser`.
 */
export const ATTRIBUTION_COOKIE = 'billanta_src';
export const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 90;

export interface SignupAttribution {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  /** Host of an external page that linked here (no path or query: those can carry personal data). */
  referrer?: string;
  /** The first page seen, path only. */
  landing?: string;
  /** When the cookie was set, ISO date-time. */
  at?: string;
}

// Short keys keep the cookie small; the value is a URLSearchParams string.
const KEYS = {
  source: 's',
  medium: 'm',
  campaign: 'c',
  term: 't',
  content: 'n',
  referrer: 'r',
  landing: 'l',
  at: 'a',
} as const satisfies Record<keyof SignupAttribution, string>;

const MAX_LENGTH = 100;

function clean(value: string | null | undefined): string | undefined {
  // Control characters out, length capped: it ends up in the database as is.
  const v = value?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_LENGTH);
  return v || undefined;
}

/**
 * What to remember about this visit, or null when there is nothing worth
 * it (no utm tags and no external referrer). `ownHosts` are this site's own
 * hosts, so moving between its pages is not a referral.
 */
export function attributionFrom(url: URL, referer: string | null, ownHosts: string[], now: Date = new Date()): SignupAttribution | null {
  const q = url.searchParams;
  let referrer: string | undefined;
  try {
    const host = referer ? new URL(referer).hostname.toLowerCase() : '';
    if (host && !ownHosts.includes(host)) referrer = clean(host);
  } catch {
    // A malformed Referer header is no referral.
  }
  const a: SignupAttribution = {
    source: clean(q.get('utm_source')),
    medium: clean(q.get('utm_medium')),
    campaign: clean(q.get('utm_campaign')),
    term: clean(q.get('utm_term')),
    content: clean(q.get('utm_content')),
    referrer,
  };
  if (!a.source && !a.medium && !a.campaign && !a.referrer) return null;
  return { ...a, landing: clean(url.pathname), at: now.toISOString() };
}

export function serializeAttribution(a: SignupAttribution): string {
  const params = new URLSearchParams();
  for (const [key, short] of Object.entries(KEYS) as [keyof SignupAttribution, string][]) {
    const v = a[key];
    if (v) params.set(short, v);
  }
  return params.toString();
}

/** The cookie back into an object, dropping anything unexpected; null when empty or absent. */
export function parseAttribution(raw: string | null | undefined): SignupAttribution | null {
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const a: SignupAttribution = {};
  for (const [key, short] of Object.entries(KEYS) as [keyof SignupAttribution, string][]) {
    const v = clean(params.get(short));
    if (v) a[key] = v;
  }
  return Object.keys(a).length ? a : null;
}

/** The one value signups are grouped by: utm_source, else the referring host. */
export function signupSourceOf(a: SignupAttribution | null): string | null {
  return a?.source?.toLowerCase() ?? a?.referrer ?? null;
}

/** The `users` columns for a new account, from the cookie's raw value. */
export function signupAttributionColumns(raw: string | null | undefined) {
  const a = parseAttribution(raw);
  return { signupAttribution: a, signupSource: signupSourceOf(a) };
}
