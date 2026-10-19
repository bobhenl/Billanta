'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Eye, Globe, Link2, Loader2, MapPin, Plus, Save, ShoppingCart, Trash2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { Link, useRouter } from '@/i18n/navigation';
import { PROFILE_DOMAIN, profileOrderUrl, profileUrl } from '@/lib/site';
import type { PublicProfileSettings } from '@/lib/tenant';
import { DIRECTORY_TRADES } from '@/lib/business-presets';
import { cn } from '@/lib/utils';
import { checkProfileSlug, updatePublicProfile } from '../actions';
import { copyText } from '@/lib/clipboard';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const MAX_SERVICES = 12;
/** Same shape the backend accepts; it keeps an existing id so a shared order link survives renaming and reordering. */
function newServiceId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const SHOW_KEYS = ['email', 'phone', 'website', 'address', 'ico', 'logo'] as const;

type SlugState = { state: 'idle' | 'checking' | 'ok' } | { state: 'bad'; reason: 'invalid' | 'reserved' | 'taken' };

interface CompanyFacts {
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  hasLogo: boolean;
  hasAddress: boolean;
  ico: string | null;
  hasBankAccount: boolean;
}

export function PublicProfileEditor({
  initial,
  readOnly,
  suggestedSlug,
  towns,
  company
}: {
  initial: PublicProfileSettings;
  readOnly: boolean;
  suggestedSlug: string;
  /** Municipalities the company address can mean (the directory town picker). */
  towns: { slug: string; name: string; district: string }[];
  company: CompanyFacts;
}) {
  const t = useTranslations('settings.publicProfile');
  const locale = useLocale();
  const router = useRouter();
  const [p, setP] = useState<PublicProfileSettings>(() => ({ ...initial, slug: initial.slug ?? (SLUG.test(suggestedSlug) ? suggestedSlug : null) }));
  const [slugState, setSlugState] = useState<SlugState>({ state: 'idle' });
  const [saved, setSaved] = useState(initial);
  const [saving, startSave] = useTransition();
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  // Debounced availability check (format / reserved / another company).
  const slug = p.slug ?? '';
  useEffect(() => {
    if (!slug || slug === saved.slug) return setSlugState({ state: 'idle' });
    if (!SLUG.test(slug)) return setSlugState({ state: 'bad', reason: 'invalid' });
    setSlugState({ state: 'checking' });
    const timer = setTimeout(async () => {
      const result = await checkProfileSlug(slug);
      if (!result.ok) return setSlugState({ state: 'idle' });
      setSlugState(result.data.available ? { state: 'ok' } : { state: 'bad', reason: result.data.reason ?? 'invalid' });
    }, 400);
    return () => clearTimeout(timer);
  }, [slug, saved.slug]);

  const set = (patch: Partial<PublicProfileSettings>) => setP((cur) => ({ ...cur, ...patch }));
  const setService = (i: number, patch: Partial<PublicProfileSettings['services'][number]>) =>
    set({ services: p.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveService = (i: number, by: number) => {
    const next = [...p.services];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    set({ services: next });
  };

  const setDirectory = (patch: Partial<PublicProfileSettings['directory']>) => set({ directory: { ...p.directory, ...patch } });
  const directoryIncomplete = p.directory.enabled && (!p.directory.trade || !p.directory.town);

  const dirty = JSON.stringify(p) !== JSON.stringify(saved);
  const invalid = directoryIncomplete || (p.enabled && !slug) || (slug !== '' && !SLUG.test(slug)) || slugState.state === 'bad' || p.services.some((s) => !s.title.trim());
  const url = slug && SLUG.test(slug) ? profileUrl(slug, locale, origin || undefined) : null;
  const live = saved.enabled && saved.slug ? profileUrl(saved.slug, locale, origin || undefined) : null;
  // Only a service that is already saved on a live profile taking orders has a working link.
  const orderLinkOf = (id: string | null | undefined) =>
    id && live && saved.slug && saved.orders.enabled && saved.services.some((s) => s.id === id) ? profileOrderUrl(saved.slug, id, locale, origin || undefined) : null;
  const setOrders = (patch: Partial<PublicProfileSettings['orders']>) => set({ orders: { ...p.orders, ...patch } });

  const missing = useMemo(
    () =>
      [
        !company.email && p.show.email && 'email',
        !company.phone && p.show.phone && 'phone',
        !company.website && p.show.website && 'website',
        !company.hasAddress && p.show.address && 'address',
        !company.ico && p.show.ico && 'ico',
        !company.hasLogo && p.show.logo && 'logo'
      ].filter(Boolean) as string[],
    [company, p.show]
  );

  const save = () =>
    startSave(async () => {
      const body: PublicProfileSettings = {
        ...p,
        slug: slug || null,
        tagline: p.tagline?.trim() || null,
        about: p.about?.trim() || null,
        services: p.services.map((s) => ({
          id: s.id ?? null,
          title: s.title.trim(),
          description: s.description?.trim() || null,
          price: s.price?.trim() || null,
          unitPrice: s.unitPrice ?? null,
          unit: s.unit?.trim() || null
        }))
      };
      const result = await updatePublicProfile(body);
      if (!result.ok) {
        if (result.error === 'slug_taken') setSlugState({ state: 'bad', reason: 'taken' });
        toast({ text: result.error === 'slug_taken' ? t('slug.taken') : `${t('saveFailed')}: ${result.error}`, tone: 'err' });
        return;
      }
      setSaved(body);
      setP(body);
      toast({ text: body.enabled ? t('savedLive') : t('saved'), tone: 'ok' });
      router.refresh();
    });

  const copy = async (text: string | null, key = 'profile') => {
    if (!text) return;
    try {
      await copyText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard blocked — the link is visible anyway
    }
  };

  const card = 'mt-6 rounded-xl border border-border bg-card p-5';
  const iconBtn = 'rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-30';

  return (
    <fieldset disabled={readOnly} className="contents">
      <section className={cn(card, p.enabled ? 'border-primary/40' : '')}>
        <label className="flex cursor-pointer items-center gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', p.enabled ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
            <Globe className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{t('enabled')}</span>
            <span className="block text-xs text-muted-foreground">{t('enabledHint')}</span>
          </span>
          <input type="checkbox" role="switch" className="h-5 w-5 accent-primary" checked={p.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        </label>
        {live && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
            <a href={live} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold text-primary hover:underline">
              {live}
            </a>
            <button type="button" onClick={() => copy(live)} className={iconBtn} title={t('copy')} aria-label={t('copy')}>
              {copied === 'profile' ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            </button>
            <a href={live} target="_blank" rel="noreferrer" className={iconBtn} title={t('open')} aria-label={t('open')}>
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="font-bold">{t('addressTitle')}</h2>
        <div className="mt-3 space-y-1">
          <InfoHint hint={PROFILE_DOMAIN ? t('slug.hintDomain', { domain: PROFILE_DOMAIN }) : t('slug.hint')} className="text-sm font-semibold">
            {t('slug.label')}
          </InfoHint>
          <div className="flex items-stretch overflow-hidden rounded-lg border border-input focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            {!PROFILE_DOMAIN && <span className="hidden items-center bg-muted px-3 text-sm text-muted-foreground sm:flex">…/{locale}/p/</span>}
            <input
              value={slug}
              onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || null })}
              placeholder={suggestedSlug || 'moje-firma'}
              aria-label={t('slug.label')}
              aria-invalid={slugState.state === 'bad'}
              className="min-w-0 flex-1 bg-background px-3 py-2 text-sm outline-none"
            />
            {PROFILE_DOMAIN && <span className="flex items-center bg-muted px-3 text-sm text-muted-foreground">.{PROFILE_DOMAIN}</span>}
          </div>
          <p className="flex min-h-5 items-center gap-1.5 text-xs" aria-live="polite">
            {slugState.state === 'checking' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('slug.checking')}
              </>
            )}
            {slugState.state === 'ok' && (
              <span className="flex items-center gap-1 text-success">
                <Check className="h-3.5 w-3.5" />
                {t('slug.available')}
              </span>
            )}
            {slugState.state === 'bad' && (
              <span className="flex items-center gap-1 text-destructive">
                <X className="h-3.5 w-3.5" />
                {t(`slug.${slugState.reason}`)}
              </span>
            )}
            {slugState.state === 'idle' && url && <span className="truncate text-muted-foreground">{url}</span>}
          </p>
        </div>
      </section>

      <section className={card}>
        <h2 className="font-bold">{t('contentTitle')}</h2>
        <div className="mt-3 space-y-4">
          <div className="space-y-1">
            <InfoHint hint={t('taglineHint')} className="text-sm font-semibold">
              {t('tagline')}
            </InfoHint>
            <input value={p.tagline ?? ''} onChange={(e) => set({ tagline: e.target.value })} maxLength={120} placeholder={t('taglinePlaceholder')} className={inputClass} />
          </div>
          <div className="space-y-1">
            <InfoHint hint={t('aboutHint')} className="text-sm font-semibold">
              {t('about')}
            </InfoHint>
            <textarea value={p.about ?? ''} onChange={(e) => set({ about: e.target.value })} maxLength={2000} rows={5} placeholder={t('aboutPlaceholder')} className={inputClass} />
            <p className="text-right text-xs text-muted-foreground">{(p.about ?? '').length} / 2000</p>
          </div>
        </div>
      </section>

      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <InfoHint hint={t('servicesHint')}>
            <h2 className="font-bold">{t('services')}</h2>
          </InfoHint>
          <span className="text-xs text-muted-foreground">
            {p.services.length} / {MAX_SERVICES}
          </span>
        </div>
        <div className="mt-3 space-y-3">
          {p.services.length === 0 && <p className="rounded-lg bg-muted/50 px-4 py-5 text-center text-sm text-muted-foreground">{t('servicesEmpty')}</p>}
          {p.services.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
              <div className="space-y-2">
                <input
                  value={s.title}
                  onChange={(e) => setService(i, { title: e.target.value })}
                  maxLength={80}
                  placeholder={t('serviceTitle')}
                  aria-label={t('serviceTitle')}
                  className={cn(inputClass, !s.title.trim() && 'border-destructive')}
                />
                <textarea
                  value={s.description ?? ''}
                  onChange={(e) => setService(i, { description: e.target.value })}
                  maxLength={300}
                  rows={2}
                  placeholder={t('serviceDescription')}
                  aria-label={t('serviceDescription')}
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <input value={s.price ?? ''} onChange={(e) => setService(i, { price: e.target.value })} maxLength={40} placeholder={t('servicePrice')} aria-label={t('servicePrice')} className={inputClass} />
                {p.orders.enabled && (
                  <>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={10000000}
                      step="0.01"
                      value={s.unitPrice ?? ''}
                      onChange={(e) => setService(i, { unitPrice: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                      placeholder={t('serviceUnitPrice')}
                      aria-label={t('serviceUnitPrice')}
                      title={t('serviceUnitPriceHint')}
                      className={inputClass}
                    />
                    <input value={s.unit ?? ''} onChange={(e) => setService(i, { unit: e.target.value })} maxLength={16} placeholder={t('serviceUnit')} aria-label={t('serviceUnit')} className={inputClass} />
                  </>
                )}
              </div>
              <div className="flex gap-1 sm:flex-col">
                {p.orders.enabled && (
                  <button
                    type="button"
                    onClick={() => copy(orderLinkOf(s.id), `service:${s.id}`)}
                    disabled={!orderLinkOf(s.id)}
                    className={iconBtn}
                    title={orderLinkOf(s.id) ? t('copyOrderLink') : t('copyOrderLinkSaveFirst')}
                    aria-label={t('copyOrderLink')}
                  >
                    {copied === `service:${s.id}` ? <Check className="h-4 w-4 text-success" /> : <Link2 className="h-4 w-4" />}
                  </button>
                )}
                <button type="button" onClick={() => moveService(i, -1)} disabled={i === 0} className={iconBtn} title={t('up')} aria-label={t('up')}>
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => moveService(i, 1)} disabled={i === p.services.length - 1} className={iconBtn} title={t('down')} aria-label={t('down')}>
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => set({ services: p.services.filter((_, j) => j !== i) })}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t('remove')}
                  aria-label={t('remove')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={() => set({ services: [...p.services, { id: newServiceId(), title: '', description: null, price: null, unitPrice: null, unit: null }] })}
              disabled={p.services.length >= MAX_SERVICES}
              className={buttonClass.secondary}
            >
              <Plus className="h-4 w-4" />
              {t('addService')}
            </button>
          )}
        </div>
      </section>

      <section className={cn(card, p.orders.enabled ? 'border-primary/40' : '')}>
        <h2 className="flex items-center gap-2 font-bold">
          <ShoppingCart className="h-4 w-4 text-primary" />
          {t('orders.title')}
        </h2>
        <ul className="mt-3 space-y-2">
          {(
            [
              ['enabled', p.orders.enabled, (v: boolean) => setOrders({ enabled: v }), false],
              ['customItems', p.orders.customItems, (v: boolean) => setOrders({ customItems: v }), !p.orders.enabled],
              ['prepay', p.orders.prepay, (v: boolean) => setOrders({ prepay: v }), !p.orders.enabled],
              ['contactForm', p.contactForm, (v: boolean) => set({ contactForm: v }), false]
            ] as const
          ).map(([key, checked, onChange, disabled]) => (
            <li key={key}>
              <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2 text-sm', disabled && 'cursor-not-allowed opacity-60')}>
                <input type="checkbox" role="switch" className="mt-0.5 h-4 w-4 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t(`orders.${key}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`orders.${key}Hint`)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {p.orders.enabled && p.orders.prepay && !company.hasBankAccount && (
          <p className="mt-3 text-xs text-destructive">
            {t('orders.prepayNoAccount')}{' '}
            <Link href="/settings/company" className="font-semibold text-primary hover:underline">
              {t('missingLink')}
            </Link>
          </p>
        )}
        {p.orders.enabled && <p className="mt-3 text-xs text-muted-foreground">{t('orders.linksHint')}</p>}
      </section>

      <section className={card}>
        <InfoHint hint={t('showHint')}>
          <h2 className="flex items-center gap-2 font-bold">
            <Eye className="h-4 w-4 text-primary" />
            {t('showTitle')}
          </h2>
        </InfoHint>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {SHOW_KEYS.map((key) => (
            <li key={key}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={p.show[key]} onChange={(e) => set({ show: { ...p.show, [key]: e.target.checked } })} />
                <span className="flex-1">{t(`show.${key}`)}</span>
              </label>
            </li>
          ))}
          <li className="sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={p.contactCta} onChange={(e) => set({ contactCta: e.target.checked })} />
              <span className="flex-1">
                <InfoHint hint={t('ctaHint')}>{t('cta')}</InfoHint>
              </span>
            </label>
          </li>
        </ul>
        {missing.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('missing', { fields: missing.map((k) => t(`show.${k}`)).join(', ') })}{' '}
            <Link href="/settings/company" className="font-semibold text-primary hover:underline">
              {t('missingLink')}
            </Link>
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{t('neverShown')}</p>
      </section>

      <section className={cn(card, p.directory.enabled ? 'border-primary/40' : '')}>
        <label className={cn('flex cursor-pointer items-start gap-3', towns.length === 0 && !p.directory.enabled && 'cursor-not-allowed opacity-60')}>
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', p.directory.enabled ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
            <MapPin className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{t('directory.enabled')}</span>
            <span className="block text-xs text-muted-foreground">{t('directory.enabledHint')}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="mt-1 h-5 w-5 accent-primary"
            checked={p.directory.enabled}
            disabled={towns.length === 0 && !p.directory.enabled}
            onChange={(e) =>
              // A single matching town is the obvious pick; with several the owner chooses by district.
              setDirectory({ enabled: e.target.checked, town: p.directory.town ?? (towns.length === 1 ? towns[0]!.slug : null) })
            }
          />
        </label>
        {towns.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('directory.noTown')}{' '}
            <Link href="/settings/company" className="font-semibold text-primary hover:underline">
              {t('missingLink')}
            </Link>
          </p>
        )}
        {p.directory.enabled && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              {t('directory.trade')}
              <select value={p.directory.trade ?? ''} onChange={(e) => setDirectory({ trade: e.target.value || null })} className={cn(inputClass, 'mt-1', !p.directory.trade && 'border-destructive')}>
                <option value="">{t('directory.pickTrade')}</option>
                {DIRECTORY_TRADES.map((key) => (
                  <option key={key} value={key}>
                    {t(`directory.trades.${key}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              {t('directory.town')}
              <select value={p.directory.town ?? ''} onChange={(e) => setDirectory({ town: e.target.value || null })} className={cn(inputClass, 'mt-1', !p.directory.town && 'border-destructive')}>
                {towns.length !== 1 && <option value="">{t('directory.pickTown')}</option>}
                {towns.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {towns.length > 1 ? t('directory.townWithDistrict', { name: m.name, district: m.district }) : m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="mt-4 rounded-lg bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">{t('directory.consentTitle')}</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>{p.show.address ? t('directory.consentShown') : t('directory.consentShownNoCity')}</li>
            <li>{t('directory.consentNever')}</li>
            <li>{t('directory.consentSearch')}</li>
            <li>{t('directory.consentWithdraw')}</li>
          </ul>
          <p className="mt-1.5">{t('directory.consentBasis')}</p>
        </div>
        {p.directory.enabled && !p.enabled && <p className="mt-3 text-xs text-destructive">{t('directory.needsProfile')}</p>}
      </section>

      {!readOnly && (
        <div className="sticky bottom-4 mt-6 flex justify-end">
          <button type="button" onClick={save} disabled={saving || invalid || !dirty} className={cn(buttonClass.primary, 'shadow-lg')}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {p.enabled && !saved.enabled ? t('publish') : t('save')}
          </button>
        </div>
      )}
    </fieldset>
  );
}
