'use client';

import { useEffect, useState } from 'react';
import { Cookie } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { toast } from '@/components/toaster';
import { OPEN_CONSENT_EVENT, isNoAnalyticsPath, isRegionDefault, readConsent, resolveConsent, writeConsent } from '@/lib/consent';
import { cn } from '@/lib/utils';

/**
 * Cookie consent card, after VoxelRank's (public/css/consent.css there): a
 * compact corner card rather than a full-width bar, with three choices of
 * equal weight — accept, essential only, settings. "Essential only" is a
 * real button with the same prominence as "accept", as the Czech DPA
 * (ÚOOÚ) and EDPB guidance require; nothing optional loads before a choice.
 *
 * On phones it sits above the fixed tab bar instead of covering it.
 * Reopened from the footer's "Cookie settings" link via `openConsentDialog()`.
 *
 * It opens by itself only where the region needs an explicit yes
 * (lib/consent-region.ts). Elsewhere analytics runs by default, and the
 * footer link opens it with a body that says so.
 *
 * On the pages pupils use (isNoAnalyticsPath) it waits instead: nothing
 * optional runs there anyway, and a child should not be asked for a consent
 * they cannot give. The footer link still opens it.
 */
export function CookieConsent() {
  const t = useTranslations('cookies.banner');
  const pupilPage = isNoAnalyticsPath(usePathname());
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [byDefault, setByDefault] = useState(false);

  useEffect(() => {
    let live = true;
    void resolveConsent().then(({ banner }) => {
      if (live && banner) setOpen(true);
    });
    const reopen = () => {
      const current = readConsent();
      setAnalytics(current?.analytics ?? false);
      setByDefault(Boolean(current?.analytics) && isRegionDefault());
      setSettings(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => {
      live = false;
      window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
    };
  }, []);

  // `settings` is set only when the visitor opened it themselves.
  if (!open || (pupilPage && !settings)) return null;

  const save = (value: boolean) => {
    writeConsent(value);
    toast(t('saved'));
    setOpen(false);
    setSettings(false);
    setByDefault(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-3 z-[60] ml-auto max-w-sm rounded-xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur-md animate-in fade-in-0 slide-in-from-bottom-2 md:bottom-4 md:right-4 md:left-auto bottom-[calc(var(--tabbar-h)+12px+env(safe-area-inset-bottom,0px))]"
    >
      <p id="cookie-consent-title" className="flex items-center gap-2 text-sm font-bold">
        <Cookie className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('title')}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {t(byDefault ? 'bodyDefault' : 'body')}{' '}
        <Link href="/legal/cookies" className="font-semibold text-foreground underline underline-offset-2">
          {t('more')}
        </Link>
      </p>

      {settings && (
        <div className="mt-3 space-y-2 rounded-lg bg-secondary p-3 text-xs">
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block font-semibold text-foreground">{t('necessary')}</span>
              <span className="text-muted-foreground">{t('necessaryHint')}</span>
            </span>
            <input type="checkbox" checked disabled className="mt-0.5 h-4 w-4 accent-primary" />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <span>
              <span className="block font-semibold text-foreground">{t('analytics')}</span>
              <span className="text-muted-foreground">{t('analyticsHint')}</span>
            </span>
            <input
              type="checkbox"
              checked={analytics}
              onChange={(event) => setAnalytics(event.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
            />
          </label>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {settings ? (
          <button type="button" onClick={() => save(analytics)} className={cn(btn, 'col-span-2 bg-primary text-primary-foreground')}>
            {t('save')}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => save(false)} className={cn(btn, 'border border-border bg-secondary text-foreground')}>
              {t('reject')}
            </button>
            <button type="button" onClick={() => save(true)} className={cn(btn, 'bg-primary text-primary-foreground')}>
              {t('accept')}
            </button>
            <button
              type="button"
              onClick={() => setSettings(true)}
              className="col-span-2 py-1 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t('settings')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const btn = 'rounded-full px-3 py-2 text-xs font-bold transition-opacity hover:opacity-90';
