'use client';

import { useState, useTransition } from 'react';
import { czTaxYear } from '@faktur/cz-compliance';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Loader2, Plus, RotateCcw, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { RATE_KEYS, resolvedYear, type PartnerMember, type SharedExpense, type TaxModel, type TaxPartner, type TaxRates, type YearSettings, yearSource } from '@/lib/net-income';
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
  extra_income: [],
  years: {}
};

const MAX_PARTNERS = 10;
const ACTUAL_FIELDS = ['actual_tax', 'actual_social', 'actual_health', 'actual_refund'] as const;
const ERRORS = ['duplicate_partner_user', 'partner_user_not_member', 'partner_limit', 'duplicate_partner', 'shares_must_be_positive', 'expense_date_required', 'expense_range_invalid'];

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** `<input type="month">` keeps "YYYY-MM"; the model stores the first or the last day of it. */
const firstDay = (month: string) => (month ? `${month}-01` : null);
const lastDay = (month: string) => {
  if (!month) return null;
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y!, m!, 0).getDate()).padStart(2, '0')}`;
};

/**
 * A new year's entry: what was in force so far, with the figures the repo
 * tables per year (cz-tax-years) put over it. Of the editable values only the
 * social base share and the taxpayer credit are tabled there; the rates are
 * copied as they are.
 */
function entryFor(model: TaxModel, year: number): YearSettings {
  const entry = resolvedYear(model, year);
  const known = czTaxYear(year);
  if (known) entry.social_base_percent = Math.round(known.socialBaseShare * 1000) / 10;
  if (known && entry.tax_scope === 'one_person' && !entry.tax_credits) entry.tax_credits = known.taxpayerCredit;
  return entry;
}

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

/**
 * The yearly credits as a choice of the common cases (none, the taxpayer,
 * the taxpayer and a spouse), so nobody has to look the amounts up. Any other
 * sum (children, disability…) is typed in. Amounts come from cz-tax-years.
 */
function CreditsField({ year, value, onChange, label, disabled }: { year: number; value: number; onChange: (n: number) => void; label: string; disabled?: boolean }) {
  const t = useTranslations('netIncome.config');
  const known = czTaxYear(year);
  const taxpayer = known?.taxpayerCredit ?? DEFAULTS.partners[0]!.tax_credits;
  const presets = [
    { key: 'none', amount: 0 },
    { key: 'taxpayer', amount: taxpayer },
    ...(known ? [{ key: 'spouse', amount: taxpayer + known.spouseCredit }] : [])
  ];
  const [custom, setCustom] = useState(!presets.some((p) => p.amount === value));
  const locale = useLocale();
  const fmt = (n: number) => n.toLocaleString(locale);
  return (
    <div className="min-w-0 space-y-2">
      <label className="block min-w-0 text-xs font-semibold text-muted-foreground">
        <span className="block truncate">{label}</span>
        <select
          className={cn(inputClass, 'mt-1')}
          value={custom ? 'custom' : presets.find((p) => p.amount === value)!.key}
          disabled={disabled}
          onChange={(e) => {
            const p = presets.find((x) => x.key === e.target.value);
            setCustom(!p);
            if (p) onChange(p.amount);
          }}
        >
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {t(`credits.${p.key}`, { amount: fmt(p.amount) })}
            </option>
          ))}
          <option value="custom">{t('credits.custom')}</option>
        </select>
      </label>
      {custom && <NumField label={t('credits.customAmount')} suffix="Kč" value={value} disabled={disabled} onChange={(n) => onChange(n ?? 0)} />}
    </div>
  );
}

export function TaxModelEditor({
  initial,
  readOnly,
  year: reportYear,
  members
}: {
  initial: TaxModel;
  readOnly: boolean;
  year: number;
  members: PartnerMember[];
}) {
  const t = useTranslations('netIncome.config');
  const locale = useLocale();
  const tErr = useTranslations('netIncome.errors');
  const router = useRouter();
  const [model, setModel] = useState<TaxModel>(initial);
  // The year whose settings are shown; starts at the one the report is on.
  const [year, setYear] = useState(reportYear);
  // Remounts the number fields after a reset, so they show the new values.
  const [version, setVersion] = useState(0);
  // Per year: whether "Skutečně zaplaceno" was opened or closed by hand.
  const [actualOpen, setActualOpen] = useState<Record<number, boolean>>({});
  const [saving, start] = useTransition();
  const set = <K extends keyof TaxModel>(k: K, v: TaxModel[K]) => setModel((m) => ({ ...m, [k]: v }));
  const many = model.partners.length > 1;
  const partnerNames: TaxPartner[] = model.partners.map((p, i) => ({ ...p, name: p.name || t('partnerFallback', { n: i + 1 }) }));

  const setPartner = (i: number, patch: Partial<TaxPartner>) => set('partners', model.partners.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const entry = model.years[String(year)];
  const shown = entry ?? resolvedYear(model, year);
  const source = yearSource(model, year);
  // Only a year with its own entry is edited, so a change never leaks into another year.
  const locked = readOnly || !entry;
  const onePerson = shown.tax_scope === 'one_person';
  const setEntry = (patch: Partial<YearSettings>) => setModel((m) => ({ ...m, years: { ...m.years, [year]: { ...m.years[String(year)]!, ...patch } } }));
  const createEntry = () => {
    setModel((m) => ({ ...m, years: { ...m.years, [year]: entryFor(m, year) } }));
    setVersion((v) => v + 1);
  };
  const fieldKey = (k: string) => `${k}-${year}-${entry ? 'own' : 'inherited'}-${version}`;

  const save = () =>
    start(async () => {
      const ids = new Set(model.partners.map((p) => p.id));
      const years = Object.fromEntries(
        Object.entries(model.years).map(([y, e]) => [y, { ...e, partners: Object.fromEntries(Object.entries(e.partners).filter(([id]) => ids.has(id))) }])
      );
      const res = await saveTaxModel({
        ...model,
        years,
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

  const rate = (k: Exclude<keyof TaxRates, 'flat_expense_cap'>) => (
    <NumField key={fieldKey(k)} label={t(`fields.${k}`)} suffix="%" value={shown[k]} disabled={locked} onChange={(n) => setEntry({ [k]: n ?? 0 })} />
  );
  const yearButton = cn(buttonClass.ghost, 'h-8 w-8 shrink-0 p-0');

  return (
    <details id="tax-model" className="group mt-6 rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-bold">
          <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('title')}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-6 border-t border-border px-4 py-4">
        {readOnly && <Banner tone="info">{t('readOnly')}</Banner>}

        <fieldset id="net-income-settings" className="scroll-mt-24 space-y-3">
          <legend className="sr-only">{t('yearTitle', { year })}</legend>
          <div className="flex items-center gap-1">
            <button type="button" className={yearButton} aria-label={t('prevYear')} disabled={year <= 2000} onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <p className="min-w-0 text-sm font-bold tabular-nums" aria-live="polite">
              {t('yearTitle', { year })}
            </p>
            <button type="button" className={yearButton} aria-label={t('nextYear')} disabled={year >= 2100} onClick={() => setYear((y) => y + 1)}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {!entry && (
            <Banner tone="info">
              <p>{source != null ? t('yearInherited', { year, from: source }) : t('yearDefault', { year })}</p>
              {/* Under the text, not beside it: at phone width a side button squeezes the sentence. */}
              {!readOnly && (
                <button type="button" className={cn(buttonClass.secondary, 'mt-2')} onClick={createEntry}>
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {source != null ? t('copyFrom', { from: source }) : t('createYear', { year })}
                </button>
              )}
            </Banner>
          )}
          {many && (
            <label className="block text-xs font-semibold text-muted-foreground">
              <span className="block">{t('taxScope')}</span>
              <select
                className={cn(inputClass, 'mt-1 sm:max-w-sm')}
                value={shown.tax_scope}
                disabled={locked}
                onChange={(ev) => {
                  const scope = ev.target.value as YearSettings['tax_scope'];
                  // The one taxpayer starts with the first partner's credits, not with nothing.
                  const first = model.partners[0]!;
                  const credits = shown.tax_credits || (shown.partners[first.id]?.tax_credits ?? first.tax_credits);
                  setEntry(scope === 'one_person' ? { tax_scope: scope, tax_credits: credits } : { tax_scope: scope });
                  setVersion((v) => v + 1);
                }}
              >
                <option value="per_partner">{t('scopePerPartner')}</option>
                <option value="one_person">{t('scopeOnePerson')}</option>
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {rate('flat_expense_percent')}
            <NumField
              key={fieldKey('cap')}
              label={t('fields.flat_expense_cap')}
              suffix="Kč"
              value={shown.flat_expense_cap}
              empty={null}
              disabled={locked}
              onChange={(n) => setEntry({ flat_expense_cap: n })}
            />
            {rate('income_tax_percent')}
            {rate('social_rate_percent')}
            {rate('social_base_percent')}
            {rate('health_rate_percent')}
            {rate('health_base_percent')}
            {onePerson && (
              <CreditsField key={fieldKey('credits')} year={year} label={t('partnerCredits')} value={shown.tax_credits} disabled={locked} onChange={(n) => setEntry({ tax_credits: n })} />
            )}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={!!shown.secondary_activity}
              disabled={locked}
              onChange={(e) => setEntry({ secondary_activity: e.target.checked })}
            />
            <span>
              {t('secondaryActivity')}
              <span className="block text-xs text-muted-foreground">
                {czTaxYear(year) ? t('secondaryActivityHint', { amount: czTaxYear(year)!.social.secondaryThreshold.toLocaleString(locale) }) : t('secondaryActivityUnknown', { year })}
              </span>
            </span>
          </label>
          {/* One taxpayer's real payments, shared out by income; per partner each files their own, which the model does not track. */}
          {(onePerson || !many) && (
            <details
              className="group/actual rounded-lg border border-border"
              // Open by what is saved, not by what is being typed: clearing the last field must not fold it shut.
              open={actualOpen[year] ?? ACTUAL_FIELDS.some((k) => initial.years[String(year)]?.[k] != null)}
              onToggle={(e) => {
                const open = e.currentTarget.open;
                setActualOpen((o) => (o[year] === open ? o : { ...o, [year]: open }));
              }}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                {t('actual.title')}
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/actual:rotate-180" aria-hidden="true" />
              </summary>
              <div className="space-y-3 border-t border-border px-3 py-3">
                <p className="text-xs text-muted-foreground">{t('actual.hint')}</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {ACTUAL_FIELDS.map((k) => (
                    <NumField
                      key={fieldKey(k)}
                      label={t(`actual.${k}`)}
                      suffix="Kč"
                      value={entry?.[k] ?? null}
                      empty={null}
                      disabled={locked}
                      // Whole Kč, like the přiznání; a refund is entered with a minus.
                      onChange={(n) => setEntry({ [k]: n == null ? null : k === 'actual_refund' ? Math.round(n) : Math.max(0, Math.round(n)) })}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('actual.refundHint')}</p>
              </div>
            </details>
          )}
          <p className="text-xs text-muted-foreground">{t(onePerson ? 'scopeOnePersonHint' : 'yearHint')}</p>
          <InfoHint hint={t('ratesHint')} className="text-xs text-muted-foreground">
            {t('ratesHintLabel')}
          </InfoHint>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-bold">{t('partners')}</legend>
          <p className="text-xs text-muted-foreground">{t('partnersHint')}</p>
          {model.partners.map((p, i) => (
            <div
              key={p.id}
              id={`partner-${p.id}`}
              className={cn('grid scroll-mt-24 grid-cols-2 items-end gap-2 rounded-lg border border-border p-3', onePerson ? 'sm:grid-cols-[1fr_7rem_auto]' : 'sm:grid-cols-[1fr_7rem_15rem_auto]')}
            >
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
              {!onePerson && (
                <CreditsField
                  key={fieldKey(`credit-${p.id}`)}
                  year={year}
                  label={t('partnerCreditsIn', { year })}
                  value={shown.partners[p.id]?.tax_credits ?? p.tax_credits}
                  disabled={locked}
                  onChange={(n) => setEntry({ partners: { ...entry!.partners, [p.id]: { tax_credits: n } } })}
                />
              )}
              {members.length > 1 && (
                <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-2 sm:col-span-full">
                  <label className="block min-w-0 text-xs font-semibold text-muted-foreground">
                    <span className="block">{t('partnerMember')}</span>
                    <select
                      className={cn(inputClass, 'mt-1 sm:w-64')}
                      value={p.user_id ?? ''}
                      disabled={readOnly}
                      onChange={(e) => setPartner(i, e.target.value ? { user_id: e.target.value } : { user_id: null, claim_own: false })}
                    >
                      <option value="">{t('partnerMemberNone')}</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId} disabled={model.partners.some((o, j) => j !== i && o.user_id === m.userId)}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {p.user_id && (
                    <label className="flex min-h-10 items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-primary" checked={!!p.claim_own} disabled={readOnly} onChange={(e) => setPartner(i, { claim_own: e.target.checked })} />
                      {t('partnerClaimOwn')}
                    </label>
                  )}
                </div>
              )}
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
            const patch = (p: Partial<SharedExpense>) => set('shared_expenses', model.shared_expenses.map((x, j) => (j === i ? { ...x, ...p } : x)));
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
                    <select
                      className={cn(inputClass, 'mt-1')}
                      value={e.per}
                      disabled={readOnly}
                      onChange={(ev) => {
                        const per = ev.target.value as SharedExpense['per'];
                        patch(per === 'once' ? { per, date: e.date ?? today(), from: null, to: null } : { per, date: null });
                      }}
                    >
                      <option value="once">{t('perOnce')}</option>
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
                {e.per === 'once' ? (
                  <label className="block min-w-0 text-xs font-semibold text-muted-foreground sm:w-[9.5rem]">
                    <span className="block">{t('date')}</span>
                    <input type="date" required className={cn(inputClass, 'mt-1')} value={e.date ?? ''} disabled={readOnly} onChange={(ev) => patch({ date: ev.target.value || null })} />
                  </label>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:w-[20rem]">
                    <label className="block min-w-0 text-xs font-semibold text-muted-foreground">
                      <span className="block">{t('from')}</span>
                      <input
                        type="month"
                        className={cn(inputClass, 'mt-1')}
                        value={e.from?.slice(0, 7) ?? ''}
                        max={e.to?.slice(0, 7)}
                        disabled={readOnly}
                        onChange={(ev) => patch({ from: firstDay(ev.target.value) })}
                      />
                    </label>
                    <label className="block min-w-0 text-xs font-semibold text-muted-foreground">
                      <span className="block">{t('to')}</span>
                      <input
                        type="month"
                        className={cn(inputClass, 'mt-1')}
                        value={e.to?.slice(0, 7) ?? ''}
                        min={e.from?.slice(0, 7)}
                        disabled={readOnly}
                        onChange={(ev) => patch({ to: lastDay(ev.target.value) })}
                      />
                    </label>
                  </div>
                )}
                {many && <SharesPicker partners={partnerNames} value={e.shares} disabled={readOnly} label={t('splitOf', { label: e.label })} onChange={(s) => patch({ shares: s })} />}
              </div>
            );
          })}
          {!readOnly && model.shared_expenses.length < 50 && (
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => set('shared_expenses', [...model.shared_expenses, { label: '', amount: 0, per: 'month', date: null, from: null, to: null, shares: null }])}
            >
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
                      <input type="date" required className={cn(inputClass, 'mt-1')} value={e.date} disabled={readOnly} onChange={(ev) => ev.target.value && patch({ date: ev.target.value })} />
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
            {entry && (
              <button
                type="button"
                className={buttonClass.secondary}
                disabled={saving}
                onClick={() => {
                  // The shown year's rates only: partners, credits, expenses and extra income are the company's own data.
                  setEntry(Object.fromEntries(RATE_KEYS.map((k) => [k, DEFAULTS[k]])) as Partial<YearSettings>);
                  setVersion((v) => v + 1);
                }}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t('resetRates')}
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
