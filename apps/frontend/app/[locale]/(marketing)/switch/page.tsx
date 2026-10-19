import type { Metadata } from 'next';
import { ArrowRight, FileSpreadsheet } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { switchBrandsFor } from '@/lib/switch';
import { SwitchCta } from './switch-cta';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'switchPage' });
  return publicPageMetadata({ locale, path: '/switch', title: t('seoTitle'), description: t('lead') });
}

/**
 * /switch: one card per app people leave for Billanta, each linking to its
 * export guide (/switch/<key>). Wording in `switchPage.*`, our own.
 */
export default async function SwitchHubPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('switchPage');
  const how = t.raw('how') as string[];

  return (
    <section className="container py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, '/switch', 'WebPage', t('title'), t('lead')),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('navTitle'), '/switch']
          ])
        ])}
      />
      <div className="max-w-2xl">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="mt-3 text-muted-foreground">{t('lead')}</p>
      </div>

      <h2 className="mt-10 text-xl font-bold">{t('pickTitle')}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {switchBrandsFor(locale).map((b) => (
          <li key={b.key}>
            <Link
              href={`/switch/${b.key}`}
              className="flex h-full flex-col justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <span className="text-lg font-bold">{b.name}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                {t('cardCta')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
        <li className="rounded-xl border border-dashed border-border p-4">
          <span className="flex items-center gap-1.5 font-bold">
            <FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden="true" />
            {t('otherTitle')}
          </span>
          <span className="mt-2 block text-sm text-muted-foreground">{t('otherText')}</span>
        </li>
      </ul>

      <h2 className="mt-12 text-xl font-bold">{t('howTitle')}</h2>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {how.map((s, i) => (
          <li key={s} className="flex gap-3 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <SwitchCta className="mt-12" />
    </section>
  );
}
