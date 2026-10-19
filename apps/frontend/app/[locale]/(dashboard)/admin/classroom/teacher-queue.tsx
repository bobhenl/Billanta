'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { formatDate } from '@/lib/invoice-ui';
import { cn } from '@/lib/utils';
import { decideTeacher, suspendSchool } from './actions';

export interface AdminTeacher {
  id: string;
  name: string;
  subject: string | null;
  expectedStudents: number | null;
  status: 'pending' | 'approved' | 'rejected';
  invited: string | null;
  createdAt: string;
  email: string;
  emailVerified: string | null;
  school: {
    id: string;
    country: 'CZ' | 'SK';
    ico: string;
    name: string;
    level: string;
    address: string | null;
    webUrl: string | null;
    emailDomain: string | null;
    verification: 'pending' | 'verified' | 'rejected';
    suspendedAt: string | null;
    reviewNote: string | null;
  };
}

const ORDER = { pending: 0, approved: 1, rejected: 2 } as const;

/** Pending applications first; within a status the backend's newest-first order stays. */
export function TeacherQueue({ teachers }: { teachers: AdminTeacher[] }) {
  const t = useTranslations('adminClassroom');
  if (teachers.length === 0) {
    return <p className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  }
  const sorted = [...teachers].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return (
    <ul className="mt-5 space-y-4">
      {sorted.map((teacher) => (
        <TeacherCard key={`${teacher.id}:${teacher.status}:${teacher.school.suspendedAt ?? ''}`} teacher={teacher} />
      ))}
    </ul>
  );
}

function TeacherCard({ teacher: x }: { teacher: AdminTeacher }) {
  const t = useTranslations('adminClassroom');
  const tLevels = useTranslations('classroom.apply.levels');
  const locale = useLocale();
  const router = useRouter();
  const s = x.school;
  const [note, setNote] = useState('');
  // The domain of the applicant's e-mail is the usual answer; staff correct it for a gmail address.
  const [domain, setDomain] = useState(s.emailDomain ?? x.email.split('@')[1] ?? '');
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast({ text: done, tone: 'ok' });
      else toast({ text: `${t('failed')}: ${result.error}`, tone: 'err' });
      router.refresh();
    });

  const row = 'grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3';

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{x.name}</h2>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-semibold',
            x.status === 'pending' && 'bg-primary/10 text-primary',
            x.status === 'approved' && 'bg-secondary text-foreground',
            x.status === 'rejected' && 'bg-destructive/10 text-destructive'
          )}
        >
          {t(`status.${x.status}`)}
        </span>
      </div>
      <p className="break-all text-xs text-muted-foreground">
        {x.email} · {x.emailVerified ? t('emailVerified') : t('emailUnverified')} · {formatDate(x.createdAt, locale)}
      </p>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className={row}>
          <dt className="text-muted-foreground">{t('fields.school')}</dt>
          <dd>
            {s.name} ({s.country}, {t('ico')} {s.ico}) · {tLevels.has(s.level) ? tLevels(s.level) : s.level}
          </dd>
        </div>
        {s.address && (
          <div className={row}>
            <dt className="text-muted-foreground">{t('fields.address')}</dt>
            <dd>{s.address}</dd>
          </div>
        )}
        {s.webUrl && (
          <div className={row}>
            <dt className="text-muted-foreground">{t('fields.web')}</dt>
            <dd className="break-all">
              <a href={s.webUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">
                {s.webUrl}
              </a>
            </dd>
          </div>
        )}
        <div className={row}>
          <dt className="text-muted-foreground">{t('fields.schoolState')}</dt>
          <dd>
            {t(`verification.${s.verification}`)}
            {s.emailDomain ? ` · @${s.emailDomain}` : ''}
            {s.suspendedAt ? ` · ${t('suspended')}` : ''}
          </dd>
        </div>
        {x.subject && (
          <div className={row}>
            <dt className="text-muted-foreground">{t('fields.subject')}</dt>
            <dd>{x.subject}</dd>
          </div>
        )}
        {x.expectedStudents != null && (
          <div className={row}>
            <dt className="text-muted-foreground">{t('fields.expectedStudents')}</dt>
            <dd>{x.expectedStudents}</dd>
          </div>
        )}
        {x.invited && (
          <div className={row}>
            <dt className="text-muted-foreground">{t('fields.invited')}</dt>
            <dd>{t('invitedYes')}</dd>
          </div>
        )}
        {s.reviewNote && (
          <div className={row}>
            <dt className="text-muted-foreground">{t('fields.note')}</dt>
            <dd className="whitespace-pre-line">{s.reviewNote}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 space-y-3 border-t border-border pt-4">
        {x.status === 'pending' && (
          <label className="block text-sm font-medium">
            {t('domain')}
            <input value={domain} onChange={(e) => setDomain(e.target.value)} maxLength={200} placeholder="skola.cz" className={`${inputClass} mt-1`} />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('domainHint')}</span>
          </label>
        )}
        <label className="block text-sm font-medium">
          {t('note')}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className={`${inputClass} mt-1`} />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('noteHint')}</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {x.status !== 'approved' && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => decideTeacher(x.id, 'approve', note.trim(), domain.trim()), t('approved'))}
              className={buttonClass.primary}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t('approve')}
            </button>
          )}
          {x.status !== 'rejected' && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => decideTeacher(x.id, 'reject', note.trim(), ''), t('rejected'))}
              className={buttonClass.secondary}
            >
              <X className="h-4 w-4" />
              {t('reject')}
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!s.suspendedAt && !window.confirm(t('suspendConfirm', { school: s.name }))) return;
              run(() => suspendSchool(s.id, !s.suspendedAt, note.trim()), s.suspendedAt ? t('unsuspended') : t('suspendedDone'));
            }}
            className={buttonClass.ghost}
          >
            {s.suspendedAt ? t('unsuspend') : t('suspend')}
          </button>
        </div>
      </div>
    </li>
  );
}
