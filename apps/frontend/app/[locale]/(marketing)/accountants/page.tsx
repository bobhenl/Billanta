import type { Metadata } from 'next';
import { Building2, Globe, Languages, Mail, MapPin, Wallet } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import {
  fetchAccountants,
  isRegion,
  isService,
  LISTING_REGIONS,
  LISTING_SERVICES,
  type PublicAccountant
} from '@/lib/accountant-directory';
import { jsonLd, publicPageMetadata } from '@/lib/seo';
import { profileUrl, SITE_NAME, SITE_URL } from '@/lib/site';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ region?: string; service?: string }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const { region, service } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'accountantDirectory' });
  const metadata = publicPageMetadata({ locale, path: '/accountants', title: t('seoTitle'), description: t('lead') });
  // A filtered view is a permutation of the same list: crawlable so the
  // listings are reachable, but only the unfiltered page is indexed. The
  // canonical stays the unfiltered URL.
  return isRegion(region) || isService(service) ? { ...metadata, robots: { index: false, follow: true } } : metadata;
}

const href = (website: string) => (/^https?:\/\//i.test(website) ? website : `https://${website}`);

/**
 * "Sháníte účetní?": accountants from the partner programme who opted in
 * and were approved by a platform admin (backend accountant-directory).
 * Filters are a plain GET form, so every view is a shareable link that
 * works without JavaScript. Outbound links are user-supplied, hence
 * `nofollow ugc`; they are not partner links and are not counted.
 */
export default async function AccountantsDirectoryPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
  const region = isRegion(query.region) ? query.region : undefined;
  const service = isService(query.service) ? query.service : undefined;
  const filtered = Boolean(region || service);
  const t = await getTranslations('accountantDirectory');
  const listings = await fetchAccountants({ region, service });

  const countries = new Intl.DisplayNames([locale], { type: 'region' });
  const subject = encodeURIComponent(t('emailSubject', { site: SITE_NAME }));

  // Structured data only for the indexed, unfiltered page, and only the
  // fields each card shows.
  const itemList =
    !filtered && listings.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: t('title'),
          url: `${SITE_URL}/${locale}/accountants`,
          itemListElement: listings.map((a, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
              '@type': 'AccountingService',
              name: a.name,
              ...(a.bio ? { description: a.bio } : {}),
              ...(a.regions.length ? { areaServed: a.regions.map((r) => t(`regions.${r}`)) } : {}),
              knowsLanguage: a.languages,
              ...(a.priceHint ? { priceRange: a.priceHint } : {}),
              ...(a.website ? { url: href(a.website) } : {})
            }
          }))
        }
      : null;

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      {itemList && <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(itemList)} />}
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>

      <form method="get" aria-label={t('filters.label')} className="mt-6 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block text-sm font-semibold">
          {t('filters.region')}
          <select name="region" defaultValue={region ?? ''} className={`${inputClass} mt-1`}>
            <option value="">{t('filters.anyRegion')}</option>
            {(['CZ', 'SK'] as const).map((country) => (
              <optgroup key={country} label={countries.of(country)}>
                {LISTING_REGIONS.filter((r) => r.startsWith(country)).map((r) => (
                  <option key={r} value={r}>
                    {t(`regions.${r}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          {t('filters.service')}
          <select name="service" defaultValue={service ?? ''} className={`${inputClass} mt-1`}>
            <option value="">{t('filters.anyService')}</option>
            {LISTING_SERVICES.map((s) => (
              <option key={s} value={s}>
                {t(`services.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass.primary}>
            {t('filters.apply')}
          </button>
          {filtered && (
            <Link href="/accountants" className="text-sm font-semibold text-primary hover:underline">
              {t('filters.reset')}
            </Link>
          )}
        </div>
      </form>

      {listings.length > 0 && <p className="mt-6 text-sm text-muted-foreground">{t('count', { n: listings.length })}</p>}

      {listings.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {filtered ? t('empty') : t('emptyAll')}
        </p>
      ) : (
        <ul className="mt-3 grid gap-4 sm:grid-cols-2">
          {listings.map((a) => (
            <AccountantCard key={a.id} a={a} locale={locale} subject={subject} />
          ))}
        </ul>
      )}

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold tracking-tight">{t('howTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('howBody')}</p>
        </div>
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <h2 className="text-lg font-bold tracking-tight">{t('joinTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('joinBody')}</p>
          <Link href="/for-accountants" className={`${buttonClass.primary} mt-4`}>
            {t('joinCta')}
          </Link>
        </div>
      </div>
    </section>
  );
}

async function AccountantCard({ a, locale, subject }: { a: PublicAccountant; locale: string; subject: string }) {
  const t = await getTranslations('accountantDirectory');
  const names = new Intl.DisplayNames([locale], { type: 'language' });
  const languageName = (code: string) => names.of(code) ?? code;
  const row = 'flex items-start gap-2 text-sm';
  const icon = 'mt-0.5 h-4 w-4 shrink-0 text-primary';
  const places = [...a.regions.map((r) => t(`regions.${r}`)), ...(a.remote ? [t('remote')] : [])];
  return (
    <li className="flex flex-col rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-bold">{a.name}</h2>
      {a.bio && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{a.bio}</p>}
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {a.services.map((s) => (
          <li key={s} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            {t(`services.${s}`)}
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-2">
        {places.length > 0 && (
          <p className={row}>
            <MapPin className={icon} aria-hidden="true" />
            <span>{places.join(', ')}</span>
          </p>
        )}
        {a.languages.length > 0 && (
          <p className={row}>
            <Languages className={icon} aria-label={t('languages')} />
            <span>{a.languages.map(languageName).join(', ')}</span>
          </p>
        )}
        {a.priceHint && (
          <p className={row}>
            <Wallet className={icon} aria-label={t('price')} />
            <span>{a.priceHint}</span>
          </p>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        {a.contactEmail && (
          <a href={`mailto:${a.contactEmail}?subject=${subject}`} className={buttonClass.primary}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            {t('contact')}
          </a>
        )}
        {a.website && (
          <a href={href(a.website)} target="_blank" rel="nofollow ugc noopener" className={buttonClass.secondary}>
            <Globe className="h-4 w-4" aria-hidden="true" />
            {t('website')}
          </a>
        )}
        {a.profileSlug && (
          <a href={profileUrl(a.profileSlug, locale)} className={buttonClass.secondary}>
            <Building2 className="h-4 w-4" aria-hidden="true" />
            {t('profile')}
          </a>
        )}
      </div>
    </li>
  );
}
