'use client';

import { useState, useTransition } from 'react';
import { BadgeCheck, Bot, Check, Download, FileQuestion, Landmark, Loader2, Receipt, Timer, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { BUSINESS_PRESETS, presetForModules, TOGGLEABLE_MODULES, type ModuleSet, type ToggleableModule } from '@/lib/business-presets';
import { RegistryPicker, useCompanyRegistry } from '@/components/registry-picker';
import { Typeahead } from '@/components/typeahead';
import { cn } from '@/lib/utils';
import { searchCustomers } from '../invoices/new/actions';
import type { AresPrefill } from '../invoices/new/types';
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
  const [query, setQuery] = useState(company.ico);
  const [registry, setRegistry] = useCompanyRegistry();
  const [picked, setPicked] = useState<AresPrefill | null>(null);
  const [vatPayer, setVatPayer] = useState(company.vatPayer);
  const [modules, setModules] = useState<ModuleSet>(initialModules);
  const [saving, startSave] = useTransition();
  const preset = presetForModules(modules);

  // Name, own name (OSVČ) or IČO, in ARES, RPO, VIES or a foreign register (same search as a new invoice's customer).
  const fetchCompanies = async (q: string) => {
    const { ares } = await searchCustomers(q, registry);
    return [{ items: ares }];
  };

  const pick = (hit: AresPrefill) => {
    setPicked(hit);
    setQuery(hit.legalName);
    if (hit.isVatPayer != null) setVatPayer(hit.isVatPayer);
  };

  const companyPatch = (hit: AresPrefill): AresPatch => ({
    legal_name: hit.legalName,
    ...(hit.ico ? { ico: hit.ico } : {}),
    ...(hit.dic ? { dic: hit.dic } : {}),
    ...(hit.addressStreet ? { address_street: hit.addressStreet } : {}),
    ...(hit.addressCity ? { address_city: hit.addressCity } : {}),
    ...(hit.addressPostalCode ? { address_postal_code: hit.addressPostalCode } : {}),
    ...(hit.addressCountry ? { address_country: hit.addressCountry } : {})
  });

  const finish = () =>
    startSave(async () => {
      const patch: AresPatch = { dic_vat_payer: vatPayer, ...(picked ? companyPatch(picked) : {}) };
      if (!picked && /^d{8}$/.test(query.trim())) patch.ico = query.trim();
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
          <Typeahead<AresPrefill>
            className="min-w-0 flex-1"
            refreshKey={registry}
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPicked(null);
            }}
            ariaLabel={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            emptyHint={t('searchEmpty')}
            fetchGroups={fetchCompanies}
            getKey={(o) => o.ico || o.dic || o.regNumber || o.legalName}
            onPick={pick}
            renderItem={(o) => (
              <span className="flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-medium">{o.legalName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {[o.ico ? `IČO ${o.ico}` : (o.dic ?? o.regNumber), o.addressCity].filter(Boolean).join(' · ')}
                </span>
              </span>
            )}
          />
          <RegistryPicker value={registry} onChange={setRegistry} />
        </div>
        {picked && (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <Check className="h-3.5 w-3.5" />{' '}
            {[picked.legalName, [picked.addressStreet, picked.addressCity].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
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
