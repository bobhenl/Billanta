import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClosingCta } from '@/components/audience-page';
import { ChipRow, chipClass } from '@/components/chip-row';
import { Link } from '@/i18n/navigation';
import { brandsFor, comparedAtLabel, rowsFor } from '@/lib/competitors';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'comparePage' });
  return publicPageMetadata({ locale, path: '/compare', title: t('seoTitle'), description: t('lead') });
}

/**
 * Billanta vs. the usual CZ/SK invoicing apps: one table of the things
 * people compare before switching (free plan limits, entry price, bank
 * matching, AI, API), the differences in plain words, and a link to
 * the import wizard. Data in lib/competitors.ts, wording in `comparePage.*`.
 */
export default async function ComparePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('comparePage');
  const comparedAt = comparedAtLabel(locale);
  const reasons = t.raw('reasons') as { title: string; body: string }[];
  const BRANDS = brandsFor(locale);
  const COMPARED_BRANDS = BRANDS.filter((b) => b.key !== 'billanta');
  const COMPETITOR_ROWS = rowsFor(locale);

  return (
    <section className="container py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, '/compare', 'WebPage', t('title'), t('lead')),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/compare']
          ])
        ])}
      />
      <div className="max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="mt-3 text-muted-foreground sm:text-lg">{t('lead')}</p>
      </div>
      {/* One swipe line on a phone, so the table starts right under the lead. */}
      <ChipRow label={t('brand.othersTitle')} className="mt-5">
        {COMPARED_BRANDS.map((b) => (
          <li key={b.key} className="shrink-0">
            <Link href={`/compare/${b.key}`} className={chipClass}>
              {t('brand.versus', { brand: b.name })}
            </Link>
          </li>
        ))}
      </ChipRow>

      {/* Phones: one card per feature instead of a table that scrolls sideways. */}
      <div className="mt-8 space-y-3 sm:hidden">
        {COMPETITOR_ROWS.map((row) => (
          <div key={row.key} className="rounded-xl border border-border bg-card p-3">
            <h2 className="text-sm font-bold">{t(`rows.${row.key}.label`)}</h2>
            <dl className="mt-2 space-y-1 text-[13px]">
              {BRANDS.map((b) => {
                const good = row.good.includes(b.key);
                return (
                  <div key={b.key} className={`flex justify-between gap-3 rounded px-1.5 py-0.5 ${b.key === 'billanta' ? 'bg-primary/5' : ''}`}>
                    <dt className={b.key === 'billanta' ? 'font-bold text-primary' : 'text-muted-foreground'}>{b.name}</dt>
                    <dd className={`flex items-center gap-1 text-right ${good ? 'font-medium' : 'text-muted-foreground'}`}>
                      {good && <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />}
                      {t(`rows.${row.key}.${b.key}`)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>

      <div className="mt-8 hidden overflow-x-auto rounded-xl border border-border bg-card sm:block">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="w-40 px-3 py-2.5 text-left font-semibold text-muted-foreground">
                {t('feature')}
              </th>
              {BRANDS.map((b) => (
                <th
                  key={b.key}
                  scope="col"
                  className={`px-3 py-2.5 text-left font-bold ${b.key === 'billanta' ? 'bg-primary/5 text-primary' : ''}`}
                >
                  {b.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPETITOR_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-border last:border-0 align-top">
                <th scope="row" className="px-3 py-2.5 text-left font-semibold">
                  {t(`rows.${row.key}.label`)}
                </th>
                {BRANDS.map((b) => {
                  const good = row.good.includes(b.key);
                  return (
                    <td key={b.key} className={`px-3 py-2.5 ${b.key === 'billanta' ? 'bg-primary/5' : ''} ${good ? '' : 'text-muted-foreground'}`}>
                      <span className="flex gap-1.5">
                        {good && <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
                        <span className={good ? 'font-medium text-foreground' : ''}>{t(`rows.${row.key}.${b.key}`)}</span>
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
        {t('notStated')}. {t('disclaimer', { date: comparedAt })}
      </p>

      <h2 className="mt-12 text-2xl font-extrabold tracking-tight">{t('reasonsTitle')}</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reasons.map((r) => (
          <div key={r.title} className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold">{r.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{r.body}</p>
          </div>
        ))}
      </div>

      <ClosingCta
        title={t('switchTitle')}
        body={t('switchBody')}
        primary={{ href: '/signup', label: t('signupCta') }}
        secondary={{ href: '/pricing', label: t('pricingCta') }}
      />
    </section>
  );
}
