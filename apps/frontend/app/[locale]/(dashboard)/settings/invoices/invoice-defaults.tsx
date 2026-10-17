'use client';

import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { Typeahead, type TypeaheadGroup } from '@/components/typeahead';
import { cn } from '@/lib/utils';
import { searchCustomers } from '../../invoices/new/actions';
import type { Contact, DocLanguage } from '../../invoices/new/types';

/** Same lists as the invoice form offers. */
const CURRENCIES = ['CZK', 'EUR', 'USD', 'GBP', 'PLN'];
const PAYMENT_METHODS = ['bank_transfer', 'cash', 'card', 'cash_on_delivery', 'other'] as const;
const VAT_RATES = ['21', '12', '0'];
export const MAX_DEFAULT_ITEMS = 10;

/** One default line item as edited (strings, parsed on save). */
export interface ItemDraft {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string; // '' = no VAT
}

/** Everything a blank new invoice starts with. */
export interface DefaultsDraft {
  language: DocLanguage;
  dueDays: string;
  paymentMethod: string;
  currency: string; // '' = CZK, the form's own default
  bankAccountId: string; // '' = the primary account
  contact: Contact | null;
  items: ItemDraft[];
  noteAbove: string;
  noteBelow: string;
}

/** Decimal comma tolerant number, NaN for junk. */
export const parseNumber = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.'));

/**
 * Settings → Faktury → Výchozí hodnoty: language, due days, payment method,
 * currency, bank account, customer, line items and the notes above/below
 * the items for every blank new invoice. Copies and templates keep their own.
 */
