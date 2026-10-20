import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NewsletterSignup } from '@/components/newsletter-signup';
import { CzOnlyNotice, HowList, InvoiceCta, RelatedTools, SignupCta, ToolDisclaimer, ToolHeader, ToolNote } from '@/components/public-tools/parts';
import { ToolTabs } from '@/components/public-tools/tool-tabs';
import { glossaryLinker } from '@/components/glossary-linker';
import { getCalculator, isPublishedIn } from '@/lib/public-tools';
import { toolPageMetadata } from '@/lib/public-tool-meta';
import { jsonLd, webPageLd } from '@/lib/seo';

/** Metadata for /calculators/<slug> (noindex,follow where it is not published). */
export function calculatorMetadata(slug: string, locale: string): Promise<Metadata> {
  const c = getCalculator(slug)!;
  return toolPageMetadata({
    locale,
    path: `/calculators/${slug}`,
    tool: c,
    titleKey: `tools.calculators.items.${c.key}.title`,
    descriptionKey: `tools.calculators.items.${c.key}.description`
  });
}

/**
 * Shell of one calculator page: header, the interactive widget, the
 * disclaimer with the year the constants apply to, "how it is calculated",
 * the sign-up CTA and related links. Structured data is a plain WebPage
 * (a calculator is a tool, there is no richer type that fits); no
 * BreadcrumbList because the visible trail has two rungs (see ToolHeader).
 */
export async function CalculatorPage({
  slug,
  locale,
  validity,
  children,
  after,
  disclaimer = true,
  cta = 'signup',
  ctaFirst = false,
  ctaTemplates = false,
  skAlternative
}: {
  slug: string;
  locale: string;
  /** "Částky platí pro rok 2026." or similar, shown in the disclaimer. */
  validity?: string;
  children: React.ReactNode;
  /** Extra sections below the widget (conditions, tables). */
  after?: React.ReactNode;
  /** The tax "orientační výpočet" box; off for tools that compute nothing tax-related (QR, IBAN, due date), which get the one-line ToolNote instead. */
  disclaimer?: boolean | string;
  /** Invoice tools lead to the guest invoice, which needs no account. */
  cta?: 'signup' | 'invoice';
  /** CTA straight under the widget instead of at the end, for checkers whose result is the moment to act. */
  ctaFirst?: boolean;
  /** Offer the invoice templates next to the guest invoice. */
  ctaTemplates?: boolean;
  /** Slug of the same calculator under Slovak rules, linked from the sk notice. */
  skAlternative?: string;
}) {
  const c = getCalculator(slug)!;
  const t = await getTranslations('tools');
  const k = `calculators.items.${c.key}` as const;
  if (!isPublishedIn(c, locale)) {
    const alt = skAlternative ? getCalculator(skAlternative) : undefined;
    return (
      <CzOnlyNotice
        name={t(`${k}.name`)}
        path={`/calculators/${slug}`}
        skAlternative={alt && { href: `/calculators/${alt.slug}`, name: t(`calculators.items.${alt.key}.name`) }}
      />
    );
  }

  const how = t.has(`${k}.how`) ? (t.raw(`${k}.how`) as string[]) : [];
  const path = `/calculators/${slug}`;
  // Glossary terms are linked where they first appear: lead, then the "how" list.
  const link = glossaryLinker(locale);
  const ctaTitle = t.has(`${k}.ctaTitle`) ? t(`${k}.ctaTitle`) : undefined;
  const ctaText = t.has(`${k}.ctaText`) ? t(`${k}.ctaText`) : undefined;
  const ctaBox =
    cta === 'invoice' ? <InvoiceCta title={ctaTitle} text={ctaText} templates={ctaTemplates} /> : <SignupCta title={ctaTitle} text={ctaText} />;
  return (
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(webPageLd(locale, path, 'WebPage', t(`${k}.title`), t(`${k}.description`)))} />
      <ToolTabs kind="calculators" current={slug} />
      <ToolHeader hubHref="/calculators" hubLabel={t('menu.calculators')} name={t(`${k}.name`)} title={t(`${k}.title`)} lead={link(t(`${k}.lead`))} icon={c.icon} />
      <div className="mt-10">{children}</div>
      {ctaFirst && <div className="mt-8">{ctaBox}</div>}
      <div className="mt-6">
        {disclaimer ? <ToolDisclaimer validity={validity} text={typeof disclaimer === 'string' ? disclaimer : undefined} /> : <ToolNote />}
      </div>
      {after && <div className="mt-12 space-y-10">{after}</div>}
      {how.length > 0 && (
        <div className="mt-12 max-w-3xl">
          <HowList title={t.has(`${k}.howTitle`) ? t(`${k}.howTitle`) : t('common.howTitle')} items={how} link={link} />
        </div>
      )}
      {!ctaFirst && <div className="mt-12">{ctaBox}</div>}
      <div className="mt-12 max-w-3xl">
        <NewsletterSignup source="calculators" />
      </div>
      <div className="mt-12">
        <RelatedTools current={slug} />
      </div>
    </section>
  );
}
