'use client';

import { useState, useTransition } from 'react';
import { ChevronDown, Loader2, Plus, RotateCcw, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import type { TaxModel, TaxPartner } from '@/lib/net-income';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { saveTaxModel } from './actions';
import { SharesPicker } from './shares-picker';

/** Mirrors DEFAULT_TAX_MODEL in apps/backend/src/net-income/tax-model.ts. */
const DEFAULTS: TaxModel = {
  flat_expense_percent: 60,
  flat_expense_cap: 1_200_000,
  income_tax_percent: 15,
  social_rate_percent: 29.2,
  social_base_percent: 55,
  health_rate_percent: 13.5,
  health_base_percent: 50,
  partners: [{ id: 'me', name: '', share: 100, tax_credits: 30_840 }],
  shared_expenses: [],
  extra_income: []
};

const MAX_PARTNERS = 10;
const ERRORS = ['duplicate_partner', 'shares_must_be_positive'];

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Number input that keeps what is being typed ("29," on the way to 29,2)
 * and reports a number only once it parses. Empty = `empty`.
 */
function NumField({
  value,
  onChange,
  label,
  suffix,
  disabled,
  empty = 0,
  className
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  label: string;
  suffix?: string;
  disabled?: boolean;
  empty?: number | null;
  className?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value).replace('.', ','));
  return (
    <label className={cn('block min-w-0 text-xs font-semibold text-muted-foreground', className)}>
      <span className="block truncate">{label}</span>
      <span className="relative mt-1 block">
        <input
          inputMode="decimal"
          className={cn(inputClass, 'tabular-nums', suffix && 'pr-9')}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            const s = v.replace(/\s/g, '').replace(',', '.');
            if (s === '') onChange(empty);
            else if (Number.isFinite(Number(s))) onChange(Number(s));
          }}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}

