import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { VAT_FORM_VERSIONS, VAT_INFO_CHECKED, VAT_OFFICIAL_URL } from '@faktur/cz-compliance';
import { CzOnlyNotice, GuideSources, RelatedTools, SignupCta, ToolHeader } from '@/components/public-tools/parts';
import { ToolTabs } from '@/components/public-tools/tool-tabs';
import { checkedDate } from '@/lib/legislation-checked';
import { getGuide, isPublishedIn } from '@/lib/public-tools';
import { guideArticleLd, toolPageMetadata } from '@/lib/public-tool-meta';
import { jsonLd } from '@/lib/seo';

export function guideMetadata(slug: string, locale: string): Promise<Metadata> {
  const g = getGuide(slug)!;
  return toolPageMetadata({
    locale,
    path: `/guides/${slug}`,
    tool: g,
    titleKey: `tools.guides.items.${g.key}.title`,
    descriptionKey: `tools.guides.items.${g.key}.description`
  });
}

/**
 * A guide about other rules than Czech VAT (the Slovak e-invoicing one)
 * passes its own `sources`: the date its facts were checked, the official
 * page and the wording of the sources box. Without it the Czech VAT
 * defaults apply.
 */
export interface GuideSourcesOverride {
  checked: string;
  officialUrl: string;
  officialLabel: string;
  disclaimer: string;
}

/**
 * Shell of one guide: header with an "updated" date, the body, and the
 * sources box (last checked, form versions, link to Finanční správa).
 *
 * Structured data is an Article whose dateModified is the same
 * VAT_INFO_CHECKED the page prints (not HowTo, deprecated since 2023), so
 * the markup claims nothing the page does not show. The sources box shows
 * the separate "last checked" date, which the weekly legislation monitor
 * moves forward without the text changing, so it stays out of the markup.
 * No BreadcrumbList: the
 * visible trail has two rungs (see ToolHeader).
 */
export async function GuidePage({
  slug,
  locale,
  sources,
  children
}: {
  slug: string;
  locale: string;
  sources?: GuideSourcesOverride;
  children: React.ReactNode;
}) {
  const g = getGuide(slug)!;
  const t = await getTranslations('tools');
  const format = await getFormatter();
  const k = `guides.items.${g.key}` as const;
  if (!isPublishedIn(g, locale)) return <CzOnlyNotice name={t(`${k}.name`)} path={`/guides/${slug}`} />;

  const path = `/guides/${slug}`;
  const updatedOn = sources?.checked ?? VAT_INFO_CHECKED;
  const updated = format.dateTime(new Date(`${updatedOn}T12:00:00Z`), { dateStyle: 'long', timeZone: 'Europe/Prague' });
  const checked = sources?.checked ?? (await checkedDate('vat_forms'));
  const forms = sources
    ? undefined
    : t('guides.items.vatFiling.formsLine', { dp3: VAT_FORM_VERSIONS.DPHDP3, kh1: VAT_FORM_VERSIONS.DPHKH1, shv: VAT_FORM_VERSIONS.DPHSHV });
  return (
    <article className="container py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(guideArticleLd(locale, path, t(`${k}.title`), t(`${k}.description`), updatedOn))}
      />
      <ToolTabs kind="guides" current={slug} />
      <ToolHeader hubHref="/guides" hubLabel={t('menu.guides')} name={t(`${k}.name`)} title={t(`${k}.title`)} lead={t(`${k}.lead`)} icon={g.icon} />
      <p className="mt-3 text-sm text-muted-foreground">
        {t('common.updated')}: <time dateTime={updatedOn}>{updated}</time>
      </p>
      <div className="mt-10 max-w-3xl space-y-10">{children}</div>
      <div className="mt-12 max-w-3xl">
        <GuideSources
          checked={checked}
          officialUrl={sources?.officialUrl ?? VAT_OFFICIAL_URL}
          extra={forms}
          officialLabel={sources?.officialLabel}
          disclaimer={sources?.disclaimer}
        />
      </div>
      <div className="mt-12">
        <SignupCta />
      </div>
      <div className="mt-12">
        <RelatedTools current={slug} />
      </div>
    </article>
  );
}

export function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}
