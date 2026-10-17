import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CzOnlyNotice, HowList, RelatedTools, SignupCta, ToolDisclaimer, ToolHeader } from '@/components/public-tools/parts';
import { ToolTabs } from '@/components/public-tools/tool-tabs';
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
  after
}: {
  slug: string;
  locale: string;
  /** "Částky platí pro rok 2026." or similar, shown in the disclaimer. */
  validity?: string;
  children: React.ReactNode;
  /** Extra sections below the widget (conditions, tables). */
  after?: React.ReactNode;
}) {
  const c = getCalculator(slug)!;
  const t = await getTranslations('tools');
  const k = `calculators.items.${c.key}` as const;
  if (!isPublishedIn(c, locale)) return <CzOnlyNotice name={t(`${k}.name`)} path={`/calculators/${slug}`} />;

  const how = t.has(`${k}.how`) ? (t.raw(`${k}.how`) as string[]) : [];
  const path = `/calculators/${slug}`;
  return (
    <section className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(webPageLd(locale, path, 'WebPage', t(`${k}.title`), t(`${k}.description`)))} />
      <ToolTabs kind="calculators" current={slug} />
      <ToolHeader hubHref="/calculators" hubLabel={t('menu.calculators')} name={t(`${k}.name`)} title={t(`${k}.title`)} lead={t(`${k}.lead`)} icon={c.icon} />
      <div className="mt-10">{children}</div>
      <div className="mt-6">
        <ToolDisclaimer validity={validity} />
      </div>
      {after && <div className="mt-12 space-y-10">{after}</div>}
      {how.length > 0 && (
        <div className="mt-12 max-w-3xl">
          <HowList title={t('common.howTitle')} items={how} />
        </div>
      )}
      <div className="mt-12">
        <SignupCta />
      </div>
      <div className="mt-12">
        <RelatedTools current={slug} />
      </div>
    </section>
  );
}
