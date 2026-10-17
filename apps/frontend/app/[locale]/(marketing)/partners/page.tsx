import type { Metadata } from 'next';
import { ArrowUpRight, Handshake } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { cn } from '@/lib/utils';
import { fetchPartners, partnerHref, PARTNER_CATEGORIES, type PartnerCategory } from '@/lib/partners';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'partners' });
  return publicPageMetadata({ locale, path: '/partners', title: t('seoTitle'), description: t('lead') });
}

/**
 * Partners directory (as on VoxelRank): accountants, banks and tools that
 * work well with Billanta. Every outbound link goes through the counting
 * redirect `/partners/go/:slug` and is marked `sponsored`. Categories filter
 * with `?category=` so each stays a plain, shareable link.
 */
export default async function PartnersPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  const { category: requested } = await searchParams;
  const t = await getTranslations('partners');
  const category = (PARTNER_CATEGORIES as readonly string[]).includes(requested ?? '') ? (requested as PartnerCategory) : undefined;
  const [partners, all] = await Promise.all([fetchPartners({ category }), category ? fetchPartners() : null]);
  const present = new Set((all ?? partners).map((p) => p.category));

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/partners']
          ])
        )}
      />
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>

      {present.size > 1 && (
        <nav aria-label={t('filterLabel')} className="mt-6 flex flex-wrap gap-2">
          {[undefined, ...PARTNER_CATEGORIES.filter((c) => present.has(c))].map((c) => (
            <Link
              key={c ?? 'all'}
              href={c ? { pathname: '/partners', query: { category: c } } : '/partners'}
              aria-current={c === category ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 text-sm font-semibold transition-colors',
                c === category ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary hover:text-primary'
              )}
            >
              {c ? t(`categories.${c}`) : t('categories.all')}
            </Link>
          ))}
        </nav>
      )}

      {partners.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {partners.map((p) => (
            <li key={p.slug}>
              <a
                href={partnerHref(locale, p.slug)}
                target="_blank"
                rel="sponsored noopener"
                className={cn(
                  'group flex h-full flex-col rounded-xl border bg-card p-5 transition-colors hover:border-primary hover:shadow-md',
                  p.featured ? 'border-primary/40' : 'border-border'
                )}
              >
                <span className="flex items-center gap-3">
                  {p.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- partner logos are external, arbitrary hosts
                    <img src={p.logoUrl} alt="" width={40} height={40} loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-contain" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Handshake className="h-5 w-5" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{t(`categories.${p.category}`)}</span>
                  </span>
                  {p.featured && (
                    <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{t('featured')}</span>
                  )}
                </span>
                {p.description && <span className="mt-3 block flex-1 text-sm text-muted-foreground">{p.description}</span>}
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  {t('visit')}
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-12 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight">{t('become.title')}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('become.body')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/for-accountants" className={buttonClass.primary}>
            {t('become.accountants')}
          </Link>
          <Link href="/signup" className={buttonClass.secondary}>
            {t('become.signup')}
          </Link>
        </div>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">{t('disclosure')}</p>
    </section>
  );
}
