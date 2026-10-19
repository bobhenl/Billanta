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
  GraduationCap,
  School,
  ShieldCheck,
  Stamp,
  Users
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoCta } from '@/components/demo/demo-cta';
import { contactMailto, faqLd, FaqList, IconCards } from '@/components/segment-page';
import { ShareQr } from '@/components/share-qr';
import { Link } from '@/i18n/navigation';
import { GUIDES, isPublishedIn } from '@/lib/public-tools';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

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
      <p className="text-sm font-bold uppercase tracking-wider text-primary">{t('eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>
      <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.06] px-3 py-1 text-sm font-semibold text-primary">
        <GraduationCap className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('freeBadge')}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {mailto ? (
          <a href={mailto} className={buttonClass.primary}>
            {t('access.cta')}
          </a>
        ) : (
          <Link href="/signup" className={buttonClass.primary}>
            {t('access.signup')}
          </Link>
        )}
        <Link href="/for-schools/lessons" className={buttonClass.secondary}>
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {t('lessonsLink')}
        </Link>
        <ShareQr />
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('practiceTitle')}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('practiceLead')}</p>
      <IconCards items={PRACTICE.map(({ icon, key }) => ({ icon, title: t(`practice.${key}.title`), body: t(`practice.${key}.body`) }))} />

      <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight">{t('access.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{t('access.lead')}</p>
        <ol className="mt-5 grid gap-4 sm:grid-cols-3">
          {(['request', 'setup', 'teach'] as const).map((key, i) => (
            <li key={key} className="rounded-xl border border-border bg-card p-5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
              <h3 className="mt-3 font-bold">{t(`access.steps.${key}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`access.steps.${key}.body`)}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">{t('access.soon')}</p>
        <div className="mt-4">
          {mailto ? (
            <a href={mailto} className={buttonClass.primary}>
              {t('access.cta')}
            </a>
          ) : (
            <Link href="/signup" className={buttonClass.primary}>
              {t('access.signup')}
            </Link>
          )}
        </div>
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('safeguardsTitle')}</h2>
      <IconCards items={SAFEGUARDS.map(({ icon, key }) => ({ icon, title: t(`safeguards.${key}.title`), body: t(`safeguards.${key}.body`) }))} />

      <DemoCta className="mt-12" />

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('resourcesTitle')}</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('resourcesLead')}</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        <li>
          <Link href="/for-schools/lessons" className="flex gap-2 rounded-lg border border-primary/40 bg-card p-3 text-sm font-semibold hover:border-primary">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {t('lessonsLink')}
          </Link>
        </li>
        {guides.map((g) => (
          <li key={g.slug}>
            <Link href={`/guides/${g.slug}`} className="flex gap-2 rounded-lg border border-border bg-card p-3 text-sm hover:border-primary/40">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {tTools(`guides.items.${g.key}.name`)}
            </Link>
          </li>
        ))}
        {RESOURCES.map(({ href, key }) => (
          <li key={key}>
            <Link href={href} className="flex gap-2 rounded-lg border border-border bg-card p-3 text-sm hover:border-primary/40">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {t(`resources.${key}`)}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/calculators" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        {tTools('common.allCalculators')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>

      <FaqList title={t('faqTitle')} faq={faq} />
    </section>
  );
}
