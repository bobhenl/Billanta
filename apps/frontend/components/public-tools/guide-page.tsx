import type { Metadata } from 'next';
import { Children, cloneElement, isValidElement, type ReactElement } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { VAT_FORM_VERSIONS, VAT_INFO_CHECKED, VAT_OFFICIAL_URL } from '@faktur/cz-compliance';
import { NewsletterSignup } from '@/components/newsletter-signup';
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
/** The SK e-invoicing guide signs readers up for the SK mandate updates, not the general topics. */
const SK_EINVOICING_GUIDE = 'e-invoicing-slovakia-2027';

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
  // Long guides get a short table of contents built from their own sections.
  const sections: { id: string; title: string }[] = [];
  const body = Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== GuideSection) return child;
    const el = child as ReactElement<GuideSectionProps>;
    const id = `s${sections.length + 1}`;
    sections.push({ id, title: el.props.title });
    return cloneElement(el, { id });
  });
  return (
    <article className="container py-6 sm:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(guideArticleLd(locale, path, t(`${k}.title`), t(`${k}.description`), updatedOn))}
      />
      <ToolTabs kind="guides" current={slug} />
      <ToolHeader hubHref="/guides" hubLabel={t('menu.guides')} name={t(`${k}.name`)} title={t(`${k}.title`)} lead={t(`${k}.lead`)} icon={g.icon} />
      <p className="mt-3 text-sm text-muted-foreground">
        {t('common.updated')}: <time dateTime={updatedOn}>{updated}</time>
      </p>
      {sections.length >= 4 && (
        <nav aria-label={t('common.toc')} className="mt-8 max-w-2xl border-l-2 border-border pl-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('common.toc')}</p>
          <ol className="mt-2 space-y-1.5 text-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-foreground/80 hover:text-primary hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="mt-8 max-w-2xl space-y-10 sm:mt-10">{body}</div>
      <div className="mt-12 max-w-2xl">
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
      <div className="mt-12 max-w-2xl">
        {slug === SK_EINVOICING_GUIDE ? (
          <NewsletterSignup source="sk_einvoicing" country="SK" topics={['sk_einvoicing', 'deadlines']} />
        ) : (
          <NewsletterSignup source="guides" />
        )}
      </div>
      <div className="mt-12">
        <RelatedTools current={slug} />
      </div>
    </article>
  );
}

type GuideSectionProps = { title: string; id?: string; children: React.ReactNode };

/** `id` is set by GuidePage for its table of contents. */
export function GuideSection({ title, id, children }: GuideSectionProps) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7 text-foreground/90">{children}</div>
    </section>
  );
}
