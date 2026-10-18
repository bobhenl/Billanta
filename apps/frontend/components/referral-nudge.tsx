'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Gift, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';

const DISMISSED_KEY = 'billanta_referral_nudge_dismissed';

/**
 * Dashboard card shown once the company has been paid for an invoice and
 * has not invited anyone yet: the moment the app has proved itself is the
 * moment a recommendation is honest. Dismissal is per browser and per
 * invite code, so another company in the same browser still sees its own.
 */
export function ReferralNudge({ code, link, welcome, reward }: { code: string; link: string; welcome: number; reward: number }) {
  const t = useTranslations('referrals.nudge');
  // Hidden until mounted: the server can't know what this browser dismissed.
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(DISMISSED_KEY) !== code);
    } catch {
      setVisible(true);
    }
  }, [code]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, code);
    } catch {
      // Private mode: the card simply comes back next visit.
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission: the settings page shows the link to select by hand.
    }
  }

  if (!visible) return null;

  return (
    <section className="relative mt-6 rounded-xl border border-primary/25 bg-primary/5 p-4 pr-10">
      <button type="button" onClick={dismiss} aria-label={t('dismiss')} className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
      <h2 className="flex items-center gap-2 font-bold">
        <Gift className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('title')}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('body', { welcome, reward })}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={buttonClass.primary}>
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? t('copied') : t('copy')}
        </button>
        <Link href="/settings/referrals" className={buttonClass.secondary}>
          {t('more')}
        </Link>
      </div>
    </section>
  );
}
