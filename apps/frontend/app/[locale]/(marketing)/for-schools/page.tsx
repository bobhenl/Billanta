import type { Metadata } from 'next';
import {
  ArrowRight,
  BellRing,
  BookOpen,
  Check,
  FileMinus2,
  FileText,
  Flag,
  Globe2,
  School,
  ShieldCheck,
  Stamp,
  Users
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AudienceHero, SectionTitle } from '@/components/audience-page';
import { NumberedSteps } from '@/components/learn-page';
import { contactMailto, faqLd, FaqList, IconCards } from '@/components/segment-page';
import { ShareQr } from '@/components/share-qr';
import { Link } from '@/i18n/navigation';
import { GUIDES, GUIDES_HUB_LOCALES, isPublishedIn } from '@/lib/public-tools';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { TEACHER_SIGNUP_HREF } from '@/lib/teacher';

const PATH = '/for-schools';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'schools' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

const PRACTICE = [
  { icon: FileText, key: 'vatInvoice' },
  { icon: FileMinus2, key: 'creditNote' },
  { icon: BellRing, key: 'reminder' },
  { icon: Globe2, key: 'foreign' },
  { icon: Flag, key: 'czsk' },
  { icon: Users, key: 'roles' }
] as const;

const SAFEGUARDS = [
  { icon: School, key: 'practice' },
  { icon: Stamp, key: 'watermark' },
  { icon: ShieldCheck, key: 'notReal' }
] as const;

/** Related public pages a teacher can hand out with a lesson; guides only where they are published. */
const RESOURCES = [
  { href: '/your-first-invoice', key: 'firstInvoice' },
  { href: '/invoicing-for-beginners', key: 'beginners' },
  { href: '/features/required-fields-check', key: 'requiredFields' },
  { href: '/features/foreign-currency-invoices', key: 'currencies' },
  { href: '/features/payment-reminders', key: 'reminders' },
  { href: '/calculators/vat', key: 'vatCalculator' }
] as const;

/**
 * For teachers of business subjects: Billanta is free for teaching. The
 * classroom mode (a teacher's class with practice companies) is still being
 * built, so access is requested by e-mail for now. The lessons themselves
 * live under /for-schools/lessons.
 */
export default async function SchoolsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('schools');
  const tTools = await getTranslations('tools');
  const faq = t.raw('faq') as { q: string; a: string }[];
  const mailto = contactMailto(t('access.mailSubject'));
  const tLearn = await getTranslations('learnPages.common');
  const guides = GUIDES.filter((g) => isPublishedIn(g, locale));

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
      <AudienceHero
        title={t('title')}
        lead={t('lead')}
        primary={mailto ? { href: mailto, label: t('access.cta') } : { href: TEACHER_SIGNUP_HREF, label: t('access.signup') }}
        secondary={{ href: '/for-schools/lessons', label: t('lessonsLink') }}
      />

      <SectionTitle title={t('practiceTitle')} lead={t('practiceLead')} />
      <IconCards items={PRACTICE.map(({ icon, key }) => ({ icon, title: t(`practice.${key}.title`), body: t(`practice.${key}.body`) }))} />

      <SectionTitle title={t('access.title')} lead={t('access.lead')} />
      <NumberedSteps
        steps={(['request', 'setup', 'teach'] as const).map((key) => ({ title: t(`access.steps.${key}.title`), body: t(`access.steps.${key}.body`) }))}
      />
      <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
        {t('access.soon')}{' '}
        <Link href="/demo" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
          {tLearn('demo')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </p>

      <SectionTitle title={t('safeguardsTitle')} />
      <IconCards items={SAFEGUARDS.map(({ icon, key }) => ({ icon, title: t(`safeguards.${key}.title`), body: t(`safeguards.${key}.body`) }))} />
      <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
        {t.rich('privacyLink', {
          link: (chunks) => (
            <Link href="/legal/classroom-privacy" className="font-semibold text-primary hover:underline">
              {chunks}
            </Link>
          )
        })}
      </p>

      <SectionTitle title={t('resourcesTitle')} lead={t('resourcesLead')} />
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        <li>
          <Link href="/for-schools/lessons" className="flex gap-2 rounded-lg border border-primary/40 bg-card p-3 text-sm font-semibold hover:border-primary">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {t('lessonsLink')}
          </Link>
        </li>
        {RESOURCES.map(({ href, key }) => (
          <li key={key}>
            <Link href={href} className="flex gap-2 rounded-lg border border-border bg-card p-3 text-sm hover:border-primary/40">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {t(`resources.${key}`)}
            </Link>
          </li>
        ))}
      </ul>
      {guides.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {guides.map((g) => (
            <li key={g.slug}>
              <Link href={`/guides/${g.slug}`} className="text-muted-foreground hover:text-primary hover:underline">
                {tTools(`guides.items.${g.key}.name`)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-primary">
        <Link href="/calculators" className="inline-flex items-center gap-1.5 hover:underline">
          {tTools('common.allCalculators')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        {GUIDES_HUB_LOCALES.includes(locale) && (
          <Link href="/guides" className="inline-flex items-center gap-1.5 hover:underline">
            {tTools('common.allGuides')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      <FaqList title={t('faqTitle')} faq={faq} />

      <ShareQr className="mt-10" />
    </section>
  );
}
