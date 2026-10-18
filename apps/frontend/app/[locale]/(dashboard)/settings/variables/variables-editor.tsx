'use client';

import { useState, useTransition } from 'react';
import { Braces, Check, Copy, Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { BUILTIN_GROUPS, BUILTIN_VARS, MAX_TEMPLATE_VARS, PRESET_VARS, sampleValues, VAR_KEY_RE, type TemplateVar } from '@/lib/template-vars';
import { cn } from '@/lib/utils';
import { updateTemplateVars } from '../actions';
import { copyText } from '@/lib/clipboard';

/** "Obchodní podmínky" → "obchodni_podminky". */
const slug = (label: string) =>
  label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 32);

export function VariablesEditor({
  initial,
  company,
  readOnly
}: {
  initial: TemplateVar[];
  company: { companyName: string; ico: string | null; dic: string | null; email: string | null };
  readOnly: boolean;
}) {
  const t = useTranslations('settings.variables');
  const router = useRouter();
  const [vars, setVars] = useState<TemplateVar[]>(initial);
  const [saving, startSave] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const keyError = (v: TemplateVar, i: number) => {
    if (!VAR_KEY_RE.test(v.key)) return t('errors.format');
    if ((BUILTIN_VARS as string[]).includes(v.key)) return t('errors.builtin');
    if (vars.findIndex((o) => o.key === v.key) !== i) return t('errors.duplicate');
    return null;
  };
  const invalid = vars.some((v, i) => keyError(v, i));
  const dirty = JSON.stringify(vars) !== JSON.stringify(initial);

  const update = (i: number, patch: Partial<TemplateVar>) => setVars((all) => all.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const add = (v: TemplateVar) => setVars((all) => (all.length >= MAX_TEMPLATE_VARS ? all : [...all, v]));
  const presets = PRESET_VARS.filter((p) => !vars.some((v) => v.key === p.key));

  const copy = async (key: string) => {
    try {
      await copyText(`{${key}}`);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      // clipboard blocked — nothing to do
    }
  };

  const save = () =>
    startSave(async () => {
      const result = await updateTemplateVars(vars.map((v) => ({ key: v.key, value: v.value, label: v.label?.trim() || null })));
      toast(result.ok ? { text: t('saved'), tone: 'ok' } : { text: `${t('saveFailed')}: ${result.error}`, tone: 'err' });
      if (result.ok) router.refresh();
    });

  const samples = sampleValues(company, vars);
  const card = 'mt-6 rounded-xl border border-border bg-card p-5';
  const chip = 'inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs transition-colors hover:border-primary hover:text-primary';

  return (
    <>
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <InfoHint hint={t('ownHint')}>
            <h2 className="flex items-center gap-2 font-bold">
              <Braces className="h-4 w-4 text-primary" />
              {t('ownTitle')}
            </h2>
          </InfoHint>
          <span className="text-xs text-muted-foreground">
            {vars.length} / {MAX_TEMPLATE_VARS}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('numberHint')}</p>

        <fieldset disabled={readOnly} className="mt-4 space-y-3">
          {vars.length === 0 && <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>}
          {vars.map((v, i) => {
            const error = keyError(v, i);
            return (
              <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
                <div className="space-y-2">
                  <input
                    value={v.label ?? ''}
                    onChange={(e) => {
                      const label = e.target.value;
                      // Keep the key following the name until someone edits the key by hand.
                      const follows = !v.key || v.key === slug(v.label ?? '');
                      update(i, { label, ...(follows ? { key: slug(label) } : {}) });
                    }}
                    maxLength={60}
                    placeholder={t('labelPlaceholder')}
                    aria-label={t('label')}
                    className={inputClass}
                  />
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-sm text-muted-foreground">{'{'}</span>
                    <input
                      value={v.key}
                      onChange={(e) => update(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                      maxLength={32}
                      placeholder="nazev_promenne"
                      aria-label={t('key')}
                      aria-invalid={!!error}
                      className={cn(inputClass, 'py-1 font-mono text-sm', error && 'border-destructive')}
                    />
                    <span className="font-mono text-sm text-muted-foreground">{'}'}</span>
                  </div>
                  {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
                <textarea
                  value={v.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  maxLength={1000}
                  rows={3}
                  placeholder={t('valuePlaceholder')}
                  aria-label={t('value')}
                  className={cn(inputClass, 'min-h-[84px]')}
                />
                <div className="flex gap-1 sm:flex-col">
                  <button type="button" onClick={() => copy(v.key)} disabled={!v.key} title={t('copy')} aria-label={t('copy')} className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-primary">
                    {copied === v.key ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVars((all) => all.filter((_, j) => j !== i))}
                    title={t('remove')}
                    aria-label={t('remove')}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}

          {!readOnly && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button type="button" onClick={() => add({ key: '', value: '', label: '' })} disabled={vars.length >= MAX_TEMPLATE_VARS} className={buttonClass.secondary}>
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
                {t('presets')}
              </span>
            </InfoHint>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button key={p.key} type="button" onClick={() => add(p)} title={p.value} className={cn(chip, 'font-sans')}>
                  <Plus className="h-3 w-3" />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className={card}>
        <InfoHint hint={t('builtinHint')}>
          <h2 className="font-bold">{t('builtinTitle')}</h2>
        </InfoHint>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {(Object.keys(BUILTIN_GROUPS) as (keyof typeof BUILTIN_GROUPS)[]).map((group) => (
            <div key={group}>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t(`groups.${group}`)}</p>
              <ul className="space-y-1">
                {BUILTIN_GROUPS[group].map((key) => (
                  <li key={key} className="flex items-center justify-between gap-2 text-sm">
                    <button type="button" onClick={() => copy(key)} className={chip} title={t('copy')}>
                      {copied === key ? <Check className="h-3 w-3 text-success" /> : null}
                      {`{${key}}`}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{t(`builtin.${key}`)}</span>
                    <span className="hidden max-w-[40%] truncate text-xs text-muted-foreground/70 md:inline" title={samples[key]}>
                      {samples[key] || '–'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{t('whereUsed')}</p>
      </section>
    </>
  );
}
