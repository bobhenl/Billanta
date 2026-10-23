'use client';

import { useState, useTransition } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { startCardCheckout } from '@/lib/public-card-actions';
import { buttonClass } from '@/lib/ui-classes';
import { SITE_NAME } from '@/lib/site';
import { cn } from '@/lib/utils';

/** "Pay by card": redirects to the supplier's Stripe Checkout for the amount left to pay. */
export function CardPayButton({ token, amountLabel, disabled }: { token: string; amountLabel: string; disabled?: boolean }) {
  const t = useTranslations('publicInvoice.card');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mt-3 print:hidden">
      <button
        type="button"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await startCardCheckout(token, locale);
            if (result.ok) window.location.assign(result.url);
            else setError(t(`errors.${result.error}`));
          })
        }
        className={cn(buttonClass.primary, 'h-10 w-full gap-2 px-5 sm:w-auto')}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        {t('pay', { amount: amountLabel })}
      </button>
      <p className={cn('mt-2 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>{error ?? t('note', { name: SITE_NAME })}</p>
    </div>
  );
}
