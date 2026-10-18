import type { Metadata } from 'next';
import { BookOpenCheck, CalendarCheck, GraduationCap, Rocket, Ticket, UserPlus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PartnerChecklist, PartnerSegmentPage } from '@/components/partner-segment';
import { Link } from '@/i18n/navigation';
import { publicPageMetadata } from '@/lib/seo';
import { buttonClass } from '@/lib/ui-classes';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'partnerSegments.courses' });
  return publicPageMetadata({ locale, path: '/for-courses', title: t('seoTitle'), description: t('lead') });
}

/**
 * For retraining and "start a business" courses (labour office courses,
 * CzechInvest, incubators): participants found their business during the
 * course, so the demo opens empty with the tradesman preset and the lessons
 * at /for-schools/lessons carry the teaching part.
 */
export default async function ForCoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('partnerSegments.courses');
  return (
    <PartnerSegmentPage
      locale={locale}
      segment="courses"
      offers={[
        { key: 'free', icon: CalendarCheck },
        { key: 'code', icon: Ticket },
        { key: 'lessons', icon: BookOpenCheck },
        { key: 'empty', icon: Rocket },
        { key: 'noAccounts', icon: UserPlus },
        { key: 'lecturer', icon: GraduationCap }
      ]}
    >
      <PartnerChecklist className="mt-12" title={t('lesson.title')} lead={t('lesson.lead')} points={t.raw('lesson.points') as string[]}>
        <div className="mt-4">
          <Link href="/for-schools/lessons" className={buttonClass.secondary}>
            {t('lesson.link')}
          </Link>
        </div>
      </PartnerChecklist>
    </PartnerSegmentPage>
  );
}
