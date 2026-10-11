import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'about' });
  return publicPageMetadata({ locale, path: '/about', title: t('seoTitle'), description: t('lead') });
}


/**
 * Real marketing copy (unlike the `legal/` placeholders) — see
 * apps/frontend/README.md for the distinction. Covers what Faktur is
 * (CZ/SK invoicing SaaS built on ARES/ISDOC, with an AI voice-to-invoice
 * feature via Telegram/WhatsApp per blueprint §6), who it's for, and a
 * short "why we built this" narrative.
 */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('about');

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          {
            ...webPageLd(locale, '/about', 'AboutPage', t('title'), t('lead')),
            about: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/icon.svg` }
          },
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/about']
          ])
        ])}
      />
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-3 text-lg text-muted-foreground">{t('lead')}</p>

      <div className="mt-10 space-y-8">
        <section>
          <h2 className="text-base font-semibold">{t('whatTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('whatBody')}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold">{t('whoTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('whoBody')}</p>
        </section>

        <section>
          <h2 className="text-base font-semibold">{t('whyTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('whyBody')}</p>
        </section>
      </div>
    </div>
  );
}
