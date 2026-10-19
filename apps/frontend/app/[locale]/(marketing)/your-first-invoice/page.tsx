import type { Metadata } from 'next';
import { CalendarX2, Copy, FilePen, Hash, PlayCircle, Receipt, UserX } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckList, NextPages, NumberedSteps, PageIntro, ToolLinks } from '@/components/learn-page';
import { faqLd, FaqList, IconCards } from '@/components/segment-page';
import { ShareQr } from '@/components/share-qr';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

const PATH = '/your-first-invoice';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'learnPages.firstInvoice' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

const MISTAKES = [
  { icon: Receipt, key: 'vatShown' },
  { icon: Hash, key: 'numbering' },
  { icon: UserX, key: 'buyer' },
  { icon: CalendarX2, key: 'dates' },
  { icon: FilePen, key: 'editing' },
  { icon: Copy, key: 'copies' }
] as const;

/**
 * For someone who has never issued an invoice: what it must contain in
 * Czechia and Slovakia, the steps, the usual mistakes, then the guest
 * invoice (no account) or the demo with an empty company.
 */
export default async function FirstInvoicePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('learnPages.firstInvoice');
  const tc = await getTranslations('learnPages.common');
  const faq = t.raw('faq') as { q: string; a: string }[];
  // A Slovak reader sees the Slovak rules first.
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
        <Link href="/create-invoice" className={buttonClass.primary}>
          {t('guestCta')}
        </Link>
        <Link href={{ pathname: '/demo', query: { for: 'firstInvoice' } }} className={buttonClass.secondary}>
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
          {t('demoCta')}
        </Link>
        <ShareQr />
      </PageIntro>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('contentTitle')}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('contentLead')}</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {countries.map((country) => (
          <div key={country} className="rounded-xl border border-border bg-card p-5">
            <h3 className="font-bold">{t(`countries.${country}.title`)}</h3>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('alwaysLabel')}</p>
            <CheckList className="mt-2" items={t.raw(`countries.${country}.always`) as string[]} />
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('vatLabel')}</p>
            <CheckList className="mt-2" items={t.raw(`countries.${country}.vat`) as string[]} />
            <p className="mt-4 text-xs text-muted-foreground">{t(`countries.${country}.law`)}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('stepsTitle')}</h2>
      <NumberedSteps steps={t.raw('steps') as { title: string; body: string }[]} />

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('mistakesTitle')}</h2>
      <IconCards items={MISTAKES.map(({ icon, key }) => ({ icon, title: t(`mistakes.${key}.title`), body: t(`mistakes.${key}.body`) }))} />

      <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight">{t('ctaBox.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{t('ctaBox.body')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/signup" className={buttonClass.primary}>
            {tc('signup')}
          </Link>
          <Link href="/create-invoice" className={buttonClass.secondary}>
            {t('guestCta')}
          </Link>
        </div>
      </div>

      <ToolLinks
        locale={locale}
        title={tc('toolsTitle')}
        lead={tc('toolsLead')}
        calculators={['company-lookup', 'due-date', 'qr-payment', 'iban', 'vat']}
        features={['required-fields-check', 'company-lookup-ares', 'qr-payments']}
      />

      <NextPages
        title={tc('nextTitle')}
        items={[
          { href: '/invoicing-for-beginners', title: tc('pages.beginners.title'), body: tc('pages.beginners.body') },
          { href: '/invoicing-for-advanced', title: tc('pages.advanced.title'), body: tc('pages.advanced.body') }
        ]}
      />

      <FaqList title={tc('faqTitle')} faq={faq} />
    </section>
  );
}