export function TaxModelEditor({ initial, readOnly }: { initial: TaxModel; readOnly: boolean }) {
  const t = useTranslations('netIncome.config');
  const tErr = useTranslations('netIncome.errors');
  const router = useRouter();
  const [model, setModel] = useState<TaxModel>(initial);
  // Remounts the number fields after a reset, so they show the new values.
  const [version, setVersion] = useState(0);
  const [saving, start] = useTransition();
  const set = <K extends keyof TaxModel>(k: K, v: TaxModel[K]) => setModel((m) => ({ ...m, [k]: v }));
  const many = model.partners.length > 1;
  const partnerNames: TaxPartner[] = model.partners.map((p, i) => ({ ...p, name: p.name || t('partnerFallback', { n: i + 1 }) }));

  const setPartner = (i: number, patch: Partial<TaxPartner>) => set('partners', model.partners.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const save = () =>
    start(async () => {
      const res = await saveTaxModel({
        ...model,
        partners: model.partners.map((p) => ({ ...p, name: p.name.trim() })),
        shared_expenses: model.shared_expenses.filter((e) => e.label.trim()),
        extra_income: model.extra_income.filter((e) => e.label.trim())
      });
      if (!res.ok) {
        const code = ERRORS.find((c) => res.error.includes(c));
        toast({ text: code ? tErr(code) : tErr('generic'), tone: 'err' });
        return;
      }
      toast({ text: t('saved'), tone: 'ok' });
      router.refresh();
    });

  const rate = (k: 'flat_expense_percent' | 'income_tax_percent' | 'social_rate_percent' | 'social_base_percent' | 'health_rate_percent' | 'health_base_percent') => (
    <NumField key={`${k}-${version}`} label={t(`fields.${k}`)} suffix="%" value={model[k]} disabled={readOnly} onChange={(n) => set(k, n ?? 0)} />
  );

  return (
    <details className="group mt-6 rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-bold">
          <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('title')}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-6 border-t border-border px-4 py-4">
        {readOnly && <Banner tone="info">{t('readOnly')}</Banner>}

        <fieldset className="space-y-3">
          <legend className="text-sm font-bold">{t('rates')}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {rate('flat_expense_percent')}
            <NumField
              key={`cap-${version}`}
              label={t('fields.flat_expense_cap')}
              suffix="Kč"
              value={model.flat_expense_cap}
              empty={null}
              disabled={readOnly}
              onChange={(n) => set('flat_expense_cap', n)}
            />
            {rate('income_tax_percent')}
            {rate('social_rate_percent')}
            {rate('social_base_percent')}
            {rate('health_rate_percent')}
            {rate('health_base_percent')}
          </div>
          <InfoHint hint={t('ratesHint')} className="text-xs text-muted-foreground">
            {t('ratesHintLabel')}
          </InfoHint>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-bold">{t('partners')}</legend>
          <p className="text-xs text-muted-foreground">{t('partnersHint')}</p>
          {model.partners.map((p, i) => (
            <div key={p.id} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_7rem_10rem_auto]">
              <label className="col-span-2 block min-w-0 text-xs font-semibold text-muted-foreground sm:col-span-1">
                <span className="block">{t('partnerName')}</span>
                <input
                  className={cn(inputClass, 'mt-1')}
                  value={p.name}
                  maxLength={60}
                  placeholder={partnerNames[i]!.name}
                  disabled={readOnly}
                  onChange={(e) => setPartner(i, { name: e.target.value })}
                />
              </label>
              <NumField key={`share-${p.id}-${version}`} label={t('partnerShare')} value={p.share} disabled={readOnly} onChange={(n) => setPartner(i, { share: n ?? 0 })} />
              <NumField key={`credit-${p.id}-${version}`} label={t('partnerCredits')} suffix="Kč" value={p.tax_credits} disabled={readOnly} onChange={(n) => setPartner(i, { tax_credits: n ?? 0 })} />
              {!readOnly && many && (
                <button
                  type="button"
                  className={cn(buttonClass.ghost, 'col-span-2 h-10 sm:col-span-1')}
                  aria-label={t('remove')}
                  onClick={() => set('partners', model.partners.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="sm:sr-only">{t('remove')}</span>
                </button>
              )}
            </div>
          ))}
          {!readOnly && model.partners.length < MAX_PARTNERS && (
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => set('partners', [...model.partners, { id: newId(), name: '', share: model.partners[0]?.share ?? 1, tax_credits: 30_840 }])}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('addPartner')}
            </button>
          )}
          <InfoHint hint={t('creditsHint')} className="text-xs text-muted-foreground">
            {t('creditsHintLabel')}
          </InfoHint>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-bold">{t('sharedExpenses')}</legend>
          <p className="text-xs text-muted-foreground">{t('sharedExpensesHint')}</p>
          {model.shared_expenses.map((e, i) => {
            const patch = (p: Partial<typeof e>) => set('shared_expenses', model.shared_expenses.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <div key={`${i}-${version}`} className="space-y-2 rounded-lg border border-border p-3">
                <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_9rem_8rem_auto]">
                  <label className="col-span-2 block min-w-0 text-xs font-semibold text-muted-foreground sm:col-span-1">
                    <span className="block">{t('label')}</span>
                    <input className={cn(inputClass, 'mt-1')} value={e.label} maxLength={80} disabled={readOnly} onChange={(ev) => patch({ label: ev.target.value })} />
                  </label>
                  <NumField key={`exp-${i}-${version}`} label={t('amount')} suffix="Kč" value={e.amount} disabled={readOnly} onChange={(n) => patch({ amount: n ?? 0 })} />
                  <label className="block min-w-0 text-xs font-semibold text-muted-foreground">
                    <span className="block">{t('per')}</span>
                    <select className={cn(inputClass, 'mt-1')} value={e.per} disabled={readOnly} onChange={(ev) => patch({ per: ev.target.value as 'month' | 'year' })}>
                      <option value="month">{t('perMonth')}</option>
                      <option value="year">{t('perYear')}</option>
                    </select>
                  </label>
                  {!readOnly && (
                    <button type="button" className={cn(buttonClass.ghost, 'col-span-2 h-10 sm:col-span-1')} aria-label={t('remove')} onClick={() => { set('shared_expenses', model.shared_expenses.filter((_, j) => j !== i)); setVersion((v) => v + 1); }}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="sm:sr-only">{t('remove')}</span>
                    </button>
                  )}
                </div>
                {many && <SharesPicker partners={partnerNames} value={e.shares} disabled={readOnly} label={t('splitOf', { label: e.label })} onChange={(s) => patch({ shares: s })} />}
              </div>
            );
          })}
          {!readOnly && model.shared_expenses.length < 50 && (
            <button type="button" className={buttonClass.secondary} onClick={() => set('shared_expenses', [...model.shared_expenses, { label: '', amount: 0, per: 'month', shares: null }])}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('addExpense')}
            </button>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-bold">{t('extraIncome')}</legend>
          <p className="text-xs text-muted-foreground">{t('extraIncomeHint')}</p>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto">
            {model.extra_income.map((e, i) => {
              const patch = (p: Partial<typeof e>) => set('extra_income', model.extra_income.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={`${i}-${version}`} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[9.5rem_1fr_9rem_auto]">
                    <label className="block min-w-0 text-xs font-semibold text-muted-foreground">
                      <span className="block">{t('date')}</span>
                      <input type="date" className={cn(inputClass, 'mt-1')} value={e.date} disabled={readOnly} onChange={(ev) => patch({ date: ev.target.value })} />
                    </label>
                    <NumField key={`extra-${i}-${version}`} label={t('amount')} suffix="Kč" value={e.amount} disabled={readOnly} onChange={(n) => patch({ amount: n ?? 0 })} className="sm:order-3" />
                    <label className="col-span-2 block min-w-0 text-xs font-semibold text-muted-foreground sm:order-2 sm:col-span-1">
                      <span className="block">{t('label')}</span>
                      <input className={cn(inputClass, 'mt-1')} value={e.label} maxLength={80} disabled={readOnly} onChange={(ev) => patch({ label: ev.target.value })} />
                    </label>
                    {!readOnly && (
                      <button type="button" className={cn(buttonClass.ghost, 'col-span-2 h-10 sm:order-4 sm:col-span-1')} aria-label={t('remove')} onClick={() => { set('extra_income', model.extra_income.filter((_, j) => j !== i)); setVersion((v) => v + 1); }}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        <span className="sm:sr-only">{t('remove')}</span>
                      </button>
                    )}
                  </div>
                  {many && <SharesPicker partners={partnerNames} value={e.shares} disabled={readOnly} label={t('splitOf', { label: e.label })} onChange={(s) => patch({ shares: s })} />}
                </div>
              );
            })}
          </div>
          {!readOnly && model.extra_income.length < 500 && (
            <button type="button" className={buttonClass.secondary} onClick={() => set('extra_income', [...model.extra_income, { date: today(), label: '', amount: 0, shares: null }])}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('addExtra')}
            </button>
          )}
        </fieldset>

        {!readOnly && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <button type="button" className={buttonClass.primary} disabled={saving} onClick={save}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {t('save')}
            </button>
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={saving}
              onClick={() => {
                // Rates only: partners, expenses and extra income are the company's own data.
                setModel((m) => ({ ...DEFAULTS, partners: m.partners, shared_expenses: m.shared_expenses, extra_income: m.extra_income }));
                setVersion((v) => v + 1);
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('resetRates')}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
