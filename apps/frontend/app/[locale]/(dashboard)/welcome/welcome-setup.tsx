'use client';

import { useState, useTransition } from 'react';
import { Bot, Check, Download, FileQuestion, Landmark, Loader2, Receipt, Search, Timer, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { BUSINESS_PRESETS, presetForModules, TOGGLEABLE_MODULES, type ModuleSet, type ToggleableModule } from '@/lib/business-presets';
import { cn } from '@/lib/utils';
import { lookupAres } from '../contacts/actions';
import { updateCompany, updateModules } from '../settings/actions';

const ICONS: Record<ToggleableModule, LucideIcon> = {
  expenses: Receipt,
  bank: Landmark,
  quotes: FileQuestion,
  time: Timer,
  reports: Download,
  ai: Bot
};

type AresPatch = Record<string, string | boolean | null>;

/**
 * Three quick questions right after signup — no tour. The answers only set
 * Settings → Company / Modules, so everything stays changeable later.
 */
export function WelcomeSetup({
  initialModules,
  company
}: {
  initialModules: ModuleSet;
  company: { ico: string; vatPayer: boolean; country: string };
}) {
  const t = useTranslations('welcome');
  const tm = useTranslations('settings.modules');
  const router = useRouter();
  const [ico, setIco] = useState(company.ico);
  const [vatPayer, setVatPayer] = useState(company.vatPayer);
  const [ares, setAres] = useState<{ name: string; patch: AresPatch } | null>(null);
  const [loadingAres, setLoadingAres] = useState(false);
  const [modules, setModules] = useState<ModuleSet>(initialModules);
  const [saving, startSave] = useTransition();
  const preset = presetForModules(modules);
  const icoValid = /^\d{8}$/.test(ico.trim());

  const loadAres = async () => {
    setLoadingAres(true);
    const result = await lookupAres(ico.trim());
    setLoadingAres(false);
    if (!result.ok) {
      setAres(null);
      toast({ text: result.error === 'not_found' ? t('aresNotFound') : t('aresFailed'), tone: 'err' });
      return;
    }
    const d = result.data;
    if (d.isVatPayer != null) setVatPayer(d.isVatPayer);
    setAres({
      name: [d.legalName, [d.addressStreet, d.addressCity].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
      patch: {
        ...(d.legalName ? { legal_name: d.legalName } : {}),
        ...(d.dic ? { dic: d.dic } : {}),
        ...(d.addressStreet ? { address_street: d.addressStreet } : {}),
        ...(d.addressCity ? { address_city: d.addressCity } : {}),
        ...(d.addressPostalCode ? { address_postal_code: d.addressPostalCode } : {}),
        ...(d.addressCountry ? { address_country: d.addressCountry } : {})
      }
    });
  };

  const finish = () =>
    startSave(async () => {
      const patch: AresPatch = { dic_vat_payer: vatPayer, ...(ares?.patch ?? {}) };
      if (icoValid) patch.ico = ico.trim();
      const [c, m] = await Promise.all([updateCompany(patch), updateModules(modules)]);
      if (!c.ok || !m.ok) {
        toast({ text: `${t('failed')}: ${(!c.ok ? c.error : !m.ok ? m.error : '') || ''}`, tone: 'err' });
        return;
      }
      toast({ text: t('saved'), tone: 'ok' });
      router.push('/dashboard');
      router.refresh();
    });

  const step = (n: number, title: string, hint?: string) => (
    <div className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {n}
      </span>
      <div>
        <h2 className="font-bold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        {step(1, t('companyTitle'), t('companyHint'))}
        <div className="flex gap-2">
          <input
            value={ico}
            onChange={(e) => {
              setIco(e.target.value.replace(/\D/g, '').slice(0, 8));
              setAres(null);
            }}
            inputMode="numeric"
            placeholder={t('icoPlaceholder')}
            aria-label={t('icoLabel')}
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
          />
          <button type="button" className={buttonClass.secondary} disabled={!icoValid || loadingAres} onClick={loadAres}>
            {loadingAres ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            ARES
          </button>
        </div>
        {ares && (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <Check className="h-3.5 w-3.5" /> {ares.name}
          </p>
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('vatQuestion')}</p>
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={vatPayer === v}
                onClick={() => setVatPayer(v)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-semibold',
                  vatPayer === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {v ? t('yes') : t('no')}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        {step(2, t('businessTitle'), t('businessHint'))}
        <div className="grid gap-2 sm:grid-cols-2">
          {BUSINESS_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={preset === p.key}
              onClick={() => setModules(p.modules)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                preset === p.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'
              )}
            >
              <span className="block text-sm font-semibold">{tm(`presets.${p.key}.title`)}</span>
              <span className="block text-xs text-muted-foreground">{tm(`presets.${p.key}.description`)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        {step(3, t('modulesTitle'), t('modulesHint'))}
        <div className="flex flex-wrap gap-2">
          {TOGGLEABLE_MODULES.map((m) => {
            const Icon = ICONS[m];
            const on = modules[m];
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                title={tm(`items.${m}.description`)}
                onClick={() => setModules({ ...modules, [m]: !on })}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {on ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                {tm(`items.${m}.title`)}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t('later')}</p>
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass.secondary} disabled={saving} onClick={() => router.push('/dashboard')}>
          {t('skip')}
        </button>
        <button type="button" className={buttonClass.primary} disabled={saving} onClick={finish}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('finish')}
        </button>
      </div>
    </div>
  );
}
