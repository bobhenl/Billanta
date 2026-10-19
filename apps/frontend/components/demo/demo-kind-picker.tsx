'use client';

import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { BUSINESS_PRESETS, type ModuleSet } from '@/lib/business-presets';
import { audienceKind, DEMO_AUDIENCES, type DemoAudience, type DemoAudienceKey } from '@/lib/demo-audiences';
import { DEMO_KINDS, DEMO_VIEW_ROLES, type DemoKind, type DemoViewRole } from '@/lib/demo';
import { cn } from '@/lib/utils';

type Country = 'CZ' | 'SK';
const COUNTRIES: Country[] = ['CZ', 'SK'];
const COUNTRY: Record<DemoKind, Country> = {
  cz_vat_sro: 'CZ',
  cz_freelancer: 'CZ',
  cz_pausal: 'CZ',
  sk_vat_sro: 'SK',
  sk_freelancer: 'SK',
  sk_vat_freelancer: 'SK'
};

/** "Match the company": the signup preset a business like it would pick. */
const KIND_PRESET: Record<DemoKind, string> = {
  cz_vat_sro: 'withAccountant',
  cz_freelancer: 'tradesman',
  cz_pausal: 'flatTax',
  sk_vat_sro: 'withAccountant',
  sk_freelancer: 'tradesman',
  sk_vat_freelancer: 'withAccountant'
};
const presetModules = (key: string): ModuleSet | undefined => BUSINESS_PRESETS.find((p) => p.key === key)?.modules;

/** Preset labels, translated on the server: `settings.modules` is not sent to the public site's client. */
export type DemoPresetLabels = Record<string, { title: string; description: string }>;

/**
 * The country first, then one card per demo company of it, plus three choices: the type of business
 * (the signup presets, which decide the modules shown), filled with sample
 * documents or empty, and whose eyes to look through first (feature pages
 * link here with `?view=accountant` and the like). A click asks
 * /api/demo/start for a fresh company, switches the view if needed and then
 * loads the dashboard with a full page load, so the new session cookie is
 * the one every server component sees. Partner pages link with `?for=`
 * (lib/demo-audiences.ts), which preselects the business type and data and
 * puts that audience's company first.
 */
export function DemoKindPicker({
  locale,
  presets,
  initialView = 'owner',
  audience
}: {
  locale: string;
  presets: DemoPresetLabels;
  initialView?: DemoViewRole;
  audience?: DemoAudienceKey | null;
}) {
  const preselected: DemoAudience | null = audience ? DEMO_AUDIENCES[audience] : null;
  const preselectedKind = preselected ? audienceKind(preselected, locale) : null;
  const t = useTranslations('demo');
  // Slovak visitors look for the Slovak companies first; everyone else starts in Czechia, unless the audience's company is Slovak.
  const [country, setCountry] = useState<Country>(preselectedKind ? COUNTRY[preselectedKind] : locale === 'sk' ? 'SK' : 'CZ');
  const [busy, setBusy] = useState<DemoKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState<boolean>(preselected?.empty ?? false);
  const [view, setView] = useState<DemoViewRole>(initialView);
  const [preset, setPreset] = useState<string | null>(preselected?.preset ?? null);
  // Set when the visitor is signed in to a real account and may sign out to continue.
  const [signedInKind, setSignedInKind] = useState<DemoKind | null>(null);

  const inCountry = DEMO_KINDS.filter((kind) => COUNTRY[kind] === country);
  const kinds = preselectedKind && inCountry.includes(preselectedKind) ? [preselectedKind, ...inCountry.filter((k) => k !== preselectedKind)] : inCountry;

  async function start(kind: DemoKind) {
    setBusy(kind);
    setError(null);
    setSignedInKind(null);
    try {
      const res = await fetch('/api/demo/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, locale, empty, modules: presetModules(preset ?? KIND_PRESET[kind]) })
      });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (res.ok && data.redirect) {
        // The demo works as the owner either way; a failed switch just lands there.
        if (view !== 'owner') {
          await fetch('/api/demo/role', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: view }) }).catch(() => null);
        }
        window.location.assign(data.redirect);
        return;
      }
      const code = data.error && t.has(`errors.${data.error}`) ? data.error : 'demo_unavailable';
      if (code === 'demo_signed_in') setSignedInKind(kind);
      setError(t(`errors.${code}`));
    } catch {
      setError(t('errors.demo_unavailable'));
    }
    setBusy(null);
  }

  async function signOutAndStart(kind: DemoKind) {
    setBusy(kind);
    await signOut({ redirect: false }).catch(() => null);
    await start(kind);
  }

  return (
    <div className="mt-4">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <fieldset className="rounded-xl border border-border bg-card p-3 sm:col-span-2">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('picker.countryTitle')}</legend>
          <div className="flex flex-wrap gap-2">
            {COUNTRIES.map((c) => (
              <label key={c} className={chip(country === c)}>
                <input type="radio" name="demo-country" className="sr-only" checked={country === c} onChange={() => setCountry(c)} />
                {t(`country.${c}`)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('picker.countryHint')}</p>
        </fieldset>
        <fieldset className="rounded-xl border border-border bg-card p-3 sm:col-span-2">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('picker.businessTitle')}</legend>
          <div className="flex flex-wrap gap-2">
            {[null, ...BUSINESS_PRESETS.map((p) => p.key)].map((key) => (
              <label key={key ?? 'auto'} className={chip(preset === key)}>
                <input type="radio" name="demo-business" className="sr-only" checked={preset === key} onChange={() => setPreset(key)} />
                {key ? (presets[key]?.title ?? key) : t('picker.businessAuto')}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{preset ? presets[preset]?.description : t('picker.businessAutoHint')}</p>
        </fieldset>
        <fieldset className="rounded-xl border border-border bg-card p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('picker.dataTitle')}</legend>
          <div className="flex flex-wrap gap-2">
            {[false, true].map((value) => (
              <label key={String(value)} className={chip(empty === value)}>
                <input type="radio" name="demo-data" className="sr-only" checked={empty === value} onChange={() => setEmpty(value)} />
                {t(value ? 'picker.empty' : 'picker.filled')}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t(empty ? 'picker.emptyHint' : 'picker.filledHint')}</p>
        </fieldset>
        <fieldset className="rounded-xl border border-border bg-card p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('picker.viewTitle')}</legend>
          <div className="flex flex-wrap gap-2">
            {DEMO_VIEW_ROLES.map((r) => (
              <label key={r} className={chip(view === r)}>
                <input type="radio" name="demo-view" className="sr-only" checked={view === r} onChange={() => setView(r)} />
                {t(`roles.${r}.label`)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t(`roles.${view}.hint`)}</p>
        </fieldset>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={busy !== null}
            onClick={() => start(kind)}
            className={cn(
              'group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors',
              'hover:border-primary/50 hover:bg-accent disabled:cursor-wait disabled:opacity-60',
              busy === kind && 'border-primary'
            )}
          >
            <span className="text-base font-semibold">{t(`kinds.${kind}.title`)}</span>
            <span className="text-sm text-muted-foreground">{t(`kinds.${kind}.description`)}</span>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-bold text-primary">
              {busy === kind ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t('starting')}
                </>
              ) : (
                <>
                  {t('start')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </>
              )}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {error}
          {signedInKind && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => signOutAndStart(signedInKind)}
              className="ml-2 font-semibold text-primary underline underline-offset-2 hover:no-underline disabled:opacity-60"
            >
              {t('signOutAndStart')}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

const chip = (active: boolean) =>
  cn(
    'cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary/50'
  );
