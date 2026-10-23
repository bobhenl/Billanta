import type { Metadata } from 'next';
import { Command, FileText, Lock, Receipt, UserCog, Users } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AudienceHero, SectionTitle } from '@/components/audience-page';
import { NextPages, NumberedSteps } from '@/components/learn-page';
import { faqLd, FaqList, IconCards } from '@/components/segment-page';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

const PATH = '/for-assistants';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'learnPages.assistants' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

/** The access profiles an assistant usually gets (lib/team-presets.ts), plus what the app does for them. */
const CARDS = [
  { icon: UserCog, key: 'admin' },
  { icon: FileText, key: 'invoicer' },
  { icon: Receipt, key: 'expenses' },
  { icon: Users, key: 'contacts' },
  { icon: Command, key: 'tailored' },
  { icon: Lock, key: 'limits' }
] as const;

/**
 * Office managers and assistants: the admin role for someone who runs the
 * company's paperwork, or the narrower invoicer and expenses profiles.
 */
export default async function AssistantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('learnPages.assistants');
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
      <AudienceHero title={t('title')} lead={t('lead')} primary={{ href: '/signup', label: tc('signup') }} secondary={{ href: '/demo', label: tc('demo') }} />

      <SectionTitle title={t('cardsTitle')} />
      <IconCards items={CARDS.map(({ icon, key }) => ({ icon, title: t(`cards.${key}.title`), body: t(`cards.${key}.body`) }))} />

      <SectionTitle title={t('stepsTitle')} />
      <NumberedSteps steps={t.raw('steps') as { title: string; body: string }[]} className="lg:grid-cols-4" />

      <NextPages
        title={tc('nextTitle')}
        items={[
          { href: '/for-owners', title: tc('pages.owners.title'), body: tc('pages.owners.body') },
          { href: '/for-accountants', title: tc('pages.accountants.title'), body: tc('pages.accountants.body') },
          { href: '/your-first-invoice', title: tc('pages.first.title'), body: tc('pages.first.body') },
          { href: '/team-roles', title: tc('pages.roles.title'), body: tc('pages.roles.body') }
        ]}
      />

      <FaqList title={tc('faqTitle')} faq={faq} />
    </section>
  );
}
