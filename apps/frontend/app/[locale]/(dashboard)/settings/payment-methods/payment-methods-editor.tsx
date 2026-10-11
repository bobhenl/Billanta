'use client';

import { useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Sparkles, Trash2, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import type { PaymentMethodDef } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { updatePaymentMethods } from '../actions';

const MAX = 20;
const BASES: PaymentMethodDef['base'][] = ['bank_transfer', 'cash', 'card', 'cash_on_delivery', 'other'];
const PRESETS: { key: string; base: PaymentMethodDef['base'] }[] = [
  { key: 'paypal', base: 'other' },
  { key: 'offset', base: 'other' },
  { key: 'paymentLink', base: 'card' },
  { key: 'crypto', base: 'other' },
  { key: 'foreignTransfer', base: 'bank_transfer' },
  { key: 'advance', base: 'other' }
];

/** "PayPal účet" → "paypal-ucet". */
const slug = (label: string) =>
  label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || 'metoda';

const uniqueId = (label: string, taken: string[]) => {
  const base = slug(label);
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
};

export function PaymentMethodsEditor({ initial, readOnly }: { initial: PaymentMethodDef[]; readOnly: boolean }) {
  const t = useTranslations('settings.paymentMethods');
  const tDoc = useTranslations('doc');
  const router = useRouter();
  const [methods, setMethods] = useState<PaymentMethodDef[]>(initial);
  const [saving, startSave] = useTransition();

  const dirty = JSON.stringify(methods) !== JSON.stringify(initial);
  const invalid = methods.some((m) => !m.label.trim());
  const update = (i: number, patch: Partial<PaymentMethodDef>) => setMethods((all) => all.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const move = (i: number, by: number) =>
    setMethods((all) => {
      const next = [...all];
      const [m] = next.splice(i, 1);
      next.splice(i + by, 0, m!);
      return next;
    });
  const add = (label: string, base: PaymentMethodDef['base'], instructions: string | null) =>
    setMethods((all) => (all.length >= MAX ? all : [...all, { id: uniqueId(label, all.map((m) => m.id)), label, base, instructions }]));
  const presets = PRESETS.filter((p) => !methods.some((m) => m.label === t(`presets.${p.key}.label`)));

  const save = () =>
    startSave(async () => {
      const result = await updatePaymentMethods(methods.map((m) => ({ ...m, label: m.label.trim(), instructions: m.instructions?.trim() || null })));
      toast(result.ok ? { text: t('saved'), tone: 'ok' } : { text: `${t('saveFailed')}: ${result.error}`, tone: 'err' });
      if (result.ok) router.refresh();
    });

  const card = 'mt-6 rounded-xl border border-border bg-card p-5';
  const chip = 'inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary';
  const iconBtn = 'rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-30';

  return (
    <>
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <InfoHint hint={t('ownHint')}>
            <h2 className="flex items-center gap-2 font-bold">
              <Wallet className="h-4 w-4 text-primary" />
              {t('ownTitle')}
            </h2>
          </InfoHint>
          <span className="text-xs text-muted-foreground">
            {methods.length} / {MAX}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('builtinNote')}</p>

        <fieldset disabled={readOnly} className="mt-4 space-y-3">
          {methods.length === 0 && <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>}
          {methods.map((m, i) => (
            <div key={m.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[220px_minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <input
                  value={m.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  maxLength={60}
                  placeholder={t('labelPlaceholder')}
                  aria-label={t('label')}
                  aria-invalid={!m.label.trim()}
                  className={cn(inputClass, !m.label.trim() && 'border-destructive')}
                />
                <div className="space-y-1">
                  <InfoHint hint={t('baseHint')} className="text-xs text-muted-foreground">
                    {t('base')}
                  </InfoHint>
                  <select value={m.base} onChange={(e) => update(i, { base: e.target.value as PaymentMethodDef['base'] })} aria-label={t('base')} className={cn(inputClass, 'py-1 text-sm')}>
                    {BASES.map((b) => (
                      <option key={b} value={b}>
                        {tDoc(`payment.${b}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <InfoHint hint={t('instructionsHint')} className="text-xs text-muted-foreground">
                  {t('instructions')}
                </InfoHint>
                <textarea
                  value={m.instructions ?? ''}
                  onChange={(e) => update(i, { instructions: e.target.value })}
                  maxLength={500}
                  rows={3}
                  placeholder={t('instructionsPlaceholder')}
                  aria-label={t('instructions')}
                  className={cn(inputClass, 'min-h-[84px]')}
                />
              </div>
              <div className="flex gap-1 sm:flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title={t('up')} aria-label={t('up')} className={iconBtn}>
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === methods.length - 1} title={t('down')} aria-label={t('down')} className={iconBtn}>
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setMethods((all) => all.filter((_, j) => j !== i))}
                  title={t('remove')}
                  aria-label={t('remove')}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {!readOnly && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button type="button" onClick={() => add('', 'other', null)} disabled={methods.length >= MAX} className={buttonClass.secondary}>
                <Plus className="h-4 w-4" />
                {t('add')}
              </button>
              <button type="button" onClick={save} disabled={saving || invalid || !dirty} className={buttonClass.primary}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('save')}
              </button>
            </div>
          )}
        </fieldset>

        {!readOnly && presets.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <InfoHint hint={t('presetsHint')} className="mb-2 text-xs font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                {t('presetsTitle')}
              </span>
            </InfoHint>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button key={p.key} type="button" onClick={() => add(t(`presets.${p.key}.label`), p.base, t(`presets.${p.key}.instructions`))} className={chip}>
                  <Plus className="h-3 w-3" />
                  {t(`presets.${p.key}.label`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="font-bold">{t('howTitle')}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('how.form')}</li>
          <li>{t('how.pdf')}</li>
          <li>{t('how.qr')}</li>
          <li>{t('how.snapshot')}</li>
        </ul>
      </section>
    </>
  );
}
