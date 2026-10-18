import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowRight, Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { brandsFor, comparedAtLabel, comparedBrandsFor, comparedPages, getComparedBrand, rowsFor } from '@/lib/competitors';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

/**
 * Billanta next to one competitor. The table reuses the cells of the full
 * /compare table (`comparePage.rows`), so the two pages can't disagree; the
 * prose in `comparePage.brands.<key>` is ours and says plainly when the
 * other app is the better fit. Prices in the prose come from the same
 * cells, never retyped.
 */
type Params = { locale: string; slug: string };
type Faq = { q: string; a: string };

// A brand only has pages in the locales of its market (KROS and Billdu: Slovak only).
export function generateStaticParams({ params }: { params: { locale: string } }) {
  return comparedBrandsFor(params.locale).map((b) => ({ slug: b.key }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const brand = getComparedBrand(locale, slug);
  if (!brand) return {};
  const t = await getTranslations({ locale, namespace: 'comparePage' });
  return publicPageMetadata({
    locale,
    path: `/compare/${slug}`,
    locales: comparedPages().find((p) => p.key === brand.key)?.locales ?? routing.locales,
    title: t(`brands.${brand.key}.seoTitle`),
    description: t(`brands.${brand.key}.lead`)
  });
}

export default async function CompareBrandPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  const brand = getComparedBrand(locale, slug);
  if (!brand) notFound();

  const t = await getTranslations('comparePage');
  const k = `brands.${brand.key}` as const;
  const suitsUs = t.raw(`${k}.suitsUs`) as string[];
  const suitsThem = t.raw(`${k}.suitsThem`) as string[];
  const steps = t.raw(`${k}.switchSteps`) as string[];
  const faq = t.raw(`${k}.faq`) as Faq[];
  const comparedAt = comparedAtLabel(locale);
  // Every market's column list starts with Billanta.
  const billanta = brandsFor(locale)[0]!;
  const path = `/compare/${slug}`;
  const title = t(`${k}.title`);
  const cell = (row: string, b: string) => t(`rows.${row}.${b}`);

  return (
    <section className="container py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, path, 'WebPage', title, t(`${k}.lead`)),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/compare'],
            [brand.name, path]
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
          }
        ])}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/compare" className="hover:text-foreground">
          {t('title')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{brand.name}</span>
      </nav>

      <div className="mt-4 max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-muted-foreground">{t(`${k}.lead`)}</p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h2 className="font-bold">{t('brand.suitsUsTitle')}</h2>
          <ul className="mt-3 space-y-2">
            {suitsUs.map((s) => (
              <li key={s} className="flex gap-2 text-sm leading-relaxed">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-bold">{t('brand.suitsThemTitle', { brand: brand.name })}</h2>
          <ul className="mt-3 space-y-2">
            {suitsThem.map((s) => (
              <li key={s} className="flex gap-2 text-sm leading-relaxed">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <h2 className="mt-12 text-2xl font-extrabold tracking-tight">{t('brand.priceTitle')}</h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {(['free', 'entry'] as const).map((row) => (
          <div key={row} className="rounded-xl border border-border bg-card p-4">
            <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t(`rows.${row}.label`)}</dt>
            <dd className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <span>
                <span className="block text-xs font-semibold text-primary">{billanta.name}</span>
                {cell(row, billanta.key)}
              </span>
              <span>
                <span className="block text-xs font-semibold text-muted-foreground">{brand.name}</span>
                {cell(row, brand.key)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">{t(`${k}.price`)}</p>

      <h2 className="mt-12 text-2xl font-extrabold tracking-tight">{t('brand.tableTitle', { brand: brand.name })}</h2>
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full table-fixed border-collapse break-words text-[13px]">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="w-[30%] px-3 py-2.5 text-left font-semibold text-muted-foreground">
                {t('feature')}
              </th>
              <th scope="col" className="bg-primary/5 px-3 py-2.5 text-left font-bold text-primary">
                {billanta.name}
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-bold">
                {brand.name}
              </th>
            </tr>
          </thead>
          <tbody>
            {rowsFor(locale).map((row) => (
              <tr key={row.key} className="border-b border-border align-top last:border-0">
                <th scope="row" className="px-3 py-2.5 text-left font-semibold">
                  {t(`rows.${row.key}.label`)}
                </th>
                {[billanta, brand].map((b) => {
                  const good = row.good.includes(b.key);
                  return (
                    <td key={b.key} className={`px-3 py-2.5 ${b.key === 'billanta' ? 'bg-primary/5' : ''} ${good ? '' : 'text-muted-foreground'}`}>
                      <span className="flex gap-1.5">
                        {good && <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                        <span className={good ? 'font-medium text-foreground' : ''}>{cell(row.key, b.key)}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs font-semibold text-foreground">{t('verified', { date: comparedAt })}</p>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
        {t('notStated')}. {t('disclaimer', { date: comparedAt })}{' '}
        <a href={brand.pricingUrl ?? undefined} target="_blank" rel="noopener noreferrer nofollow" className="underline hover:text-foreground">
          {t('brand.source', { brand: brand.name })}
        </a>
      </p>

      <div className="mt-12 rounded-2xl border border-primary/20 bg-primary/5 p-6">
        <h2 className="text-lg font-bold">{t(`${k}.switchTitle`)}</h2>
        <ol className="mt-4 space-y-3">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-3 text-sm leading-relaxed">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/signup" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            {t('signupCta')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/features/switch-from-another-app"
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
          >
            {t('brand.importCta')}
          </Link>
        </div>
      </div>

      <div className="mt-14 max-w-3xl border-t border-border pt-8">
        <h2 className="text-xl font-semibold">{t('brand.faqTitle')}</h2>
        <dl className="mt-4 divide-y divide-border">
          {faq.map(({ q, a }) => (
            <div key={q} className="py-4">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </div>

      <nav aria-label={t('brand.othersTitle')} className="mt-12 border-t border-border pt-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('brand.othersTitle')}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {comparedBrandsFor(locale).filter((b) => b.key !== brand.key).map((b) => (
            <li key={b.key}>
              <Link
                href={`/compare/${b.key}`}
                className="inline-flex rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary"
              >
                {t('brand.versus', { brand: b.name })}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/compare" className="inline-flex px-4 py-2 text-sm font-medium text-primary hover:underline">
              {t('brand.all')} →
            </Link>
          </li>
        </ul>
      </nav>
    </section>
  );
}
