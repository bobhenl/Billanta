import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { ClosingCta } from '@/components/audience-page';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'about' });
  return publicPageMetadata({ locale, path: '/about', title: t('seoTitle'), description: t('lead') });
}

/**
 * Real marketing copy (unlike the `legal/` placeholders) – see
 * apps/frontend/README.md for the distinction. Covers what Faktur is
 * (CZ/SK invoicing SaaS built on ARES/ISDOC, with an AI voice-to-invoice
 * feature via Telegram/WhatsApp per blueprint §6), who it's for, and a
 * short "why we built this" narrative.
 */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('about');
  const tCta = await getTranslations('marketing.finalCta');

  return (
    <div className="container max-w-2xl py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          {
            ...webPageLd(locale, '/about', 'AboutPage', t('title'), t('lead')),
            about: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/brand/logo.png` }
          },
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/about']
          ])
        ])}
      />
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 text-muted-foreground sm:text-lg">{t('lead')}</p>

      <div className="mt-10 space-y-8">
        <section>
          <h2 className="text-lg font-bold">{t('whatTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('whatBody')}</p>
        </section>

        <section>
          <h2 className="text-lg font-bold">{t('whoTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('whoBody')}</p>
        </section>

        <section>
          <h2 className="text-lg font-bold">{t('whyTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('whyBody')}</p>
        </section>
      </div>

      <ClosingCta title={tCta('title')} body={tCta('subtitle')} primary={{ href: '/signup', label: tCta('cta') }} />
    </div>
  );
}
