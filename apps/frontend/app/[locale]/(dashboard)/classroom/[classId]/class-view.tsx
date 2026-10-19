'use client';

import { useState, useTransition } from 'react';
import { Copy, Download, ExternalLink, KeyRound, RefreshCw, Trash2, UserMinus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { copyText } from '@/lib/clipboard';
import type { ClassDetail, ClassroomTrack } from '@/lib/classroom';
import {
  addCoTeacher,
  deleteClass,
  extendClass,
  newStudentCode,
  openStudentCompany,
  removeCoTeacher,
  removeStudent,
  rotateJoinCode,
  updateClass
} from '../actions';

/** Which progress columns a track shows; the backend counts all of them. */
const TRACK_COLUMNS: Record<ClassroomTrack, string[]> = {
  basic: ['contact_created', 'invoice_issued', 'invoice_paid'],
  standard: [
    'contact_created',
    'invoice_issued',
    'invoice_vat',
    'proforma_converted',
    'quote_created',
    'credit_note_issued',
    'invoice_paid',
    'bank_matched',
    'expense_recorded'
  ],
  advanced: []
};

type Colleague = { id: string; name: string; subject: string | null };

/**
 * The class page's interactive part. Co-teachers and deleting are the
 * owner's; the rest is open to every teacher of the class. Opening a
 * student's company switches the active company to it (the teacher is a
 * viewer there); the banner inside leads back.
 */
export function ClassView({ detail, colleagues }: { detail: ClassDetail; colleagues: Colleague[] }) {
  const t = useTranslations('classroom.detail');
  const tTracks = useTranslations('classroom.tracks');
  const tMilestones = useTranslations('classroom.milestones');
  const tErr = useTranslations('classroom.errors');
  const tKinds = useTranslations('demo.kinds');
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [extendTo, setExtendTo] = useState('');
  const [coTeacher, setCoTeacher] = useState('');

  const columns = TRACK_COLUMNS[detail.track].length ? TRACK_COLUMNS[detail.track].filter((m) => detail.milestones.includes(m)) : detail.milestones;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const kindTitle = (k: string) => (tKinds.has(`${k}.title`) ? tKinds(`${k}.title`) : k);
  const free = colleagues.filter((c) => !detail.coTeachers.some((x) => x.id === c.id) && c.id !== detail.owner.id);

  /** Runs one action, shows its error, refreshes the page data on success. */
  function run<T>(action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, done?: (data: T) => void) {
    start(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ text: tErr.has(result.error) ? tErr(result.error) : tErr('generic'), tone: 'err' });
        return;
      }
      done?.(result.data);
      router.refresh();
    });
  }

  async function copy(text: string) {
    await copyText(text);
    toast({ text: t('copied'), tone: 'ok' });
  }

  function openCompany(tenantId: string) {
    start(async () => {
      const result = await openStudentCompany(tenantId);
      if (!result.ok) {
        toast({ text: tErr('generic'), tone: 'err' });
        return;
      }
      router.push('/dashboard');
      router.refresh();
    });
  }

  return (
    <div className="mt-3 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{detail.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {detail.school.name} · {tTracks(`${detail.track}.title`)} · {t('owner', { name: detail.owner.name })}
        </p>
      </div>

      {detail.ended ? (
        <Banner tone="warn" title={t('endedTitle')}>
          {t('endedBody', { date: date(detail.deletesAt) })}
        </Banner>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-bold">{t('join.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('join.body')}</p>
          <p className="mt-3 select-all font-mono text-2xl font-extrabold tracking-widest">{detail.joinCode}</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{detail.joinUrl}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy(detail.joinUrl)} className={buttonClass.secondary}>
              <Copy className="h-4 w-4" />
              {t('join.copy')}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => window.confirm(t('join.rotateConfirm')) && run(() => rotateJoinCode(detail.id))}
              className={buttonClass.ghost}
            >
              <RefreshCw className="h-4 w-4" />
              {t('join.rotate')}
            </button>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={detail.enrolmentOpen}
              disabled={pending || detail.ended}
              onChange={(e) => run(() => updateClass(detail.id, { enrolmentOpen: e.target.checked }))}
            />
            {t('join.open', { n: detail.students.length, max: detail.maxStudents })}
          </label>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-bold">{t('retention.title')}</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('retention.endsAt')}</dt>
            <dd className="font-semibold">{date(detail.endsAt)}</dd>
            <dt className="text-muted-foreground">{t('retention.deletesAt')}</dt>
            <dd className="font-semibold">{date(detail.deletesAt)}</dd>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{t('retention.body')}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="date" value={extendTo} onChange={(e) => setExtendTo(e.target.value)} className={`${inputClass} sm:w-44`} aria-label={t('retention.pickDate')} />
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => extendClass(detail.id, extendTo || undefined), () => toast({ text: t('retention.extended'), tone: 'ok' }))}
              className={buttonClass.secondary}
            >
              {extendTo ? t('retention.extendTo') : t('retention.extend')}
            </button>
          </div>
          <a href={`/api/files/classroom/classes/${detail.id}/progress.csv`} className={`${buttonClass.ghost} mt-2 px-0`}>
            <Download className="h-4 w-4" />
            {t('retention.download')}
          </a>
        </div>
      </section>

      {shownCode && (
        <Banner tone="info" title={t('students.newCodeTitle')}>
          <span className="font-mono text-lg font-bold tracking-widest">{shownCode}</span>
          <span className="block text-xs">{t('students.newCodeBody')}</span>
        </Banner>
      )}

      <section>
        <h2 className="text-lg font-bold">{t('students.title', { n: detail.students.length })}</h2>
        {detail.students.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('students.empty')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">{t('students.nickname')}</th>
                  <th className="px-3 py-2 font-semibold">{t('students.code')}</th>
                  {columns.map((m) => (
                    <th key={m} className="px-2 py-2 text-center font-semibold" title={tMilestones(m)}>
                      <span className="block max-w-[6rem] truncate">{tMilestones(m)}</span>
                    </th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {detail.students.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <span className="block font-semibold">{s.nickname}</span>
                      <span className="block text-xs text-muted-foreground">{kindTitle(s.kind)}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
                    {columns.map((m) => {
                      const n = s.progress[m] ?? 0;
                      return (
                        <td key={m} className="px-2 py-2 text-center">
                          <span className={n > 0 ? 'font-bold text-success' : 'text-muted-foreground'} aria-label={`${tMilestones(m)}: ${n}`}>
                            {n > 0 ? n : '·'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      <span className="flex justify-end gap-1">
                        <button type="button" disabled={pending} onClick={() => openCompany(s.tenantId)} className={buttonClass.ghost} title={t('students.open')}>
                          <ExternalLink className="h-4 w-4" />
                          <span className="sr-only">{t('students.open')}</span>
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => window.confirm(t('students.newCodeConfirm', { name: s.nickname })) && run(() => newStudentCode(detail.id, s.id), (d) => setShownCode(d.code))}
                          className={buttonClass.ghost}
                          title={t('students.newCode')}
                        >
                          <KeyRound className="h-4 w-4" />
                          <span className="sr-only">{t('students.newCode')}</span>
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => window.confirm(t('students.removeConfirm', { name: s.nickname })) && run(() => removeStudent(detail.id, s.id))}
                          className={buttonClass.ghost}
                          title={t('students.remove')}
                        >
                          <UserMinus className="h-4 w-4" />
                          <span className="sr-only">{t('students.remove')}</span>
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {t('students.kinds', { kinds: detail.kinds.map(kindTitle).join(', ') })}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('teachers.title')}</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            {detail.owner.name} <span className="text-xs text-muted-foreground">({t('teachers.ownerLabel')})</span>
          </li>
          {detail.coTeachers.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              {c.name}
              {detail.isOwner && (
                <button type="button" disabled={pending} onClick={() => run(() => removeCoTeacher(detail.id, c.id))} className="text-xs text-destructive hover:underline">
                  {t('teachers.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {detail.isOwner &&
          (free.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select value={coTeacher} onChange={(e) => setCoTeacher(e.target.value)} className={`${inputClass} sm:w-64`} aria-label={t('teachers.pick')}>
                <option value="">{t('teachers.pick')}</option>
                {free.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.subject ? `${c.name} (${c.subject})` : c.name}
                  </option>
                ))}
              </select>
              <button type="button" disabled={pending || !coTeacher} onClick={() => run(() => addCoTeacher(detail.id, coTeacher), () => setCoTeacher(''))} className={buttonClass.secondary}>
                {t('teachers.add')}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">{t('teachers.none')}</p>
          ))}
      </section>

      {detail.isOwner && (
        <section className="rounded-xl border border-destructive/30 p-4">
          <h2 className="font-bold">{t('delete.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('delete.body')}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              window.confirm(t('delete.confirm', { name: detail.name })) &&
              start(async () => {
                const result = await deleteClass(detail.id);
                if (!result.ok) {
                  toast({ text: tErr.has(result.error) ? tErr(result.error) : tErr('generic'), tone: 'err' });
                  return;
                }
                router.push('/classroom');
              })
            }
            className={`${buttonClass.danger} mt-3`}
          >
            <Trash2 className="h-4 w-4" />
            {t('delete.submit')}
          </button>
        </section>
      )}
    </div>
  );
}
