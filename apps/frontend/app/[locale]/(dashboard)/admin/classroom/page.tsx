import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { ApiError, apiFetch, NotSignedInError } from '@/lib/api-client';
import { classroomEnabled } from '@/lib/classroom';
import { TeacherQueue, type AdminTeacher } from './teacher-queue';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminClassroom');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Billanta staff only: teacher applications and their schools. Like the
 * accountant queue, anyone the backend's PlatformAdminGuard refuses gets a 404.
 */
export default async function AdminClassroomPage() {
  if (!classroomEnabled()) notFound();
  const locale = await getLocale();
  const t = await getTranslations('adminClassroom');

  let teachers: AdminTeacher[];
  try {
    teachers = await apiFetch<AdminTeacher[]>('/api/v1/admin/classroom/teachers');
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) notFound();
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <TeacherQueue teachers={teachers} />
    </div>
  );
}
