import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { ApiError, apiFetch, NotSignedInError } from '@/lib/api-client';
import { classroomEnabled, type ClassDetail } from '@/lib/classroom';
import { ClassView } from './class-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('classroom');
  return { title: t('title') };
}

/** One class: the join code, the students and their progress, and the owner's settings. */
export default async function ClassPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const session = await auth();
  if (!classroomEnabled() || session?.isDemo || !/^[0-9a-f-]{36}$/i.test(classId)) notFound();
  const locale = await getLocale();
  const t = await getTranslations('classroom');

  let detail: ClassDetail;
  let colleagues: { id: string; name: string; subject: string | null }[] = [];
  try {
    detail = await apiFetch<ClassDetail>(`/api/v1/classroom/classes/${classId}`);
    // Only the owner adds co-teachers; the list is the approved teachers of the same school.
    if (detail.isOwner) colleagues = await apiFetch<typeof colleagues>('/api/v1/classroom/colleagues').catch(() => []);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/classroom" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        {t('backToClasses')}
      </Link>
      <ClassView detail={detail} colleagues={colleagues} />
    </div>
  );
}
