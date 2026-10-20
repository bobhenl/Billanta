'use client';

import { useEffect } from 'react';
import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE, attributionFrom, serializeAttribution, type SignupAttribution } from '@/lib/attribution';
import { CONSENT_CHANGED_EVENT, isNoAnalyticsPath, resolveConsent, type ConsentState } from '@/lib/consent';
import { SITE_URL } from '@/lib/site';

/**
 * Where this visit came from, read once from the landing URL and the
 * referrer and held only in memory: nothing about it is stored until
 * analytics is on. It survives client-side navigation (module state), so a
 * visitor who lands on a utm link, browses and accepts on another page is
 * still counted; a full reload before a choice forgets it, which is the
 * price of storing nothing without consent. `undefined` = not looked yet.
 */
let landing: SignupAttribution | null | undefined;

/**
 * Writes the first-touch signup attribution cookie (lib/attribution.ts)
 * once analytics is on: after the visitor's "accept", or by default where
 * the region needs no banner. Middleware used to set it on the first
 * request, before anyone could answer the banner; ePrivacy art. 5(3)
 * (CZ 127/2005 Sb. § 89(3), SK 452/2021 Z.z. § 109) allows that only for
 * strictly necessary storage, which attribution is not.
 *
 * Withdrawing consent deletes it. One set by the old middleware is httpOnly
 * and out of reach here, so middleware.ts drops that one on refusal.
 */
export function AttributionCookie() {
  useEffect(() => {
    if (landing === undefined) {
      const own = [window.location.hostname.toLowerCase(), new URL(SITE_URL).hostname.toLowerCase()];
      // A pupil's visit is never attributed (isNoAnalyticsPath in lib/consent.ts).
      landing = isNoAnalyticsPath(window.location.pathname)
        ? null
        : attributionFrom(new URL(window.location.href), document.referrer || null, own);
    }

    const apply = (state: ConsentState | null) => {
      if (state?.analytics) store();
      else if (state) forget();
    };

    let live = true;
    void resolveConsent().then(({ state }) => {
      if (live) apply(state);
    });
    const onChange = (event: Event) => apply((event as CustomEvent<ConsentState>).detail);
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
    };
  }, []);

  return null;
}

function store() {
  // First touch wins, as before: never overwrite an existing value.
  if (!landing || document.cookie.split('; ').some((part) => part.startsWith(`${ATTRIBUTION_COOKIE}=`))) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // Encoded because Next decodes cookie values before parseAttribution reads them.
  document.cookie = `${ATTRIBUTION_COOKIE}=${encodeURIComponent(serializeAttribution(landing))}; Max-Age=${ATTRIBUTION_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

function forget() {
  document.cookie = `${ATTRIBUTION_COOKIE}=; Max-Age=0; Path=/`;
}
