import type { Metadata } from 'next';
import { BellRing, Handshake, Hash, PlayCircle, QrCode, ReceiptText, Scale } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckList, NextPages, NumberedSteps, PageIntro, ToolLinks } from '@/components/learn-page';
import { faqLd, FaqList, IconCards } from '@/components/segment-page';
import { ShareQr } from '@/components/share-qr';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

const PATH = '/invoicing-for-beginners';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'learnPages.beginners' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

const TOPICS = [
  { icon: ReceiptText, key: 'nonVat' },
  { icon: Handshake, key: 'firstCustomer' },
  { icon: Hash, key: 'numbering' },
  { icon: QrCode, key: 'payment' },
  { icon: BellRing, key: 'reminders' },
  { icon: Scale, key: 'tax' }
] as const;

/** The basics for a new sole trader who is not a VAT payer and has a first customer. */
export default async function BeginnersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('learnPages.beginners');
  const tc = await getTranslations('learnPages.common');
  const faq = t.raw('faq') as { q: string; a: string }[];
  const countries = locale === 'sk' ? (['sk', 'cz'] as const) : (['cz', 'sk'] as const);

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), PATH]
          ]),
          faqLd(faq)
        ])}
      />
      <PageIntro eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')}>
        <Link href="/signup" className={buttonClass.primary}>
          {tc('signup')}
        </Link>
        <Link href={{ pathname: '/demo', query: { for: 'beginners' } }} className={buttonClass.secondary}>
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
          {tc('demo')}
        </Link>
        <ShareQr />
      </PageIntro>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('topicsTitle')}</h2>
      <IconCards items={TOPICS.map(({ icon, key }) => ({ icon, title: t(`topics.${key}.title`), body: t(`topics.${key}.body`) }))} />

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('vatTitle')}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('vatLead')}</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {countries.map((country) => (
          <div key={country} className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold">{t(`vat.${country}.title`)}</h3>
            <CheckList className="mt-3" items={t.raw(`vat.${country}.points`) as string[]} />
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('monthTitle')}</h2>
      <NumberedSteps steps={t.raw('month') as { title: string; body: string }[]} className="lg:grid-cols-2" />

      <ToolLinks
        locale={locale}
        title={tc('toolsTitle')}
        lead={tc('toolsLead')}
        calculators={['flat-tax', 'self-employed-tax', 'slovak-self-employed-tax', 'minimum-advances', 'due-date']}
        features={['payment-reminders', 'qr-payments', 'quotes-and-proforma-invoices']}
      />

      <NextPages
        title={tc('nextTitle')}
        items={[
          { href: '/your-first-invoice', title: tc('pages.first.title'), body: tc('pages.first.body') },
          { href: '/invoicing-for-advanced', title: tc('pages.advanced.title'), body: tc('pages.advanced.body') },
          { href: '/for-schools', title: tc('pages.schools.title'), body: tc('pages.schools.body') },
          { href: '/team-roles', title: tc('pages.roles.title'), body: tc('pages.roles.body') }
        ]}
      />

      <FaqList title={tc('faqTitle')} faq={faq} />
    </section>
  );
}
