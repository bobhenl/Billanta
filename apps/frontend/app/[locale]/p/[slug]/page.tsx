import { Building2, Globe, Mail, MapPin, Phone, Send } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { getPublicProfile, type PublicProfile } from '@/lib/public-profiles';
import { jsonLd } from '@/lib/seo';
import { profileUrl, SITE_NAME } from '@/lib/site';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, locale } = await params;
  const profile = await getPublicProfile(slug.toLowerCase()).catch(() => null);
  if (!profile) return { title: SITE_NAME, robots: { index: false, follow: false } };
  const description = profile.tagline ?? profile.about?.slice(0, 160) ?? profile.companyName;
  return {
    title: { absolute: profile.companyName },
    description,
    alternates: { canonical: profileUrl(profile.slug, locale) },
    openGraph: { title: profile.companyName, description, type: 'profile', ...(profile.hasLogo ? { images: [`/api/public/profiles/${profile.slug}/logo`] } : {}) }
  };
}

const href = (website: string) => (/^https?:\/\//i.test(website) ? website : `https://${website}`);

function organizationLd(p: PublicProfile, url: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: p.companyName,
    legalName: p.legalName,
    url,
    ...(p.tagline || p.about ? { description: p.tagline ?? p.about } : {}),
    ...(p.email ? { email: p.email } : {}),
    ...(p.phone ? { telephone: p.phone } : {}),
    ...(p.website ? { sameAs: [href(p.website)] } : {}),
    ...(p.ico ? { identifier: { '@type': 'PropertyValue', propertyID: 'IČO', value: p.ico } } : {}),
    ...(p.dic ? { vatID: p.dic } : {}),
    ...(p.address
      ? { address: { '@type': 'PostalAddress', streetAddress: p.address.street, addressLocality: p.address.city, postalCode: p.address.postalCode, addressCountry: p.address.country } }
      : {}),
    ...(p.services.length
      ? { makesOffer: p.services.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.title, ...(s.description ? { description: s.description } : {}) } })) }
      : {})
  };
}

/**
 * Public company profile — a business-card page at `/<locale>/p/<slug>`,
 * or `<slug>.<NEXT_PUBLIC_PROFILE_DOMAIN>` via middleware. Shows only what
 * the company published in Settings → Veřejný profil; 404 otherwise.
 */
export default async function PublicProfilePage({ params }: Props) {
  const { slug } = await params;
  const profile = await getPublicProfile(slug.toLowerCase());
  if (!profile) notFound();

  const t = await getTranslations('publicProfile');
  const locale = await getLocale();
  const country = profile.address?.country ? new Intl.DisplayNames([locale], { type: 'region' }).of(profile.address.country) : null;
  const address = profile.address
    ? [profile.address.street, [profile.address.postalCode, profile.address.city].filter(Boolean).join(' '), profile.address.country !== 'CZ' ? country : null]
        .filter(Boolean)
        .join(', ')
    : null;
  const mailto = profile.email
    ? `mailto:${profile.email}?subject=${encodeURIComponent(t('cta.subject', { company: profile.companyName }))}&body=${encodeURIComponent(t('cta.body'))}`
    : null;
  const row = 'flex items-start gap-3 text-sm';
  const icon = 'mt-0.5 h-4 w-4 shrink-0 text-primary';

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(organizationLd(profile, profileUrl(profile.slug, locale)))} />
      <div className="mx-auto max-w-3xl">
        <header className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            {profile.hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own proxy route, any size
              <img src={`/api/public/profiles/${profile.slug}/logo`} alt="" className="h-20 w-20 shrink-0 rounded-xl border border-border bg-white object-contain p-2" />
            ) : (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-3xl font-bold text-primary">
                {profile.companyName.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{profile.companyName}</h1>
              {profile.tagline && <p className="mt-1 text-muted-foreground">{profile.tagline}</p>}
            </div>
            {profile.contactCta && mailto && (
              <a href={mailto} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                <Send className="h-4 w-4" />
                {t('cta.button')}
              </a>
            )}
          </div>
          {profile.about && <p className="mt-6 whitespace-pre-line leading-relaxed">{profile.about}</p>}
        </header>

        {profile.services.length > 0 && (
          <section className="mt-6">
            <h2 className="px-1 text-lg font-bold">{t('services')}</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {profile.services.map((s, i) => (
                <li key={i} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">{s.title}</h3>
                    {s.price && <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{s.price}</span>}
                  </div>
                  {s.description && <p className="mt-1.5 text-sm text-muted-foreground">{s.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold">{t('contact')}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              {profile.email && (
                <p className={row}>
                  <Mail className={icon} />
                  <a href={`mailto:${profile.email}`} className="break-all hover:text-primary hover:underline">
                    {profile.email}
                  </a>
                </p>
              )}
              {profile.phone && (
                <p className={row}>
                  <Phone className={icon} />
                  <a href={`tel:${profile.phone.replace(/\s+/g, '')}`} className="hover:text-primary hover:underline">
                    {profile.phone}
                  </a>
                </p>
              )}
              {profile.website && (
                <p className={row}>
                  <Globe className={icon} />
                  <a href={href(profile.website)} target="_blank" rel="noopener nofollow" className="break-all hover:text-primary hover:underline">
                    {profile.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                  </a>
                </p>
              )}
              {address && (
                <p className={row}>
                  <MapPin className={icon} />
                  <span>{address}</span>
                </p>
              )}
            </div>
            {(profile.ico || profile.dic || profile.registryNote) && (
              <div className={row}>
                <Building2 className={icon} />
                <dl className="space-y-1">
                  <dt className="font-semibold">{profile.legalName}</dt>
                  {profile.ico && (
                    <dd>
                      {t('ico')}: <span className="tabular-nums">{profile.ico}</span>
                    </dd>
                  )}
                  {profile.dic && (
                    <dd>
                      {t('dic')}: <span className="tabular-nums">{profile.dic}</span>
                    </dd>
                  )}
                  {profile.registryNote && <dd className="text-xs text-muted-foreground">{profile.registryNote}</dd>}
                </dl>
              </div>
            )}
          </div>
        </section>

        <footer className="mt-8 text-center text-xs text-muted-foreground">
          {t.rich('poweredBy', {
            brand: (chunks) => (
              <Link href="/" className="font-semibold text-primary hover:underline">
                {chunks}
              </Link>
            )
          })}
        </footer>
      </div>
    </main>
  );
}
