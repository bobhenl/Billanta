'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import { usePromoText } from '@/components/promo-text';
import { toast } from '@/components/toaster';
import { BUSINESS_PRESETS } from '@/lib/business-presets';
import { cn } from '@/lib/utils';
import { createPromoCode, setPromoCodeActive, type NewPromoCode } from './actions';
import { JoinLink } from './join-link';

/** A row of `GET /v1/admin/promo-codes`. */
export interface AdminPromoCode {
  id: string;
  code: string;
  kind: NewPromoCode['kind'];
  benefitType: NewPromoCode['benefit_type'];
  benefitPlan: NewPromoCode['benefit_plan'];
  benefitValue: number;
  maxRedemptions: number | null;
  redemptionCount: number;
  paying: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
  ownerLabel: string | null;
  note: string | null;
  referralCode: string | null;
  businessPreset: string | null;
  defaultLocale: NewPromoCode['default_locale'];
  createdAt: string;
}

const KINDS = ['event', 'creator', 'school', 'other'] as const;
const PLANS = ['start', 'plus', 'business'] as const;
const LOCALES = ['cs', 'sk', 'en'] as const;

const EMPTY = {
  code: '',
  kind: 'event' as NewPromoCode['kind'],
  benefit_type: 'trial_days' as NewPromoCode['benefit_type'],
  benefit_plan: 'plus' as NewPromoCode['benefit_plan'],
  benefit_value: '30',
  max_redemptions: '',
  valid_from: '',
  valid_until: '',
  owner_label: '',
  note: '',
  referral_code: '',
  business_preset: '',
  default_locale: '' as NewPromoCode['default_locale'] | ''
};

