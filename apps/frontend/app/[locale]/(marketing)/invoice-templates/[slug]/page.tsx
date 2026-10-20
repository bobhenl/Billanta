import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { GuideSection } from '@/components/public-tools/guide-page';
import { InvoiceTemplateSample, LawLink, TemplateTabs, templateMetadata } from '@/components/public-tools/invoice-template';
import { RelatedTools, SignupCta, ToolHeader } from '@/components/public-tools/parts';
import { RemindersLink } from '@/components/public-tools/payment-reminder';
import { getTemplate, isPublishedIn, TEMPLATES } from '@/lib/public-tools';
import { breadcrumbLd, jsonLd, webPageLd } from '@/lib/seo';
import { buttonClass } from '@/lib/ui-classes';
import { SITE_NAME } from '@/lib/site';
import { cn } from '@/lib/utils';

/**
 * One invoice template: the rendered sample, when to use it, the required
 * details linked to the law, and a button that opens the guest invoice
 * editor (`/create-invoice?template=<slug>`) preset for this document. The
 * PDF comes from that editor; there is no separate download here.
 */
type Params = { locale: string; slug: string };
type Field = { name: string; text: string; rule?: string };

export const dynamicParams = false;

export function generateStaticParams() {
  return TEMPLATES.map((x) => ({ slug: x.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!getTemplate(slug)) return {};
  return templateMetadata(slug, locale);
}

export default async function InvoiceTemplatePage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const tpl = getTemplate(slug);
  if (!tpl || !isPublishedIn(tpl, locale)) notFound();

  const t = await getTranslations('invoiceTemplates');
  const k = `items.${tpl.key}` as const;
  const path = `/invoice-templates/${slug}`;
  const when = t.raw(`${k}.when`) as string[];
  const fields = t.raw(`${k}.fields`) as Field[];
  const pitfalls = t.raw(`${k}.pitfalls`) as string[];
  const others = TEMPLATES.filter((x) => x.slug !== slug && isPublishedIn(x, locale));
  const pill = 'inline-flex rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary';

  return (
    <article className="container py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, path, 'WebPage', t(`${k}.title`), t(`${k}.description`)),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('indexName'), '/invoice-templates'],
            [t(`${k}.name`), path]
          ])
        ])}
      />
      <TemplateTabs current={slug} />
      <ToolHeader hubHref="/invoice-templates" hubLabel={t('indexName')} name={t(`${k}.name`)} title={t(`${k}.title`)} lead={t(`${k}.lead`)} icon={tpl.icon} />

      <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 lg:sticky lg:top-24 lg:order-2">
          <InvoiceTemplateSample tpl={tpl} />
          <div className="mt-5">
            <Link href={`/create-invoice?template=${slug}`} className={cn(buttonClass.primary, 'inline-flex w-full items-center gap-2 sm:w-auto')}>
              {t('common.useButton')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <p className="mt-2 text-xs text-muted-foreground">{t('common.useNote')}</p>
          </div>
        </div>

        <div className="min-w-0 space-y-10 lg:order-1">
          <GuideSection title={t('common.whenTitle')}>
            {when.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </GuideSection>
          <GuideSection title={t('common.fieldsTitle')}>
            <p className="text-muted-foreground">{t('common.fieldsLead')}</p>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {fields.map((f) => (
                <li key={f.name} className="p-4">
                  <p className="font-semibold">{f.name}</p>
                  <p className="mt-1 text-muted-foreground">{f.text}</p>
                  {f.rule && (
                    <p className="mt-1.5 text-xs">
                      <LawLink rule={f.rule} />
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </GuideSection>
          <GuideSection title={t('common.pitfallsTitle')}>
            <ul className="list-disc space-y-1.5 pl-5">
              {pitfalls.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </GuideSection>
          <p className="text-xs text-muted-foreground">{t('common.rulesNote')}</p>
        </div>
      </div>

      <nav aria-label={t('common.otherTitle')} className="mt-12 border-t border-border pt-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('common.otherTitle')}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {others.map((x) => (
            <li key={x.slug}>
              <Link href={`/invoice-templates/${x.slug}`} className={pill}>
                {t(`items.${x.key}.name`)}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/invoice-templates" className="inline-flex px-4 py-2 text-sm font-medium text-primary hover:underline">
              {t('common.allTemplates')} →
            </Link>
          </li>
        </ul>
      </nav>
      <div className="mt-12">
        <RemindersLink />
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
