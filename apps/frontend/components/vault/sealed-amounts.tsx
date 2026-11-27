'use client';

import { useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { isSealed, itemBase, sumWithOpened, type DocumentAmounts, type ItemAmounts } from '@faktur/cz-compliance';
import { displayCustomField, documentVars, type CustomField } from '@/lib/custom-fields';
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

/**
 * The totals of many sealed documents, opened once the key is there.
 * `opened` stays null until every envelope has been tried; one this key
 * cannot open counts in `failed` and stays out of any sum.
 */
export function useOpenedTotals(ciphers: (string | null | undefined)[]) {
  const { key } = useVault();
  const list = [...new Set(ciphers.filter((c): c is string => isSealed(c)))];
  const signature = list.join('|');
  const [state, setState] = useState<{ opened: Map<string, DocumentAmounts>; failed: number } | null>(null);
  useEffect(() => {
    if (!key || !list.length) return setState(null);
    let live = true;
    void Promise.all(list.map((c) => openDocumentAmounts(key, c).then((v) => [c, v] as const, () => null))).then((results) => {
      if (!live) return;
      const opened = new Map<string, DocumentAmounts>();
      let failed = 0;
      for (const r of results) {
        if (r) opened.set(r[0], r[1]);
        else failed++;
      }
      setState({ opened, failed });
    });
    return () => {
      live = false;
    };
    // `signature` stands for the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, signature]);
  return { unlocked: Boolean(key), opened: state?.opened ?? null, failed: state?.failed ?? 0, count: list.length };
}

/**
 * A sum over documents of which some have sealed amounts: the server's plain
 * part plus, after unlock, the opened ones. Until then the plain part with a
 * lock that says how many documents are not in it, never a silent shortfall.
 */
export function MoneySum({
  plain,
  sealed,
  currency,
  field = 'totalWithVat'
}: {
  plain: number;
  sealed: (string | null | undefined)[];
  currency: string;
  field?: 'totalWithVat' | 'totalWithoutVat' | 'totalVat';
}) {
  const t = useTranslations('vault.amounts');
  const locale = useLocale();
  const { opened } = useOpenedTotals(sealed);
  const { sum, missing } = sumWithOpened(plain, sealed, opened, field);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="amount">{formatMoney(sum, currency, locale)}</span>
      {missing > 0 && (
        <span title={t('leftOut', { count: missing })} className="inline-flex text-muted-foreground">
          <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{t('leftOut', { count: missing })}</span>
        </span>
      )}
    </span>
  );
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

/**
 * A document total from a list row: the server's number, or the sealed one
 * opened here. A row with sealed amounts has `total: null`, never a 0 to print.
 */
export function RowTotal({
  value,
  cipher,
  currency,
  field = 'totalWithVat'
}: {
  value: number | null | undefined;
  cipher?: string | null;
  currency: string;
  field?: 'totalWithVat' | 'totalWithoutVat' | 'totalVat';
}) {
  const locale = useLocale();
  if (value == null || cipher) return <SealedTotal cipher={cipher} currency={currency} field={field} compact />;
  return <span className="amount">{formatMoney(value, currency, locale)}</span>;
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

/**
 * A custom header field of a sealed document. Percentages, formulas and
 * `{amount}`-style placeholders need the totals, which only this tab can
 * open; the server's would be the placeholder's 0.
 */
export function SealedCustomField({
  field,
  fields,
  companyVars,
  amountPaid,
  cipher,
  currency
}: {
  field: CustomField;
  fields: CustomField[];
  companyVars: { key: string; value: string }[];
  amountPaid: number | string | null | undefined;
  cipher: string | null | undefined;
  currency: string;
}) {
  const locale = useLocale();
  const { value, failed } = useOpened<DocumentAmounts>(cipher, openDocumentAmounts);
  const money = (n: number) => formatMoney(n, currency, locale);
  const kind = field.kind ?? 'text';
  // A fixed amount or a text without placeholders does not depend on the totals.
  if (!value && (kind === 'amount' || (kind === 'text' && !/\{[a-z0-9_]+\}/.test(field.value)))) {
    return <>{displayCustomField(field, {}, money, (v) => v)}</>;
  }
  if (!value) return <Locked failed={failed} compact />;
  const vars = documentVars(fields, value, amountPaid, companyVars, money);
  const fill: Record<string, string> = { ...Object.fromEntries(companyVars.map((v) => [v.key, v.value])), ...vars.formatted };
  return <>{displayCustomField(field, vars.numbers, money, (v) => v.replace(/\{([a-z0-9_]+)\}/g, (m, k: string) => fill[k] ?? m))}</>;
}