export function PromoCodesAdmin({ codes }: { codes: AdminPromoCode[] }) {
  const t = useTranslations('adminPromoCodes');
  const tPlan = useTranslations('billing.planNames');
  const tModules = useTranslations('settings.modules');
  const format = useFormatter();
  const router = useRouter();
  const { benefit } = usePromoText();
  const [form, setForm] = useState(EMPTY);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00`), { dateStyle: 'medium' });
  const failed = (error: string) => toast({ text: t.has(`errors.${error}`) ? t(`errors.${error}`) : `${t('failed')}: ${error}`, tone: 'err' });

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createPromoCode({
        code: form.code,
        kind: form.kind,
        benefit_type: form.benefit_type,
        benefit_plan: form.benefit_plan,
        benefit_value: Number(form.benefit_value),
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        owner_label: form.owner_label.trim() || null,
        note: form.note.trim() || null,
        referral_code: form.referral_code.trim() || null,
        business_preset: form.business_preset || null,
        default_locale: form.default_locale || null
      });
      if (!result.ok) return failed(result.error);
      toast({ text: t('created'), tone: 'ok' });
      setForm(EMPTY);
      router.refresh();
    });
  };

  const toggle = (c: AdminPromoCode) => {
    setBusyId(c.id);
    startTransition(async () => {
      const result = await setPromoCodeActive(c.id, !c.active);
      setBusyId(null);
      if (!result.ok) return failed(result.error);
      toast({ text: t(c.active ? 'deactivated' : 'activated'), tone: 'ok' });
      router.refresh();
    });
  };

  const field = 'flex flex-col gap-1 text-sm font-medium';

  return (
    <>
      <form onSubmit={create} className="mt-6 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">{t('form.title')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={field}>
            {t('form.code')}
            <input required value={form.code} onChange={set('code')} maxLength={32} placeholder="STARTUP-WEEK" className={cn(inputClass, 'font-mono uppercase')} />
          </label>
          <label className={field}>
            {t('form.kind')}
            <select value={form.kind} onChange={set('kind')} className={inputClass}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            {t('form.benefitType')}
            <select value={form.benefit_type} onChange={set('benefit_type')} className={inputClass}>
              <option value="trial_days">{t('form.trialDays')}</option>
              <option value="free_months">{t('form.freeMonths')}</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={field}>
              {t('form.value')}
              <input
                required
                type="number"
                min={1}
                max={form.benefit_type === 'trial_days' ? 365 : 24}
                value={form.benefit_value}
                onChange={set('benefit_value')}
                className={inputClass}
              />
            </label>
            <label className={field}>
              {t('form.plan')}
              <select value={form.benefit_plan} onChange={set('benefit_plan')} className={inputClass}>
                {PLANS.map((p) => (
                  <option key={p} value={p}>
                    {tPlan(p)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={field}>
            {t('form.maxRedemptions')}
            <input type="number" min={1} value={form.max_redemptions} onChange={set('max_redemptions')} placeholder={t('form.unlimited')} className={inputClass} />
          </label>
          <label className={field}>
            {t('form.ownerLabel')}
            <input value={form.owner_label} onChange={set('owner_label')} maxLength={120} placeholder={t('form.ownerPlaceholder')} className={inputClass} />
          </label>
          <label className={field}>
            {t('form.referralCode')}
            <input
              value={form.referral_code}
              onChange={set('referral_code')}
              maxLength={16}
              placeholder={t('form.referralPlaceholder')}
              className={cn(inputClass, 'font-mono uppercase')}
            />
          </label>
          <label className={field}>
            {t('form.businessPreset')}
            <select value={form.business_preset} onChange={set('business_preset')} className={inputClass}>
              <option value="">{t('form.presetNone')}</option>
              {BUSINESS_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {tModules(`presets.${p.key}.title`)}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            {t('form.defaultLocale')}
            <select value={form.default_locale ?? ''} onChange={set('default_locale')} className={inputClass}>
              <option value="">{t('form.localeVisitor')}</option>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {t(`locale.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            {t('form.validFrom')}
            <input type="date" value={form.valid_from} onChange={set('valid_from')} className={inputClass} />
          </label>
          <label className={field}>
            {t('form.validUntil')}
            <input type="date" value={form.valid_until} onChange={set('valid_until')} min={form.valid_from || undefined} className={inputClass} />
          </label>
          <label className={cn(field, 'sm:col-span-2')}>
            {t('form.note')}
            <textarea value={form.note} onChange={set('note')} maxLength={500} rows={2} className={inputClass} />
          </label>
        </div>
        <button type="submit" disabled={pending} className={cn(buttonClass.primary, 'mt-4')}>
          {pending && !busyId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {t('form.submit')}
        </button>
      </form>

      {codes.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
          {codes.map((c) => (
            <li key={c.id} className={cn('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4', !c.active && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{c.code}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{t(`kind.${c.kind}`)}</span>
                  {!c.active && <span className="text-xs font-semibold text-muted-foreground">{t('inactive')}</span>}
                </p>
                <p className="mt-0.5 text-sm">{benefit(c)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    c.ownerLabel,
                    c.businessPreset && tModules.has(`presets.${c.businessPreset}.title`) ? tModules(`presets.${c.businessPreset}.title`) : null,
                    c.defaultLocale ? t(`locale.${c.defaultLocale}`) : null,
                    c.referralCode ? t('referrer', { code: c.referralCode }) : null,
                    c.validFrom || c.validUntil ? t('validity', { from: c.validFrom ? day(c.validFrom) : '…', until: c.validUntil ? day(c.validUntil) : '…' }) : null,
                    c.note
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {c.active && <JoinLink code={c.code} />}
              </div>
              <div className="flex items-center gap-4">
                <p className="text-right text-sm tabular-nums">
                  <span className="font-semibold">
                    {c.maxRedemptions ? t('usedOf', { used: c.redemptionCount, max: c.maxRedemptions }) : t('used', { used: c.redemptionCount })}
                  </span>
                  <br />
                  <span className="text-xs text-muted-foreground">{t('paying', { count: c.paying })}</span>
                </p>
                <button type="button" onClick={() => toggle(c)} disabled={pending} className={buttonClass.secondary}>
                  {busyId === c.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t(c.active ? 'deactivate' : 'activate')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
