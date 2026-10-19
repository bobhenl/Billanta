'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';

const DISMISSED_KEY = 'billanta_tax_return_nudge_dismissed';

/**
 * Dashboard card from January to March: the year's figures laid out for the
 * income tax return (reports/tax-return). The page decides the season and
 * that the company invoiced in that year; dismissal is per browser and per
 * tax year, so next spring the card comes back.
 */
export function TaxReturnNudge({ year }: { year: number }) {
  const t = useTranslations('taxReturn.nudge');
  // Hidden until mounted: the server can't know what this browser dismissed.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(DISMISSED_KEY) !== String(year));
    } catch {
      setVisible(true);
    }
  }, [year]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, String(year));
    } catch {
      // Private mode: the card simply comes back next visit.
    }
  }

  if (!visible) return null;

  return (
    <section className="relative mt-6 rounded-xl border border-primary/25 bg-primary/5 p-4 pr-10">
      <button type="button" onClick={dismiss} aria-label={t('dismiss')} className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
      <h2 className="flex items-center gap-2 font-bold">
        <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('title', { year })}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('body', { year })}</p>
      <div className="mt-3">
        <Link href={`/reports/tax-return?year=${year}`} className={buttonClass.primary}>
          {t('cta')}
        </Link>
      </div>
    </section>
  );
}
