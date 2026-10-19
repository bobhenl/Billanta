import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { ApiError, apiFetch, NotSignedInError } from '@/lib/api-client';
import { classroomEnabled, type ClassSummary, type TeacherStatus } from '@/lib/classroom';
import { ApplyForm } from './apply-form';
import { CreateClassForm, InviteColleagueForm } from './teacher-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('classroom');
  return { title: t('title') };
}

/**
 * The teacher's home (docs/classroom-mode-plan.md): apply first, then wait
 * for approval, then the classes. Demo and student sessions never get here.
 */
export default async function ClassroomPage() {
  const session = await auth();
  if (!classroomEnabled() || session?.isDemo) notFound();
  const locale = await getLocale();
  const t = await getTranslations('classroom');
  const format = await getFormatter();

  let status: TeacherStatus;
  try {
    status = await apiFetch<TeacherStatus>('/api/v1/classroom/me');
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  const { teacher, school } = status;
  const header = (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
    </div>
  );

  if (!teacher || teacher.status === 'rejected') {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        {teacher?.status === 'rejected' && <Banner tone="err" title={t('rejected.title')} className="mt-5">{t('rejected.body')}</Banner>}
        <ApplyForm />
      </div>
    );
  }

  if (teacher.status === 'pending') {
    return (
      <div className="mx-auto max-w-2xl">
        {header}
        <Banner tone="info" title={t('pending.title')} className="mt-5">
          {t('pending.body', { school: school?.name ?? '' })}
        </Banner>
      </div>
    );
  }

  let classes: ClassSummary[] = [];
  try {
    classes = await apiFetch<ClassSummary[]>('/api/v1/classroom/classes');
  } catch {
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      {header}
      {school?.suspended && (
        <Banner tone="warn" title={t('suspended.title')} className="mt-5">
          {t('suspended.body')}
        </Banner>
      )}
      <p className="mt-4 text-sm text-muted-foreground">{t('signedInAs', { name: teacher.name, school: school?.name ?? '' })}</p>

      <section className="mt-6">
        <h2 className="text-lg font-bold">{t('classes.title')}</h2>
        {classes.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('classes.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
            {classes.map((c) => (
              <li key={c.id}>
                <Link href={`/classroom/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-accent/50">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`tracks.${c.track}.title`)} · {t('classes.students', { n: c.students ?? 0 })}
                      {!c.isOwner && ` · ${t('classes.coTeaching')}`}
                    </span>
                  </span>
                  <span className={c.ended ? 'text-xs font-semibold text-warning' : 'text-xs text-muted-foreground'}>
                    {c.ended
                      ? t('classes.ended', { date: format.dateTime(new Date(c.deletesAt), { dateStyle: 'medium' }) })
                      : t('classes.until', { date: format.dateTime(new Date(c.endsAt), { dateStyle: 'medium' }) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!school?.suspended && (
        <>
          <CreateClassForm suggestedTrack={school?.suggestedTrack ?? 'standard'} defaultLanguage={locale} country={school?.country ?? 'CZ'} />
          <InviteColleagueForm school={school?.name ?? ''} />
        </>
      )}
    </div>
  );
}
