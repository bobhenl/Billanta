import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { brandName, getComparedBrand } from '@/lib/competitors';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { isSwitchBrand, SWITCH_BRANDS, switchBrandsFor } from '@/lib/switch';
import { SwitchCta } from '../switch-cta';

/**
 * Leaving one app for Billanta: how to get the export out (in our words and
 * kept general, since menus change), what comes over, and a signup link
 * that remembers the app so the welcome screen opens its import.
 */
type Params = { locale: string; slug: string };
type Faq = { q: string; a: string };

export function generateStaticParams() {
  return SWITCH_BRANDS.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isSwitchBrand(slug)) return {};
  const t = await getTranslations({ locale, namespace: 'switchPage' });
  return publicPageMetadata({ locale, path: `/switch/${slug}`, title: t(`brands.${slug}.seoTitle`), description: t(`brands.${slug}.lead`) });
}

export default async function SwitchBrandPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  if (!isSwitchBrand(slug)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('switchPage');
  const k = `brands.${slug}` as const;
  const name = brandName(slug, locale);
  const path = `/switch/${slug}`;
  const title = t(`${k}.title`);
  const steps = t.raw(`${k}.steps`) as string[];
  const transfers = [...(t.raw('transfers') as string[]), t(`${k}.extra`)];
  const faq = t.raw('faq') as Faq[];
  // The /compare page exists only in the locales of the brand's market.
  const compared = getComparedBrand(locale, slug);

  return (
    <section className="container py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, path, 'WebPage', title, t(`${k}.lead`)),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('navTitle'), '/switch'],
            [name, path]
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: title,
            step: steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text }))
          },
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
          }
        ])}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/switch" className="hover:text-foreground">
          {t('navTitle')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{name}</span>
      </nav>

      <div className="mt-4 max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-muted-foreground">{t(`${k}.lead`)}</p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-bold">{t('exportTitle')}</h2>
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
          <p className="mt-4 text-xs text-muted-foreground">{t('note')}</p>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h2 className="font-bold">{t('transfersTitle')}</h2>
          <ul className="mt-4 space-y-2">
            {transfers.map((s) => (
              <li key={s} className="flex gap-2 text-sm leading-relaxed">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <SwitchCta brand={slug} className="mt-8" />
      {compared && (
        <p className="mt-4 text-sm">
          <Link href={`/compare/${slug}`} className="font-semibold text-primary hover:underline">
            {t('compareLink', { brand: name })} →
          </Link>
        </p>
      )}

      <div className="mt-14 max-w-3xl border-t border-border pt-8">
        <h2 className="text-xl font-semibold">{t('faqTitle')}</h2>
        <dl className="mt-4 divide-y divide-border">
          {faq.map(({ q, a }) => (
            <div key={q} className="py-4">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </div>

      <nav aria-label={t('othersTitle')} className="mt-12 border-t border-border pt-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('othersTitle')}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {switchBrandsFor(locale)
            .filter((b) => b.key !== slug)
            .map((b) => (
              <li key={b.key}>
                <Link
                  href={`/switch/${b.key}`}
                  className="inline-flex rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary"
                >
                  {b.name}
                </Link>
              </li>
            ))}
        </ul>
      </nav>
    </section>
  );
}
