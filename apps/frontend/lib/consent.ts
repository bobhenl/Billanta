import { REGION_PATH, REGION_STORAGE_KEY, REGION_TTL_MS } from './consent-region';

/**
 * Cookie consent state, kept in one first-party cookie so it is the same on
 * every page and readable without JavaScript frameworks. The consent cookie
 * itself is strictly necessary (it records the visitor's choice) and needs
 * no consent of its own.
 *
 * Only one optional category exists: `analytics` (Microsoft Clarity, see
 * components/clarity.tsx). Whether it waits for a yes depends on where the
 * visitor is (lib/consent-region.ts): in the EU/EEA, UK, CH, BR, CA and the
 * US all-party-consent states it does; elsewhere it runs by default until
 * the visitor turns it off. Bump `CONSENT_VERSION` whenever a new optional
 * category or vendor is added — older choices are then treated as unanswered
 * and the banner asks again, as GDPR consent must be specific.
 */
export const CONSENT_COOKIE = 'billanta_consent';
export const CONSENT_VERSION = 1;
/** ÚOOÚ guidance: ask again at least yearly; six months is the common choice. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 182;
/** Fired on `window` to (re)open the consent dialog, e.g. from the footer. */
export const OPEN_CONSENT_EVENT = 'billanta:open-consent';
/** Fired on `window` after the visitor saves a choice; `detail` is the new state. */
export const CONSENT_CHANGED_EVENT = 'billanta:consent-changed';

export interface ConsentState {
  v: number;
  analytics: boolean;
}

/**
 * Global Privacy Control (after VoxelRank's src/consentRegion.js): a browser
 * that sends it is treated as "essential only" until the visitor makes an
 * explicit choice, and is shown no banner.
 */
function gpcEnabled(): boolean {
  try {
    return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  } catch {
    return false;
  }
}

/**
 * What is in force right now, as far as it is known without a request: the
 * visitor's own choice, else GPC ("essential only"), else the region default
 * when a fresh stored region answer says no banner is needed there (Clarity
 * on by default, lib/consent-region.ts). `null` means "ask first".
 */
export function readConsent(): ConsentState | null {
  if (typeof document === 'undefined') return null;
  const stored = readStoredConsent();
  if (stored) return stored;
  if (gpcEnabled()) return { v: CONSENT_VERSION, analytics: false };
  return readStoredRegion() === false ? { v: CONSENT_VERSION, analytics: true } : null;
}

/** True when nothing but the region default decides (no choice, no GPC). */
export function isRegionDefault(): boolean {
  return !readStoredConsent() && !gpcEnabled();
}

export interface ResolvedConsent {
  /** What is in force; `null` until the visitor answers the banner. */
  state: ConsentState | null;
  /** Show the banner: no choice yet and this region needs an explicit yes. */
  banner: boolean;
}

let pending: Promise<ResolvedConsent> | null = null;

/**
 * readConsent(), plus the region question when it is still open. The region
 * is asked once per page (shared by the banner and Clarity) and remembered
 * for a week in localStorage. A failed request means "show the banner".
 */
export function resolveConsent(): Promise<ResolvedConsent> {
  const known = readConsent();
  if (known) return Promise.resolve({ state: known, banner: false });
  if (readStoredRegion() === true) return Promise.resolve({ state: null, banner: true });
  pending ??= fetch(REGION_PATH, { cache: 'no-store' })
    .then((response) => (response.ok ? (response.json() as Promise<{ banner?: unknown }>) : null))
    .then((body) => {
      const banner = body?.banner !== false;
      storeRegion(banner);
      return banner
        ? { state: null, banner: true }
        : { state: { v: CONSENT_VERSION, analytics: true }, banner: false };
    })
    .catch(() => ({ state: null, banner: true }));
  return pending;
}

/** The stored region answer (`banner`), or null when missing or stale. */
function readStoredRegion(): boolean | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(REGION_STORAGE_KEY) ?? 'null') as {
      banner?: unknown;
      at?: unknown;
    } | null;
    const now = Date.now();
    if (raw && typeof raw.banner === 'boolean' && typeof raw.at === 'number' && raw.at <= now && now - raw.at < REGION_TTL_MS) {
      return raw.banner;
    }
  } catch {
    // Storage blocked or junk: ask again.
  }
  return null;
}

function storeRegion(banner: boolean) {
  try {
    window.localStorage.setItem(REGION_STORAGE_KEY, JSON.stringify({ banner, at: Date.now() }));
  } catch {
    // Private mode: the region is simply asked again next page.
  }
}

function readStoredConsent(): ConsentState | null {
  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as ConsentState;
    return parsed.v === CONSENT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function writeConsent(analytics: boolean): ConsentState {
  const state: ConsentState = { v: CONSENT_VERSION, analytics };
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_CHANGED_EVENT, { detail: state }));
  return state;
}

export function openConsentDialog(): void {
  window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
}
