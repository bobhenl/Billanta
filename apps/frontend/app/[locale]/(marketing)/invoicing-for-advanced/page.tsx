import type { Metadata } from 'next';
import { ArrowLeftRight, Building2, FileCheck2, FileText, Globe2, Landmark, PlayCircle, Repeat, Users, Webhook } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LinkCards, NextPages, PageIntro, ToolLinks } from '@/components/learn-page';
import { faqLd, FaqList } from '@/components/segment-page';
import { ShareQr } from '@/components/share-qr';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

const PATH = '/invoicing-for-advanced';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'learnPages.advanced' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

/** Each topic links to the page that explains how Billanta handles it. */
const TOPICS = [
  { icon: FileCheck2, key: 'vat', href: '/features/vat-returns-epo' },
  { icon: ArrowLeftRight, key: 'reverseCharge', href: '/features/required-fields-check' },
  { icon: Globe2, key: 'foreign', href: '/features/foreign-currency-invoices' },
  { icon: Repeat, key: 'recurring', href: '/features/recurring-invoices' },
  { icon: Landmark, key: 'bank', href: '/features/payment-matching' },
  { icon: Webhook, key: 'api', href: '/features/api-webhooks' },
  { icon: Building2, key: 'companies', href: '/features/multiple-companies' },
  { icon: Users, key: 'roles', href: '/team-roles' },
  { icon: FileText, key: 'isdoc', href: '/features/isdoc' }
] as const;

/** For VAT payers and growing companies: the topics past the first year. */
export default async function AdvancedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('learnPages.advanced');
  const tc = await getTranslations('learnPages.common');
  const faq = t.raw('faq') as { q: string; a: string }[];

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
        <Link href={{ pathname: '/demo', query: { for: 'advanced' } }} className={buttonClass.secondary}>
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
          {tc('demo')}
        </Link>
        <ShareQr />
      </PageIntro>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('topicsTitle')}</h2>
      <LinkCards more={tc('more')} items={TOPICS.map(({ icon, key, href }) => ({ icon, href, title: t(`topics.${key}.title`), body: t(`topics.${key}.body`) }))} />

      <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight">{t('switch.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{t('switch.body')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/features/switch-from-another-app" className={buttonClass.primary}>
            {t('switch.cta')}
          </Link>
          <Link href="/compare" className={buttonClass.secondary}>
            {t('switch.compare')}
          </Link>
        </div>
      </div>

      <ToolLinks
        locale={locale}
        title={tc('toolsTitle')}
        lead={tc('toolsLead')}
        calculators={['vat', 'cnb-exchange-rates', 'company-lookup']}
        features={['accountant-export', 'audit-log', 'partial-payments', 'templates-and-bulk-invoicing', 'bilingual-invoices', 'data-backups']}
      />

      <NextPages
        title={tc('nextTitle')}
        items={[
          { href: '/team-roles', title: tc('pages.roles.title'), body: tc('pages.roles.body') },
          { href: '/for-accountants', title: tc('pages.accountants.title'), body: tc('pages.accountants.body') },
          { href: '/invoicing-for-beginners', title: tc('pages.beginners.title'), body: tc('pages.beginners.body') },
          { href: '/your-first-invoice', title: tc('pages.first.title'), body: tc('pages.first.body') }
        ]}
      />

      <FaqList title={tc('faqTitle')} faq={faq} />
    </section>
  );
}
