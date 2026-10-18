import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { GuestAccountCta } from '@/components/account-cta';
import { GuestInvoiceForm } from './guest-invoice-form';

/**
 * Public "invoice without registration" tool: a full invoice form whose PDF
 * the backend renders statelessly (`POST /api/v1/public/guest-invoice/pdf`).
 * Indexable — it's a useful page on its own and the main search intent
 * ("faktura online zdarma bez registrace") it answers.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'guestInvoice' });
  return publicPageMetadata({ locale, path: '/create-invoice', title: t('seoTitle'), description: t('seoDescription') });
}

export default async function GuestInvoicePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('guestInvoice');
  const points = t.raw('points') as string[];

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: `${t('heading')} – ${SITE_NAME}`,
    url: `${SITE_URL}/${locale}/create-invoice`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: locale,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CZK' }
  };

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('heading')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm font-medium">
        {points.map((p) => (
          <li key={p} className="flex items-center gap-1.5">
            <Check className="h-4 w-4 text-primary" aria-hidden="true" />
            {p}
          </li>
        ))}
      </ul>
      <GuestAccountCta />
      {/* Clarity (consent-gated session recording on public pages) must
          never record what visitors type here: names, addresses, amounts,
          the AI prompt. data-clarity-mask hides the whole subtree. */}
      <div data-clarity-mask="true">
        <GuestInvoiceForm />
      </div>
    </section>
  );
}
