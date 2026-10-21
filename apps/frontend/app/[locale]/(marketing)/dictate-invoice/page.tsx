import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { publicPageMetadata } from '@/lib/seo';
import { Link } from '@/i18n/navigation';
import { GuestInvoiceForm } from '../create-invoice/guest-invoice-form';

/**
 * The shareable "say it, get an invoice" page: the guest invoice form with
 * the voice fill up front. Speech-to-text runs in the browser; only the
 * transcript reaches the backend, under the same per-visitor and global AI
 * caps as /create-invoice. Nothing is issued or stored.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'guestInvoice.dictatePage' });
  return publicPageMetadata({ locale, path: '/dictate-invoice', title: t('seoTitle'), description: t('seoDescription') });
}

export default async function DictateInvoicePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('guestInvoice.dictatePage');
  const tGuest = await getTranslations('guestInvoice');

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('heading')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>
      <p className="mt-2 max-w-2xl text-sm italic text-muted-foreground">{t('example')}</p>
      {/* Same as /create-invoice: Clarity must never record what visitors say or type here. */}
      <div data-clarity-mask="true">
        <GuestInvoiceForm dictate />
      </div>
      <p className="mt-8 text-sm">
        <Link href="/create-invoice" className="font-semibold text-primary hover:underline">
          {tGuest('heading')}
        </Link>
      </p>
    </section>
  );
}
