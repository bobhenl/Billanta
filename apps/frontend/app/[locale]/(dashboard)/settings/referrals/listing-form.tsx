'use client';

import { useMemo, useState, useTransition } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { LISTING_LANGUAGES, LISTING_REGIONS, LISTING_SERVICES } from '@/lib/accountant-directory';
import { cn } from '@/lib/utils';
import { saveListing, withdrawListing, type ListingInput } from './actions';

export interface OwnListing {
  eligible: boolean;
  listing:
    | (Omit<ListingInput, 'bio' | 'priceHint' | 'contactEmail' | 'website'> & {
        bio: string | null;
        priceHint: string | null;
        contactEmail: string | null;
        website: string | null;
        status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
        reviewNote: string | null;
      })
    | null;
}

const ERROR_CODES = ['services_required', 'languages_required', 'region_required', 'contact_required', 'invalid_website', 'accountant_program_required'];

const STATUS_TONE = {
  pending: 'bg-warning/10 text-warning',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-destructive/10 text-destructive',
  withdrawn: 'bg-muted text-muted-foreground'
} as const;

/** Mirrors the backend refinements so the common mistakes get a precise message before a round trip. */
function localError(v: ListingInput): string | null {
  if (v.services.length === 0) return 'services_required';
  if (v.languages.length === 0) return 'languages_required';
  if (v.regions.length === 0 && !v.remote) return 'region_required';
  if (!v.contactEmail.trim() && !v.website.trim()) return 'contact_required';
  return null;
}

/** The company's entry in the public "Looking for an accountant?" list. Every save goes back to admin review. */
export function ListingForm({ own, readOnly }: { own: OwnListing; readOnly: boolean }) {
  const t = useTranslations('accountantDirectory');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const l = own.listing;
  const [v, setV] = useState<ListingInput>({
    displayName: l?.displayName ?? '',
    bio: l?.bio ?? '',
    regions: l?.regions ?? [],
    remote: l?.remote ?? false,
    services: l?.services ?? [],
    languages: l?.languages ?? [locale],
    priceHint: l?.priceHint ?? '',
    contactEmail: l?.contactEmail ?? '',
    website: l?.website ?? ''
  });
  const languageNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'language' }), [locale]);
  const countryNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);

  const errorText = (raw: string) => {
    const code = ERROR_CODES.find((c) => raw.includes(c));
    return t(`settings.errors.${code ?? 'generic'}`);
  };
  const toggle = (key: 'regions' | 'services' | 'languages', value: string) =>
    setV((prev) => ({ ...prev, [key]: prev[key].includes(value) ? prev[key].filter((x) => x !== value) : [...prev[key], value] }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const local = localError(v);
    if (local) return void toast({ text: t(`settings.errors.${local}`), tone: 'err' });
    startTransition(async () => {
      const result = await saveListing(v);
      if (!result.ok) return void toast({ text: errorText(result.error), tone: 'err' });
      toast({ text: t('settings.saved'), tone: 'ok' });
      router.refresh();
    });
  };
  const withdraw = () =>
    startTransition(async () => {
      const result = await withdrawListing();
      if (!result.ok) return void toast({ text: errorText(result.error), tone: 'err' });
      toast({ text: t('settings.withdrawn'), tone: 'ok' });
      router.refresh();
    });

  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60',
      active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
    );
  const disabled = readOnly || pending || !own.eligible;

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-bold">{t('settings.title')}</h2>
        {l && <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_TONE[l.status])}>{t(`settings.status.${l.status}`)}</span>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('settings.intro')}</p>
      {!own.eligible && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{t('settings.needProgram')}</p>}
      {l?.reviewNote && <p className="mt-3 rounded-lg bg-muted p-3 text-sm">{t('settings.reviewNote', { note: l.reviewNote })}</p>}

      <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset disabled={disabled} className="space-y-4">
          <label className="block text-sm font-semibold">
            {t('settings.displayName')}
            <input required minLength={2} maxLength={120} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-sm font-semibold">
            {t('settings.bio')}
            <textarea rows={3} maxLength={600} value={v.bio} onChange={(e) => setV({ ...v, bio: e.target.value })} className={`${inputClass} mt-1`} />
          </label>

          <div>
            <p className="text-sm font-semibold">{t('settings.services')}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LISTING_SERVICES.map((s) => (
                <button key={s} type="button" aria-pressed={v.services.includes(s)} onClick={() => toggle('services', s)} className={chip(v.services.includes(s))}>
                  {t(`services.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold">{t('settings.regions')}</p>
            {(['CZ', 'SK'] as const).map((country) => (
              <div key={country} className="mt-2">
                <p className="text-xs text-muted-foreground">{countryNames.of(country)}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {LISTING_REGIONS.filter((r) => r.startsWith(country)).map((r) => (
                    <button key={r} type="button" aria-pressed={v.regions.includes(r)} onClick={() => toggle('regions', r)} className={chip(v.regions.includes(r))}>
                      {t(`regions.${r}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.remote} onChange={(e) => setV({ ...v, remote: e.target.checked })} />
              {t('settings.remote')}
            </label>
          </div>

          <div>
            <p className="text-sm font-semibold">{t('settings.languages')}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LISTING_LANGUAGES.map((code) => (
                <button key={code} type="button" aria-pressed={v.languages.includes(code)} onClick={() => toggle('languages', code)} className={chip(v.languages.includes(code))}>
                  {languageNames.of(code) ?? code}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm font-semibold">
            {t('settings.priceHint')}
            <input maxLength={80} value={v.priceHint} placeholder={t('settings.priceHintPlaceholder')} onChange={(e) => setV({ ...v, priceHint: e.target.value })} className={`${inputClass} mt-1`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              {t('settings.contactEmail')}
              <input type="email" maxLength={200} value={v.contactEmail} onChange={(e) => setV({ ...v, contactEmail: e.target.value })} className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-sm font-semibold">
              {t('settings.website')}
              <input maxLength={200} value={v.website} placeholder="https://" onChange={(e) => setV({ ...v, website: e.target.value })} className={`${inputClass} mt-1`} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.contactNote')}</p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={disabled} className={buttonClass.primary}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('settings.save')}
          </button>
          {l && l.status !== 'withdrawn' && (
            <button type="button" disabled={readOnly || pending} onClick={withdraw} className={buttonClass.secondary}>
              {t('settings.withdraw')}
            </button>
          )}
          <Link href="/accountants" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {t('settings.viewPage')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        {l && <p className="text-xs text-muted-foreground">{t('settings.editNote')}</p>}
      </form>
    </section>
  );
}
