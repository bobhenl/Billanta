import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SignupCta } from '@/components/public-tools/parts';
import { glossaryTermsFor, type GlossaryMarket } from '@/lib/glossary';
import { glossaryText } from '@/lib/glossary-content';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * Hub of the glossary (see lib/glossary.ts). cs lists the shared and the
 * Czech terms, sk the shared and the Slovak ones, en all of them. The list
 * is mirrored in DefinedTermSet markup.
 */
type Params = { locale: string };

const GROUPS: { market: GlossaryMarket; key: 'groupBoth' | 'groupCz' | 'groupSk' }[] = [
  { market: 'both', key: 'groupBoth' },
  { market: 'cz', key: 'groupCz' },
  { market: 'sk', key: 'groupSk' }
];

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'glossaryPages' });
  return publicPageMetadata({ locale, path: '/glossary', title: t('indexTitle'), description: t('indexDescription') });
}

export default async function GlossaryHub({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('glossaryPages');
  const terms = glossaryTermsFor(locale).flatMap((term) => {
    const text = glossaryText(locale, term.slug);
    return text ? [{ term, text }] : [];
  });
  const byName = (a: (typeof terms)[number], b: (typeof terms)[number]) => a.text.term.localeCompare(b.text.term, locale);
  const groups = GROUPS.map((g) => ({ ...g, items: terms.filter((x) => x.term.market === g.market).sort(byName) })).filter((g) => g.items.length > 0);
  const hubUrl = `${SITE_URL}/${locale}/glossary`;

  const structuredData = [
    breadcrumbLd(locale, [
      [SITE_NAME, '/'],
      [t('breadcrumb'), '/glossary']
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'DefinedTermSet',
      '@id': hubUrl,
      name: t('indexTitle'),
      description: t('indexDescription'),
      url: hubUrl,
      inLanguage: locale,
      hasDefinedTerm: terms.map(({ term, text }) => ({
        '@type': 'DefinedTerm',
        name: text.term,
        description: text.definition,
        url: `${hubUrl}/${term.slug}`
      }))
    }
  ];

  return (
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
      <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t('indexTitle')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t('indexLead')}</p>

      {groups.map((g) => (
        <div key={g.market} className="mt-10">
          {groups.length > 1 ? <h2 className="text-xl font-semibold">{t(g.key)}</h2> : null}
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map(({ term, text }) => (
              <li key={term.slug}>
                <Link
                  href={`/glossary/${term.slug}`}
                  className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  <span className="font-semibold group-hover:text-primary">{text.term}</span>
                  <span className="mt-1 line-clamp-3 text-sm text-muted-foreground">{text.definition}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="mt-12">
        <SignupCta />
      </div>
    </section>
  );
}
