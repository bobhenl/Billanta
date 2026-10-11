'use client';

import { useState, useTransition } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { startCardCheckout } from '@/lib/public-card-actions';

/** "Pay by card": redirects to the supplier's Stripe Checkout for the amount left to pay. */
export function CardPayButton({ token, amountLabel, disabled }: { token: string; amountLabel: string; disabled?: boolean }) {
  const t = useTranslations('publicInvoice.card');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mt-4">
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
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        {t('pay', { amount: amountLabel })}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">{error ?? t('note')}</p>
    </div>
  );
}
