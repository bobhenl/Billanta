'use client';

import { useState, useTransition } from 'react';
import { Loader2, Ticket } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { buttonClass, inputClass } from '@/components/modal';
import { usePromoText } from '@/components/promo-text';
import { toast } from '@/components/toaster';
import type { PromoBenefit } from '@/lib/promo';
import { redeemPromo } from './actions';

export type PromoRedemption = PromoBenefit & { createdAt: string };

/** "Mám promo kód": one code per company. Once redeemed, shows which one and what it gave. */
export function PromoCodeCard({ redemption, readOnly }: { redemption: PromoRedemption | null; readOnly: boolean }) {
  const t = useTranslations('promo');
  const format = useFormatter();
  const { benefit, error } = usePromoText();
  const [code, setCode] = useState('');
  const [pending, startTransition] = useTransition();

  if (redemption) {
    return (
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Ticket className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('card.title')}
        </p>
        <p className="mt-2 text-sm">
          {t('card.applied', { code: redemption.code, date: format.dateTime(new Date(redemption.createdAt), { dateStyle: 'medium' }) })}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{benefit(redemption)}</p>
      </section>
    );
  }
  if (readOnly) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    startTransition(async () => {
      const result = await redeemPromo(code);
      if (result.ok) {
        toast({ text: t('appliedToast', { code: result.data.code, benefit: benefit(result.data) }), tone: 'ok' });
        setCode('');
      } else {
        toast({ text: error(result.error), tone: 'err' });
      }
    });
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Ticket className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('card.title')}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t('card.hint')}</p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="promo-code" className="sr-only">
          {t('card.label')}
        </label>
        <input
          id="promo-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={t('card.placeholder')}
          className={`${inputClass} font-mono uppercase sm:max-w-xs`}
        />
        <button type="submit" disabled={pending || !code.trim()} className={buttonClass.secondary}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('card.submit')}
        </button>
      </form>
    </section>
  );
}
