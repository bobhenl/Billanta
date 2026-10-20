import { Building2, Globe, Mail, MapPin, MessageSquare, Phone, Send, ShoppingCart } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { getPublicProfile, type PublicProfile } from '@/lib/public-profiles';
import { jsonLd, ogImage } from '@/lib/seo';
import { isDirectoryTrade } from '@/lib/business-presets';
import { getMunicipalityBySlug } from '@/lib/municipalities';
import { profileUrl, SITE_NAME, SITE_URL } from '@/lib/site';
import { ProfileMessageForm } from './profile-message-form';
import { ProfileOrderForm } from './profile-order-form';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

// Rendered on the first visit, then served from the ISR cache like the
// other public pages. The owner's edits show within a minute, the same
// window as getPublicProfile's fetch cache. No profile is known at build
// time; the empty list is what makes Next cache on-demand renders instead
// of treating the route as dynamic. The `?service=` / `?ask=` preselection
// is read by the forms on the client, because reading searchParams here
// would make every visit a fresh server render.
export const revalidate = 60;
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, locale } = await params;
  const profile = await getPublicProfile(slug.toLowerCase()).catch(() => null);
  if (!profile) return { title: SITE_NAME, robots: { index: false, follow: false } };
  const description = profile.tagline ?? profile.about?.slice(0, 160) ?? profile.companyName;
  const url = profileUrl(profile.slug, locale);
  // The drawn card (name, logo, services count) rather than the bare logo:
  // chat apps crop a square logo into a wide preview badly.
  const image = ogImage(locale, `/p/${profile.slug}`, profile.companyName);
  return {
    title: { absolute: profile.companyName },
    description,
    alternates: { canonical: url },
    openGraph: { title: profile.companyName, description, url, siteName: SITE_NAME, locale, type: 'profile', images: [image] },
    twitter: { card: 'summary_large_image', title: profile.companyName, description, images: [image.url] }
  };
}

const href = (website: string) => (/^https?:\/\//i.test(website) ? website : `https://${website}`);

function organizationLd(p: PublicProfile, url: string) {
  return {
    '@context': 'https://schema.org',
    // A company listed in the business directory with an address is a local business; anything else stays an Organization.
    '@type': p.directory && p.address ? 'LocalBusiness' : 'Organization',
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
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const profile = await getPublicProfile(slug.toLowerCase());
  if (!profile) notFound();

  const t = await getTranslations('publicProfile');
  const tDir = await getTranslations('businessDirectory');
  const directoryTrade = isDirectoryTrade(profile.directory?.trade) ? profile.directory.trade : null;
  const directoryTown = profile.directory ? getMunicipalityBySlug(profile.directory.town) : undefined;
  const country = profile.address?.country ? new Intl.DisplayNames([locale], { type: 'region' }).of(profile.address.country) : null;
  const address = profile.address
    ? [profile.address.street, [profile.address.postalCode, profile.address.city].filter(Boolean).join(' '), profile.address.country !== 'CZ' ? country : null]
        .filter(Boolean)
        .join(', ')
    : null;
  const mailto = profile.email
    ? `mailto:${profile.email}?subject=${encodeURIComponent(t('cta.subject', { company: profile.companyName }))}&body=${encodeURIComponent(t('cta.body'))}`
    : null;
  const orderable = profile.orders?.enabled ? profile.services.flatMap((s) => (s.id ? [{ id: s.id, title: s.title, unitPrice: s.unitPrice, unit: s.unit }] : [])) : [];
  const askable = profile.contactForm ? profile.services.flatMap((s) => (s.id ? [{ id: s.id, title: s.title }] : [])) : [];
  const row = 'flex items-start gap-3 text-sm';
  const pill = 'inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-semibold hover:bg-muted';
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
            {profile.contactForm ? (
              <a href="#contact" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                <MessageSquare className="h-4 w-4" />
                {t('message.button')}
              </a>
            ) : profile.contactCta && mailto && (
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
                  {s.id && (orderable.length > 0 || askable.length > 0) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {orderable.length > 0 && (
                        <a href={`?service=${s.id}#order`} className={`${pill} border-primary bg-primary text-primary-foreground hover:bg-primary/90`}>
                          <ShoppingCart className="h-3.5 w-3.5" />
                          {t('order.button')}
                        </a>
                      )}
                      {askable.length > 0 && (
                        <a href={`?ask=${s.id}#contact`} className={pill}>
                          <MessageSquare className="h-3.5 w-3.5" />
                          {t('message.button')}
                        </a>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {orderable.length > 0 && (
          <section id="order" className="mt-6 scroll-mt-6">
            <ProfileOrderForm
              slug={profile.slug}
              companyName={profile.companyName}
              services={orderable}
              customItemsAllowed={Boolean(profile.orders?.customItems)}
              currency={profile.orders?.currency ?? 'CZK'}
            />
          </section>
        )}

        {profile.contactForm && (
          <section id="contact" className="mt-6 scroll-mt-6">
            <ProfileMessageForm slug={profile.slug} companyName={profile.companyName} services={askable} />
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

        {directoryTown && directoryTrade && (
          // Absolute links: on a profile subdomain (PROFILE_DOMAIN) the directory lives on the main site.
          <nav aria-label={tDir('title')} className="mt-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{tDir('profileListed')}</span>
            <a href={`${SITE_URL}/${locale}/directory/${directoryTrade}`} className="rounded-full border border-border bg-card px-3 py-1 hover:border-primary hover:text-primary">
              {tDir(`trades.${directoryTrade}`)}
            </a>
            <a href={`${SITE_URL}/${locale}/directory/town/${directoryTown.slug}`} className="rounded-full border border-border bg-card px-3 py-1 hover:border-primary hover:text-primary">
              {directoryTown.name}
            </a>
          </nav>
        )}

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
