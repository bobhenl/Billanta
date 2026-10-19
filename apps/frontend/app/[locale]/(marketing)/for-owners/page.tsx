import type { Metadata } from 'next';
import { Archive, Building2, CreditCard, History, LayoutDashboard, UserPlus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoCta } from '@/components/demo/demo-cta';
import { NextPages, NumberedSteps, PageIntro } from '@/components/learn-page';
import { faqLd, FaqList, IconCards } from '@/components/segment-page';
import { ShareQr } from '@/components/share-qr';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

const PATH = '/for-owners';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'learnPages.owners' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

const CARDS = [
  { icon: LayoutDashboard, key: 'overview' },
  { icon: UserPlus, key: 'team' },
  { icon: History, key: 'audit' },
  { icon: CreditCard, key: 'billing' },
  { icon: Archive, key: 'backups' },
  { icon: Building2, key: 'companies' }
] as const;

/** The owner role: the person who founded the company in Billanta and answers for it. */
export default async function OwnersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('learnPages.owners');
  const tc = await getTranslations('learnPages.common');
  const tHub = await getTranslations('learnPages.roles');
  const faq = t.raw('faq') as { q: string; a: string }[];

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [tHub('title'), '/team-roles'],
            [t('title'), PATH]
          ]),
          faqLd(faq)
        ])}
      />
      <PageIntro eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')}>
        <Link href="/signup" className={buttonClass.primary}>
          {tc('signup')}
        </Link>
        <Link href="/team-roles" className={buttonClass.secondary}>
          {tc('allRoles')}
        </Link>
        <ShareQr />
      </PageIntro>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('cardsTitle')}</h2>
      <IconCards items={CARDS.map(({ icon, key }) => ({ icon, title: t(`cards.${key}.title`), body: t(`cards.${key}.body`) }))} />

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('stepsTitle')}</h2>
      <NumberedSteps steps={t.raw('steps') as { title: string; body: string }[]} />

      <DemoCta className="mt-12" />

      <NextPages
        title={tc('nextTitle')}
        items={[
          { href: '/for-assistants', title: tc('pages.assistants.title'), body: tc('pages.assistants.body') },
          { href: '/for-accountants', title: tc('pages.accountants.title'), body: tc('pages.accountants.body') },
          { href: '/invoicing-for-advanced', title: tc('pages.advanced.title'), body: tc('pages.advanced.body') },
          { href: '/team-roles', title: tc('pages.roles.title'), body: tc('pages.roles.body') }
        ]}
      />

      <FaqList title={tc('faqTitle')} faq={faq} />
    </section>
  );
}
