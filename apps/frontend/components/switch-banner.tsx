'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, FileSpreadsheet, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';

const DISMISSED_KEY = 'billanta_switch_banner_dismissed';

/**
 * Dashboard card for a company with no documents yet: most of them already
 * invoiced somewhere else, and the import brings that history over. Shown to
 * owners and admins only (the import is theirs); dismissal is per browser.
 */
export function SwitchBanner({ source }: { source: string | null }) {
  const t = useTranslations('switchBanner');
  // Hidden until mounted: the server can't know what this browser dismissed.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(DISMISSED_KEY) !== '1');
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: the card simply comes back next visit.
    }
  }

  if (!visible) return null;

  return (
    <section className="relative mt-6 rounded-xl border border-primary/25 bg-primary/5 p-4 pr-10">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss')}
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <h2 className="flex items-center gap-2 font-bold">
        <FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('text')}</p>
      <Link href={source ? `/settings/import?source=${source}` : '/settings/import'} className={`${buttonClass.primary} mt-3`}>
        {t('cta')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