export function InvoiceDefaultsFields({
  value,
  onChange,
  bankAccounts,
  vatPayer,
  readOnly
}: {
  value: DefaultsDraft;
  onChange: (next: DefaultsDraft) => void;
  bankAccounts: { id: string; label: string; line: string }[];
  vatPayer: boolean;
  readOnly: boolean;
}) {
  const t = useTranslations('settings.invoices.blank');
  const tc = useTranslations('settings.company');
  const tPay = useTranslations('doc.payment');
  const [query, setQuery] = useState('');
  const set = <K extends keyof DefaultsDraft>(key: K, v: DefaultsDraft[K]) => onChange({ ...value, [key]: v });
  const setItem = (i: number, patch: Partial<ItemDraft>) => set('items', value.items.map((item, j) => (j === i ? { ...item, ...patch } : item)));
  const fetchContacts = async (q: string): Promise<TypeaheadGroup<Contact>[]> => {
    const { contacts } = await searchCustomers(q, 'none');
    return [{ items: contacts }];
  };
  const labelText = 'font-medium';

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className={labelText}>{tc('defaultLocale')}</span>
          <select className={cn(inputClass, 'mt-1')} value={value.language} disabled={readOnly} onChange={(e) => set('language', e.target.value as DocLanguage)}>
            <option value="cs">Čeština</option>
            <option value="sk">Slovenčina</option>
            <option value="en">English</option>
          </select>
        </label>
        <div className="block text-sm">
          <InfoHint hint={tc('defaultDueDaysHint')}>
            <span className={labelText}>{tc('defaultDueDays')}</span>
          </InfoHint>
          <input
            type="number"
            min={0}
            max={365}
            required
            aria-label={tc('defaultDueDays')}
            className={cn(inputClass, 'mt-1')}
            value={value.dueDays}
            disabled={readOnly}
            onChange={(e) => set('dueDays', e.target.value)}
          />
        </div>
        <label className="block text-sm">
          <span className={labelText}>{tc('defaultPaymentMethod')}</span>
          <select className={cn(inputClass, 'mt-1')} value={value.paymentMethod} disabled={readOnly} onChange={(e) => set('paymentMethod', e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {tPay(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={labelText}>{t('currency')}</span>
          <select className={cn(inputClass, 'mt-1')} value={value.currency || 'CZK'} disabled={readOnly} onChange={(e) => set('currency', e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className={labelText}>{t('bankAccount')}</span>
          <select className={cn(inputClass, 'mt-1')} value={value.bankAccountId} disabled={readOnly} onChange={(e) => set('bankAccountId', e.target.value)}>
            <option value="">{t('bankAccountPrimary')}</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.line})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="text-sm">
        <InfoHint hint={t('customerHint')}>
          <span className={labelText}>{t('customer')}</span>
        </InfoHint>
        {value.contact ? (
          <div className="mt-1 flex items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-2">
            <span className="min-w-0 truncate">
              <span className="font-semibold">{value.contact.legalName}</span>
              {value.contact.ico && <span className="text-muted-foreground"> · IČO {value.contact.ico}</span>}
            </span>
            {!readOnly && (
              <button
                type="button"
                aria-label={t('customerRemove')}
                onClick={() => set('contact', null)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : readOnly ? (
          <p className="mt-1 text-muted-foreground">{t('customerNone')}</p>
        ) : (
          <Typeahead<Contact>
            className="mt-1"
            value={query}
            onChange={setQuery}
            onPick={(contact) => {
              set('contact', contact);
              setQuery('');
            }}
            fetchGroups={fetchContacts}
            getKey={(c) => c.id}
            ariaLabel={t('customer')}
            placeholder={t('customerSearch')}
            emptyHint={t('customerEmpty')}
            renderItem={(c) => (
              <span>
                <span className="font-semibold">{c.legalName}</span>
                {c.ico && <span className="text-muted-foreground"> · IČO {c.ico}</span>}
              </span>
            )}
          />
        )}
      </div>

      <div className="text-sm">
        <InfoHint hint={t('itemsHint')}>
          <span className={labelText}>{t('items')}</span>
        </InfoHint>
        <div className="mt-2 space-y-2">
          {value.items.map((item, i) => (
            <div key={i} className="grid grid-cols-6 gap-2 rounded-lg border border-border p-2 sm:grid-cols-12 sm:border-0 sm:p-0">
              <input
                className={cn(inputClass, 'col-span-6 sm:col-span-5')}
                maxLength={500}
                required
                aria-label={t('itemDescription')}
                placeholder={t('itemDescription')}
                value={item.description}
                disabled={readOnly}
                onChange={(e) => setItem(i, { description: e.target.value })}
              />
              <input
                className={cn(inputClass, 'col-span-2 sm:col-span-1')}
                inputMode="decimal"
                aria-label={t('itemQuantity')}
                placeholder={t('itemQuantity')}
                value={item.quantity}
                disabled={readOnly}
                onChange={(e) => setItem(i, { quantity: e.target.value })}
              />
              <input
                className={cn(inputClass, 'col-span-2 sm:col-span-1')}
                maxLength={20}
                aria-label={t('itemUnit')}
                placeholder={t('itemUnit')}
                value={item.unit}
                disabled={readOnly}
                onChange={(e) => setItem(i, { unit: e.target.value })}
              />
              <input
                className={cn(inputClass, 'col-span-2 sm:col-span-2')}
                inputMode="decimal"
                aria-label={t('itemPrice')}
                placeholder={t('itemPrice')}
                value={item.unitPrice}
                disabled={readOnly}
                onChange={(e) => setItem(i, { unitPrice: e.target.value })}
              />
              {vatPayer ? (
                <select
                  className={cn(inputClass, 'col-span-4 sm:col-span-2')}
                  aria-label={t('itemVat')}
                  value={item.vatRate}
                  disabled={readOnly}
                  onChange={(e) => setItem(i, { vatRate: e.target.value })}
                >
                  {VAT_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r} %
                    </option>
                  ))}
                  <option value="">{t('noVat')}</option>
                </select>
              ) : (
                <span className="hidden sm:col-span-2 sm:block" />
              )}
              <button
                type="button"
                disabled={readOnly}
                aria-label={t('itemRemove')}
                onClick={() => set('items', value.items.filter((_, j) => j !== i))}
                className="col-span-2 inline-flex h-10 w-10 items-center justify-center justify-self-end rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive sm:col-span-1"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {value.items.length < MAX_DEFAULT_ITEMS && !readOnly && (
            <button
              type="button"
              onClick={() => set('items', [...value.items, { description: '', quantity: '1', unit: '', unitPrice: '', vatRate: vatPayer ? '21' : '' }])}
              className={buttonClass.secondary}
            >
              <Plus className="h-4 w-4" />
              {t('addItem')}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={labelText}>{t('noteAbove')}</span>
          <textarea
            className={cn(inputClass, 'mt-1 min-h-20')}
            maxLength={2000}
            value={value.noteAbove}
            disabled={readOnly}
            placeholder={t('noteAbovePlaceholder')}
            onChange={(e) => set('noteAbove', e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className={labelText}>{tc('defaultNoteBelow')}</span>
          <textarea
            className={cn(inputClass, 'mt-1 min-h-20')}
            maxLength={2000}
            value={value.noteBelow}
            disabled={readOnly}
            placeholder={tc('defaultNotePlaceholder')}
            onChange={(e) => set('noteBelow', e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
