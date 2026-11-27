'use client';

import { useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { itemBase, type DocumentAmounts, type ItemAmounts } from '@faktur/cz-compliance';
import { formatMoney } from '@/lib/invoice-ui';
import { openDocumentAmounts, openItemAmounts } from '@/lib/vault/amounts';
import { cn } from '@/lib/utils';
import { useVault } from './vault-provider';

/*
 * Category "amounts" on the detail page: the server sent placeholders, so
 * every number is opened here once the key is unlocked. Until then a lock,
 * never the placeholder 0.
 */

function useOpened<T>(cipher: string | null | undefined, opener: (key: NonNullable<ReturnType<typeof useVault>['key']>, cipher: string) => Promise<T>) {
  const { key } = useVault();
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!key || !cipher) return setValue(null);
    let live = true;
    opener(key, cipher)
      .then((v) => live && (setValue(v), setFailed(false)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // The opener is a module function, stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cipher]);
  return { value, failed };
}

function Locked({ failed, compact, className }: { failed: boolean; compact?: boolean; className?: string }) {
  const t = useTranslations('vault.text');
  const { requestUnlock } = useVault();
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5 text-muted-foreground', className)}>
      <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="text-sm font-normal italic">{failed ? t('otherKey') : t('locked')}</span>
      {!failed && !compact && (
        <button type="button" onClick={() => void requestUnlock()} className="text-xs font-semibold text-primary hover:underline">
          {t('unlock')}
        </button>
      )}
    </span>
  );
}

/** One of the document's totals. */
export function SealedTotal({
  cipher,
  currency,
  field = 'totalWithVat',
  compact
}: {
  cipher: string | null | undefined;
  currency: string;
  field?: 'totalWithVat' | 'totalWithoutVat' | 'totalVat';
  compact?: boolean;
}) {
  const locale = useLocale();
  const { value, failed } = useOpened<DocumentAmounts>(cipher, openDocumentAmounts);
  if (!value) return <Locked failed={failed} compact={compact} />;
  return <span className="amount">{formatMoney(value[field], currency, locale)}</span>;
}

/** The totals block under the items: VAT per rate, without VAT, VAT, total. */
export function SealedTotalsBlock({ cipher, currency }: { cipher: string | null | undefined; currency: string }) {
  const t = useTranslations('doc');
  const locale = useLocale();
  const { value, failed } = useOpened<DocumentAmounts>(cipher, openDocumentAmounts);
  const money = (n: number) => formatMoney(n, currency, locale);
  if (!value) {
    return (
      <div className="flex justify-between text-base font-extrabold">
        <dt>{t('totalDue')}</dt>
        <dd>
          <Locked failed={failed} />
        </dd>
      </div>
    );
  }
  return (
    <>
      {value.byRate.map((r) => (
        <div key={r.vatRatePercent} className="flex justify-between text-muted-foreground">
          <dt>{t('vatAt', { rate: r.vatRatePercent })}</dt>
          <dd className="tabular-nums">
            <span className="amount">
              {money(r.totalWithoutVat)} + {money(r.vatAmount)}
            </span>
          </dd>
        </div>
      ))}
      <div className="flex justify-between border-t border-border pt-1">
        <dt>{t('withoutVat')}</dt>
        <dd className="tabular-nums">
          <span className="amount">{money(value.totalWithoutVat)}</span>
        </dd>
      </div>
      <div className="flex justify-between">
        <dt>{t('vatTotal')}</dt>
        <dd className="tabular-nums">
          <span className="amount">{money(value.totalVat)}</span>
        </dd>
      </div>
      <div className="flex justify-between text-base font-extrabold">
        <dt>{t('totalDue')}</dt>
        <dd className="tabular-nums">
          <span className="amount">{money(value.totalWithVat)}</span>
        </dd>
      </div>
    </>
  );
}

/** One number of a sealed line item, or the mobile summary line. */
export function SealedItemAmount({
  cipher,
  currency,
  field,
  unit
}: {
  cipher: string | null | undefined;
  currency: string;
  field: 'quantity' | 'unitPrice' | 'discount' | 'vat' | 'line' | 'summary';
  unit?: string | null;
}) {
  const t = useTranslations('doc');
  const locale = useLocale();
  const { value, failed } = useOpened<ItemAmounts>(cipher, openItemAmounts);
  if (!value) return <Locked failed={failed} compact />;
  const money = (n: number) => formatMoney(n, currency, locale);
  switch (field) {
    case 'quantity':
      return <>{`${value.quantity.toLocaleString(locale)} ${unit ?? ''}`}</>;
    case 'unitPrice':
      return <span className="amount">{money(value.unitPrice)}</span>;
    case 'discount':
      return <>{value.discountPercent ? `${value.discountPercent} %` : '–'}</>;
    case 'vat':
      return <>{value.vatRate === null ? '–' : `${value.vatRate} %`}</>;
    case 'line':
      return <span className="amount">{money(Math.round(itemBase(value) * 100) / 100)}</span>;
    case 'summary':
      return (
        <>
          {value.quantity.toLocaleString(locale)} {unit ?? ''} × {money(value.unitPrice)}
          {value.discountPercent ? ` · ${t('items.discount')} ${value.discountPercent} %` : ''}
          {value.vatRate === null ? '' : ` · ${t('items.vat')} ${value.vatRate} %`}
        </>
      );
  }
}
