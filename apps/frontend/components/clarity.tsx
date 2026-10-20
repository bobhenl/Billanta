'use client';

import { useEffect } from 'react';
import { usePathname } from '@/i18n/navigation';
import { CONSENT_CHANGED_EVENT, isNoAnalyticsPath, resolveConsent, type ConsentState } from '@/lib/consent';

const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID;

declare global {
  interface Window {
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] };
  }
}

/**
 * Microsoft Clarity (heatmaps + session recordings), loaded only when
 * analytics is on (after the visitor's "accept", or by default in a region
 * that needs no banner, lib/consent-region.ts) and only when
 * `NEXT_PUBLIC_CLARITY_ID` is set, so local dev and any environment without
 * an ID load nothing.
 *
 * Mounted on the public marketing pages only (app/[locale]/(marketing)/
 * layout.tsx), never in the dashboard: recordings there would capture
 * invoice contents, customers' names and amounts. Nor on the school pages,
 * whatever the consent says: pupils use them, and a child's visit must not
 * be recorded on a "yes" nobody could validly give (isNoAnalyticsPath).
 *
 * Withdrawing consent tells Clarity to stop (`consent`, false) and deletes
 * its first-party cookies; the script itself goes away on the next load.
 */
export function Clarity() {
  const blocked = isNoAnalyticsPath(usePathname());

  useEffect(() => {
    if (!CLARITY_ID) return;
    if (blocked) {
      // Loaded on an earlier page and then navigated here client-side: the
      // tag would record this page too, so it stops and the page loads
      // afresh without it.
      if (document.getElementById('ms-clarity')) {
        window.clarity?.('stop');
        window.location.reload();
      }
      return;
    }

    const apply = (state: ConsentState | null) => {
      if (state?.analytics) {
        load(CLARITY_ID);
      } else if (window.clarity) {
        window.clarity('consent', false);
        for (const name of ['_clck', '_clsk', 'CLID', 'ANONCHK', 'MR', 'MUID', 'SM']) {
          document.cookie = `${name}=; Max-Age=0; Path=/`;
          document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${window.location.hostname}`;
        }
      }
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
  }, [blocked]);

  return null;
}

function load(id: string) {
  if (document.getElementById('ms-clarity')) {
    window.clarity?.('consent');
    return;
  }
  // Clarity's standard bootstrap: queue calls until the tag has loaded.
  window.clarity =
    window.clarity ??
    Object.assign((...args: unknown[]) => {
      (window.clarity!.q = window.clarity!.q ?? []).push(args);
    }, {});
  const script = document.createElement('script');
  script.id = 'ms-clarity';
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(id)}`;
  document.head.appendChild(script);
  window.clarity('consent');
}
