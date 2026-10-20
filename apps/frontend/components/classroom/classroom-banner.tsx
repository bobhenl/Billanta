'use client';

import { useState, useTransition } from 'react';
import { GraduationCap } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { leaveStudentCompany } from '@/app/[locale]/(dashboard)/classroom/actions';
import type { StudentCompany } from '@/lib/classroom';
import { buttonClass } from '@/lib/ui-classes';

/**
 * The strip above a practice company, in place of the demo countdown. The
 * student sees their class, the personal code for another device and when
 * the company goes away; in a team's or a classmate's company also whose it
 * is and, as its accountant, what they may do there. A teacher looking in
 * sees whose company it is and the way back to the class.
 */
export function ClassroomBanner({ info }: { info: StudentCompany }) {
  const t = useTranslations('classroom.banner');
  const format = useFormatter();
  const router = useRouter();
  const locale = useLocale();
  const [showCode, setShowCode] = useState(false);
  const [pending, start] = useTransition();
  const deletes = format.dateTime(new Date(info.deletesAt), { dateStyle: 'medium' });
  const who = info.team ? t('teamName', { team: info.team }) : (info.nickname ?? '');
  const base =
    info.relation === 'accountant'
      ? t('accountant', { who, className: info.className })
      : info.relation === 'teacher'
        ? info.team
          ? t('teacherTeam', { team: info.team, className: info.className })
          : t('teacher', { nickname: who, className: info.className })
        : info.team
          ? t('team', { team: info.team, className: info.className })
          : t('student', { nickname: who, className: info.className });
  const title = info.label ? `${info.label} · ${base}` : base;

  /** Ends the student session only; the company stays until the class is deleted. */
  async function leave() {
    if (!window.confirm(t('leaveConfirm'))) return;
    const res = await fetch('/api/demo/end', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ next: '/join', locale })
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { redirect?: string } | null;
    window.location.assign(data?.redirect ?? `/${locale}/join`);
  }

  function backToClass() {
    start(async () => {
      await leaveStudentCompany();
      router.push(`/classroom/${info.classId}`);
      router.refresh();
    });
  }

  return (
    <div role="status" className="mb-4 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-2">
        <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="font-semibold">{title}</p>
          {info.relation === 'accountant' && info.mode && <p className="text-xs text-foreground">{t(`modes.${info.mode}`)}</p>}
          {/* After the end every write fails with classroom_ended; say why here, once, rather than in each form. */}
          {info.readOnly ? (
            <p className="text-xs font-medium text-foreground">{t('ended', { date: deletes })}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('practice', { date: deletes })}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {info.own && info.reentryCode && (
          <button type="button" onClick={() => setShowCode((v) => !v)} className={buttonClass.ghost}>
            {showCode ? <span className="font-mono font-bold tracking-widest text-foreground">{info.reentryCode}</span> : t('showCode')}
          </button>
        )}
        {info.own ? (
          <button type="button" onClick={() => void leave()} className={buttonClass.secondary}>
            {t('leave')}
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={backToClass} className={buttonClass.secondary}>
            {t('backToClass')}
          </button>
        )}
      </div>
    </div>
  );
}
