'use client';

import { useState, useTransition } from 'react';
import { Landmark, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Modal, buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { type BankAccount, bankAccountLine } from '@/lib/bank-account';
import { deleteBankAccount, saveBankAccount } from '../actions';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CZK', 'PLN', 'CHF', 'HUF'];

type Draft = { label: string; accountNumber: string; bankCode: string; iban: string; swift: string; currency: string };
const EMPTY: Draft = { label: '', accountNumber: '', bankCode: '', iban: '', swift: '', currency: '' };

/** Extra accounts besides the primary one — e.g. an EUR account used automatically on EUR invoices. */
export function BankAccounts({ accounts, readOnly }: { accounts: BankAccount[]; readOnly: boolean }) {
  const t = useTranslations('settings.company.accounts');
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BankAccount | null>(null);
  const [pending, start] = useTransition();

  const open = (a?: BankAccount) =>
    setEditing({
      id: a?.id ?? null,
      draft: a
        ? {
            label: a.label,
            accountNumber: a.accountNumber ?? '',
            bankCode: a.bankCode ?? '',
            iban: a.iban ?? '',
            swift: a.swift ?? '',
            currency: a.currency ?? ''
          }
        : EMPTY
    });

  const set = (key: keyof Draft, value: string) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [key]: value } } : e));

  const save = () => {
    if (!editing) return;
    const d = editing.draft;
    if (!d.iban.trim() && !(d.accountNumber.trim() && d.bankCode.trim())) {
      toast({ text: t('needAccount'), tone: 'err' });
      return;
    }
    start(async () => {
      const result = await saveBankAccount(editing.id, {
        label: d.label.trim(),
        account_number: d.accountNumber.trim() || null,
        bank_code: d.bankCode.trim() || null,
        iban: d.iban.trim() || null,
        swift: d.swift.trim().toUpperCase() || null,
        currency: d.currency || null
      });
      if (!result.ok) {
        toast({ text: `${t('saveFailed')}: ${result.error}`, tone: 'err' });
        return;
      }
      toast({ text: t('saved'), tone: 'ok' });
      setEditing(null);
      router.refresh();
    });
  };

  const remove = (a: BankAccount) =>
    start(async () => {
      const result = await deleteBankAccount(a.id);
      toast(result.ok ? { text: t('deleted'), tone: 'ok' } : { text: `${t('saveFailed')}: ${result.error}`, tone: 'err' });
      setConfirmDelete(null);
      if (result.ok) router.refresh();
    });

  const field = (key: keyof Draft, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, className = '') => (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium">{label}</span>
      <input className={inputClass} value={editing?.draft[key] ?? ''} onChange={(e) => set(key, e.target.value)}
        // Rendered inside the company <form>: Enter saves this account, not the whole form.
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        }}
        {...extra}
      />
    </label>
  );

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">{t('title')}</h3>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        {!readOnly && (
          <button type="button" className={buttonClass.secondary} onClick={() => open()}>
            <Plus className="h-4 w-4" />
            {t('add')}
          </button>
        )}
      </div>

      {accounts.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  {a.label}
                  {a.currency && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                      {t('autoFor', { currency: a.currency })}
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {bankAccountLine(a)}
                  {a.accountNumber && a.iban ? ` · ${a.iban}` : ''}
                  {a.swift ? ` · ${a.swift}` : ''}
                </div>
              </div>
              {!readOnly && (
                <>
                  <button type="button" className={buttonClass.ghost} onClick={() => open(a)} aria-label={t('edit')}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" className={buttonClass.ghost} onClick={() => setConfirmDelete(a)} aria-label={t('delete')}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? t('editTitle') : t('addTitle')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setEditing(null)}>
              {t('cancel')}
            </button>
            <button type="button" className={buttonClass.primary} onClick={save} disabled={pending || !editing?.draft.label.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('save')}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-4">
          {field('label', t('label'), { placeholder: t('labelPlaceholder'), maxLength: 100, autoFocus: true }, 'sm:col-span-4')}
          {field('accountNumber', t('accountNumber'), { placeholder: '123456789', maxLength: 17 }, 'sm:col-span-3')}
          {field('bankCode', t('bankCode'), { placeholder: '0100', maxLength: 4, inputMode: 'numeric' }, 'sm:col-span-1')}
          {field('iban', 'IBAN', { maxLength: 42 }, 'sm:col-span-3')}
          {field('swift', 'SWIFT / BIC', { maxLength: 11 }, 'sm:col-span-1')}
          <label className="block text-sm sm:col-span-4">
            <span className="mb-1 block font-medium">{t('currency')}</span>
            <select className={inputClass} value={editing?.draft.currency ?? ''} onChange={(e) => set('currency', e.target.value)}>
              <option value="">{t('currencyNone')}</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">{t('currencyHint')}</span>
          </label>
        </div>
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('deleteTitle')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setConfirmDelete(null)}>
              {t('cancel')}
            </button>
            <button type="button" className={buttonClass.danger} disabled={pending} onClick={() => confirmDelete && remove(confirmDelete)}>
              {t('delete')}
            </button>
          </>
        }
      >
        {t('deleteBody', { label: confirmDelete?.label ?? '' })}
      </Modal>
    </div>
  );
}
