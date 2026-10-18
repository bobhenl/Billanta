'use client';

import { useState, useTransition } from 'react';
import { PackageOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/toaster';
import { claimDemoTransfer, dismissDemoTransfer } from '@/app/[locale]/(dashboard)/demo-actions';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/**
 * Shown in the dashboard of a real account while the browser still holds a
 * demo hand-over token (/api/demo/transfer). Nothing moves until the visitor
 * says so: an owner may well have signed up to start clean.
 */
export function DemoTransferClaim() {
  const t = useTranslations('demo.transfer');
  const [open, setOpen] = useState(true);
  const [pending, start] = useTransition();

  if (!open) return null;

  const claim = () =>
    start(async () => {
      const result = await claimDemoTransfer();
      setOpen(false);
      if (result.ok) {
        toast({ text: t('done', { invoices: result.invoices, contacts: result.contacts, expenses: result.expenses }), tone: 'ok' });
      } else {
        toast({ text: t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'), tone: 'err' });
      }
    });

  const dismiss = () =>
    start(async () => {
      await dismissDemoTransfer();
      setOpen(false);
    });

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-2.5">
        <PackageOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t('title')}</p>
          <p className="text-muted-foreground">{t('lead')}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={claim} className={cn(buttonClass.primary, 'py-1.5')}>
          {t('claim')}
        </button>
        <button type="button" disabled={pending} onClick={dismiss} className={cn(buttonClass.secondary, 'py-1.5')}>
          {t('dismiss')}
        </button>
      </div>
    </div>
  );
}
