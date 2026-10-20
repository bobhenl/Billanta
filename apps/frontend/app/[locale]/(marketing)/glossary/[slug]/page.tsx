import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { ArrowRight, ExternalLink, Scale } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { lawUrl } from '@faktur/cz-compliance';
import { Link } from '@/i18n/navigation';
import { glossaryLinker } from '@/components/glossary-linker';
import { SignupCta } from '@/components/public-tools/parts';
import { GLOSSARY, getGlossaryTerm, glossaryLocales, localeMarket, type GlossaryTerm, type GlossaryTool } from '@/lib/glossary';
import { glossaryText } from '@/lib/glossary-content';
import { getFeaturePage } from '@/lib/feature-pages';
import { getCalculator, getGuide, isPublishedIn } from '@/lib/public-tools';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * One glossary term (see lib/glossary.ts): the quotable definition first,
 * then explanation, example, law, related terms and tools. A Czech-only
 * term on the sk URL (and a Slovak-only one on cs) has no text in that
 * language and shows a pointer to the original instead (noindex,follow).
 */
type Params = { locale: string; slug: string };

export function generateStaticParams() {
  return GLOSSARY.map((term) => ({ slug: term.slug }));
}

export const dynamicParams = false;

/** The language a one-country term is written in. */
function originalLocale(term: GlossaryTerm): string {
  return term.market === 'sk' ? 'sk' : 'cs';
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const term = getGlossaryTerm(slug);
  if (!term) return {};
  const t = await getTranslations({ locale, namespace: 'glossaryPages' });
  const text = glossaryText(locale, slug) ?? glossaryText(originalLocale(term), slug);
  if (!text) return {};
  const title = t('metaTitle', { term: text.term });
  const locales = glossaryLocales(term);
  if (!locales.includes(locale)) return { title, description: text.definition, robots: { index: false, follow: true } };
  return publicPageMetadata({ locale, path: `/glossary/${slug}`, title, description: text.definition, locales });
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-10">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

/** "§21/8 ZDPH" → its parts, for a readable label next to the link. */
function parseRef(ref: string): { p: string; o?: string; law: string } | null {
  const m = /^§\s*(\d+[a-z]?)(?:\/(\d+))?[a-z]?\s+(\S+)$/.exec(ref.trim());
  return m ? { p: m[1]!, o: m[2], law: m[3]! } : null;
}

export default async function GlossaryTermPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const term = getGlossaryTerm(slug);
  if (!term) notFound();

  const t = await getTranslations('glossaryPages');
  const text = glossaryText(locale, slug);
  if (!text) return <OtherMarketNotice term={term} locale={locale} />;

  const tTools = await getTranslations('tools');
  const tFeatures = await getTranslations('featurePages');
  const path = `/glossary/${slug}`;
  const url = `${SITE_URL}/${locale}${path}`;
  const market = localeMarket(locale);
  const link = glossaryLinker(locale, slug);

  const refs = market === 'cz' ? (term.laws.cz ?? []) : market === 'sk' ? (term.laws.sk ?? []) : [...(term.laws.cz ?? []), ...(term.laws.sk ?? [])];
  const laws = refs.flatMap((ref) => {
    const href = lawUrl(ref);
    const parts = parseRef(ref);
    if (!href || !parts) return [];
    const label = parts.o ? t('lawRefOdst', { p: parts.p, o: parts.o }) : t('lawRef', { p: parts.p });
    return [{ ref, href, label, law: t(`laws.${parts.law}`) }];
  });

  const related = term.related.flatMap((r) => {
    const other = glossaryText(locale, r);
    return other ? [{ slug: r, name: other.term }] : [];
  });

  const tools = term.tools.flatMap((tool: GlossaryTool): { href: string; label: string }[] => {
    if (tool.kind === 'page') return [{ href: tool.href, label: t(`tools.${tool.labelKey}`) }];
    if (tool.kind === 'calculator') {
      const c = getCalculator(tool.slug);
      return c && isPublishedIn(c, locale) ? [{ href: `/calculators/${c.slug}`, label: tTools(`calculators.items.${c.key}.name`) }] : [];
    }
    if (tool.kind === 'guide') {
      const g = getGuide(tool.slug);
      return g && isPublishedIn(g, locale) ? [{ href: `/guides/${g.slug}`, label: tTools(`guides.items.${g.key}.name`) }] : [];
    }
    const f = getFeaturePage(tool.slug);
    return f ? [{ href: `/features/${f.slug}`, label: tFeatures(`items.${f.key}.name`) }] : [];
  });

  const structuredData = [
    breadcrumbLd(locale, [
      [SITE_NAME, '/'],
      [t('breadcrumb'), '/glossary'],
      [text.term, path]
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'DefinedTerm',
      '@id': url,
      name: text.term,
      ...(text.aka ? { alternateName: text.aka } : {}),
      description: text.definition,
      url,
      inLanguage: locale,
      inDefinedTermSet: { '@type': 'DefinedTermSet', '@id': `${SITE_URL}/${locale}/glossary`, name: t('indexTitle'), url: `${SITE_URL}/${locale}/glossary` }
    }
  ];

  return (
    <article className="container max-w-3xl py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/glossary" className="hover:text-foreground">
          {t('breadcrumb')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{text.term}</span>
      </nav>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{text.term}</h1>
      {text.aka ? <p className="mt-2 text-sm text-muted-foreground">{text.aka}</p> : null}
      {term.market !== 'both' ? (
        <p className="mt-3 inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
          {term.market === 'cz' ? t('marketCz') : t('marketSk')}
        </p>
      ) : null}

      <p className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-5 text-base leading-relaxed sm:text-lg">{text.definition}</p>

      {term.market !== 'both' && locale === 'en' ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {term.market === 'cz' ? t('onlyCz') : t('onlySk')}{' '}
          <Link href={path} locale={originalLocale(term)} className="font-medium text-primary hover:underline">
            {t('readOriginal')}
          </Link>
        </p>
      ) : null}

      <Section title={t('explanation')}>
        {text.explanation.map((p, i) => (
          <p key={i}>{link(p)}</p>
        ))}
      </Section>

      <Section title={t('example')}>
        <p className="rounded-xl border border-border bg-card p-4">{link(text.example)}</p>
      </Section>

      {laws.length > 0 ? (
        <Section title={t('law')}>
          <ul className="space-y-2">
            {laws.map((l) => (
              <li key={l.ref} className="flex gap-2">
                <Scale className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  <a href={l.href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                    {l.label}
                    <ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" />
                  </a>{' '}
                  <span className="text-muted-foreground">– {l.law}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {related.length > 0 ? (
        <Section title={t('related')}>
          <ul className="flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={`/glossary/${r.slug}`} className="inline-flex rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-primary/40 hover:text-primary">
                  {r.name}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {tools.length > 0 ? (
        <Section title={t('tools.heading')}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {tools.map((tool) => (
              <li key={tool.href}>
                <Link href={tool.href} className="group flex h-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 font-medium transition-colors hover:border-primary/40">
                  <span className="group-hover:text-primary">{tool.label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="mt-10 text-xs text-muted-foreground">{t('disclaimer')}</p>
      <p className="mt-4 text-sm">
        <Link href="/glossary" className="font-medium text-primary hover:underline">
          ← {t('allTerms')}
        </Link>
      </p>
      <div className="mt-10">
        <SignupCta />
      </div>
    </article>
  );
}

/** cs URL of a Slovak-only term or sk URL of a Czech-only one: where to read it instead. */
async function OtherMarketNotice({ term, locale }: { term: GlossaryTerm; locale: string }) {
  const t = await getTranslations('glossaryPages');
  const original = originalLocale(term);
  const name = glossaryText(original, term.slug)?.term ?? term.slug;
  const counterpart = term.counterpart ? glossaryText(locale, term.counterpart) : undefined;
  const path = `/glossary/${term.slug}`;
  return (
    <section className="container max-w-3xl py-12 sm:py-16">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/glossary" className="hover:text-foreground">
          {t('breadcrumb')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{name}</span>
      </nav>
      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('otherTitle')}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{t('otherText', { term: name })}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={path} locale={original} className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
            {t('otherOriginal')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href={path} locale="en" className="inline-flex items-center rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:border-primary/40">
            {t('otherEnglish')}
          </Link>
        </div>
        {counterpart && term.counterpart ? (
          <p className="mt-5 text-sm">
            <Link href={`/glossary/${term.counterpart}`} className="font-medium text-primary hover:underline">
              {t('otherCounterpart', { term: counterpart.term })} →
            </Link>
          </p>
        ) : null}
      </div>
      <p className="mt-6 text-sm">
        <Link href="/glossary" className="font-medium text-primary hover:underline">
          ← {t('allTerms')}
        </Link>
      </p>
    </section>
  );
}
