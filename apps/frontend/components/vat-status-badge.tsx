'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, BadgeCheck, CircleSlash, Loader2 } from 'lucide-react';
import { checkVatStatus } from '@/lib/company-lookup-actions';
import type { VatPayerCheck } from '@/lib/company-lookup';
import { cn } from '@/lib/utils';

/**
 * "Plátce DPH ověřen" / "Neplátce" / "Nespolehlivý plátce" next to a DIČ,
 * from the CZ register of VAT payers (ADIS) or VIES. Looks the DIČ up after a
 * short pause in typing; says nothing when the services cannot be reached,
 * because a wrong "Neplátce" is worse than no badge.
 */
export function VatStatusBadge({
  dic,
  onResult,
  className
}: {
  dic: string | null | undefined;
  onResult?: (check: VatPayerCheck | null) => void;
  className?: string;
}) {
  const t = useTranslations('vatCheck');
  const value = (dic ?? '').replace(/[\s.-]/g, '').toUpperCase();
  const [check, setCheck] = useState<VatPayerCheck | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCheck(null);
    if (value.length < 8) {
      onResult?.(null);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await checkVatStatus(value);
      if (!live) return;
      setLoading(false);
      setCheck(result);
      onResult?.(result);
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
      setLoading(false);
    };
    // onResult is a callback from the parent; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (loading) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        {t('checking')}
      </span>
    );
  }
  if (!check || check.state === 'unknown') return null;

  const tone =
    check.state === 'payer' || check.state === 'valid'
      ? 'border-success/40 bg-success/10 text-success'
      : check.state === 'unreliable'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-border bg-muted text-muted-foreground';
  const Icon = check.state === 'unreliable' ? AlertTriangle : check.state === 'payer' || check.state === 'valid' ? BadgeCheck : CircleSlash;
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', tone, className)}
      title={t(`source.${check.source ?? 'none'}`)}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(`state.${check.state}`)}
    </span>
  );
}
