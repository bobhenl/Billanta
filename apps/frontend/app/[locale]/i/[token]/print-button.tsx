'use client';

import { Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/**
 * Print or "Save as PDF" from the browser's print dialog. The page carries
 * `data-print-sheet`, so it prints black on white even in dark mode.
 */
export function PrintButton() {
  const t = useTranslations('publicInvoice');
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn(buttonClass.secondary, 'h-10 shrink-0 px-3 sm:px-4 print:hidden')}
      aria-label={t('print')}
      title={t('print')}
    >
      <Printer className="h-4 w-4" />
      <span className="hidden sm:inline">{t('print')}</span>
    </button>
  );
}
