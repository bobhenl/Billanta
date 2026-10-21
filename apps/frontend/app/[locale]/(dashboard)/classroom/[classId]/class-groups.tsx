'use client';

import { useState } from 'react';
import { ExternalLink, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import type { ClassDetail } from '@/lib/classroom';
import {
  addTeamMember,
  assignAccountant,
  createCompany,
  createTeam,
  deleteCompany,
  deleteTeam,
  pairPartners,
  removeTeamMember,
  unassignAccountant
} from '../actions';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
type Run = <T>(action: () => Promise<Result<T>>, done?: (data: T) => void) => void;

/**
 * Phase 2 of the class page (docs/classroom-mode-plan.md §8): teams sharing
 * a company, extra companies to trade with, and students keeping another
 * company's books. Every teacher of the class may arrange these.
 */
export function ClassGroups({
  detail,
  pending,
  run,
  openCompany,
  kindTitle,
  columns
}: {
  detail: ClassDetail;
  pending: boolean;
  run: Run;
  openCompany: (tenantId: string) => void;
  kindTitle: (kind: string) => string;
  columns: string[];
}) {
  const t = useTranslations('classroom.groups');
  const [teamName, setTeamName] = useState('');
  const [owner, setOwner] = useState('');
  const [kind, setKind] = useState(detail.kinds[0] ?? '');
  const [label, setLabel] = useState('');
  const [partnerA, setPartnerA] = useState('');
  const [partnerB, setPartnerB] = useState('');
  const [accStudent, setAccStudent] = useState('');
  const [accCompany, setAccCompany] = useState('');
  const [accMode, setAccMode] = useState<string>(detail.accountantModes.includes('bookkeeper') ? 'bookkeeper' : (detail.accountantModes[0] ?? 'review'));
  const closed = pending || detail.ended;

  const nick = (studentId: string | null) => detail.students.find((s) => s.id === studentId)?.nickname ?? '?';
  const teamOf = (teamId: string | null) => detail.teams.find((x) => x.id === teamId);
  const inTeam = new Set(detail.teams.flatMap((x) => x.studentIds));

  /** Every company of the class under one name: the home ones by nickname, the others by label or kind and owner. */
  const companies = [
    ...detail.students.map((s) => ({ tenantId: s.tenantId, name: `${s.nickname} · ${kindTitle(s.kind)}` })),
    ...detail.companies.map((c) => {
      const who = c.teamId ? t('teamOwner', { name: teamOf(c.teamId)?.name ?? '?' }) : nick(c.studentId);
      return { tenantId: c.tenantId, name: `${c.label || kindTitle(c.kind)} · ${who}` };
    })
  ];
  const companyName = (tenantId: string) => companies.find((c) => c.tenantId === tenantId)?.name ?? '?';
  const done = (c: { progress: Record<string, number> }) => columns.filter((m) => (c.progress[m] ?? 0) > 0).length;

  function submitCompany() {
    const [type, id] = owner.split(':');
    run(
      () => createCompany(detail.id, { ...(type === 't' ? { teamId: id } : { studentId: id }), kind, label: label.trim() || undefined }),
      () => {
        setLabel('');
        toast({ text: t('companies.created'), tone: 'ok' });
      }
    );
  }

  const companySelect = (value: string, set: (v: string) => void, aria: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} className={`${inputClass} sm:w-64`} aria-label={aria}>
      <option value="">{aria}</option>
      {companies.map((c) => (
        <option key={c.tenantId} value={c.tenantId}>
          {c.name}
        </option>
      ))}
    </select>
  );

  if (detail.students.length === 0) return null;

  return (
    <>
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('teams.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('teams.body')}</p>
        {detail.teams.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('teams.empty')}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {detail.teams.map((team) => (
              <li key={team.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{team.name}</span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => window.confirm(t('teams.deleteConfirm', { name: team.name })) && run(() => deleteTeam(detail.id, team.id))}
                    className={buttonClass.ghost}
                    title={t('teams.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">{t('teams.delete')}</span>
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {team.studentIds.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                      {nick(id)}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => removeTeamMember(detail.id, team.id, id))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={t('teams.removeMember', { name: nick(id) })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <select
                    value=""
                    disabled={closed}
                    onChange={(e) => e.target.value && run(() => addTeamMember(detail.id, team.id, e.target.value))}
                    className={`${inputClass} h-8 w-auto py-0 text-xs`}
                    aria-label={t('teams.addMember')}
                  >
                    <option value="">{t('teams.addMember')}</option>
                    {detail.students
                      .filter((s) => !inTeam.has(s.id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nickname}
                        </option>
                      ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (teamName.trim()) run(() => createTeam(detail.id, teamName.trim()), () => setTeamName(''));
          }}
        >
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={40} placeholder={t('teams.name')} className={`${inputClass} sm:w-64`} aria-label={t('teams.name')} />
          <button type="submit" disabled={closed || !teamName.trim()} className={buttonClass.secondary}>
            {t('teams.create')}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('companies.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('companies.body')}</p>
        {detail.companies.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('companies.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {detail.companies.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{c.label || kindTitle(c.kind)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.teamId ? t('teamOwner', { name: teamOf(c.teamId)?.name ?? '?' }) : nick(c.studentId)} · {kindTitle(c.kind)} ·{' '}
                    {t('companies.progress', { n: done(c), max: columns.length })}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" disabled={pending} onClick={() => openCompany(c.tenantId)} className={buttonClass.ghost} title={t('companies.open')}>
                    <ExternalLink className="h-4 w-4" />
                    <span className="sr-only">{t('companies.open')}</span>
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => window.confirm(t('companies.deleteConfirm', { name: c.label || kindTitle(c.kind) })) && run(() => deleteCompany(detail.id, c.id))}
                    className={buttonClass.ghost}
                    title={t('companies.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">{t('companies.delete')}</span>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={`${inputClass} sm:w-56`} aria-label={t('companies.owner')}>
            <option value="">{t('companies.owner')}</option>
            {detail.teams.map((x) => (
              <option key={x.id} value={`t:${x.id}`}>
                {t('teamOwner', { name: x.name })}
              </option>
            ))}
            {detail.students.map((s) => (
              <option key={s.id} value={`s:${s.id}`}>
                {s.nickname}
              </option>
            ))}
          </select>
          {detail.kinds.length > 1 && (
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputClass} sm:w-56`} aria-label={t('companies.kind')}>
              {detail.kinds.map((k) => (
                <option key={k} value={k}>
                  {kindTitle(k)}
                </option>
              ))}
            </select>
          )}
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder={t('companies.label')} className={`${inputClass} sm:w-56`} aria-label={t('companies.label')} />
          <button type="button" disabled={closed || !owner || !kind} onClick={submitCompany} className={buttonClass.secondary}>
            {t('companies.create')}
          </button>
        </div>

        <h3 className="mt-5 text-sm font-bold">{t('partners.title')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('partners.body')}</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {companySelect(partnerA, setPartnerA, t('partners.a'))}
          {companySelect(partnerB, setPartnerB, t('partners.b'))}
          <button
            type="button"
            disabled={closed || !partnerA || !partnerB || partnerA === partnerB}
            onClick={() => run(() => pairPartners(detail.id, partnerA, partnerB), (d) => toast({ text: t('partners.done', { n: d.added }), tone: 'ok' }))}
            className={buttonClass.secondary}
          >
            {t('partners.submit')}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('accountants.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('accountants.body')}</p>
        {detail.accountants.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('accountants.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {detail.accountants.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block">{t('accountants.row', { student: nick(a.studentId), company: companyName(a.tenantId) })}</span>
                  <span className="block text-xs text-muted-foreground">{t(`accountants.modes.${a.mode}.title`)}</span>
                </span>
                <button type="button" disabled={pending} onClick={() => run(() => unassignAccountant(detail.id, a.id))} className={buttonClass.ghost} title={t('accountants.remove')}>
                  <X className="h-4 w-4" />
                  <span className="sr-only">{t('accountants.remove')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <select value={accStudent} onChange={(e) => setAccStudent(e.target.value)} className={`${inputClass} sm:w-48`} aria-label={t('accountants.student')}>
            <option value="">{t('accountants.student')}</option>
            {detail.students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nickname}
              </option>
            ))}
          </select>
          {companySelect(accCompany, setAccCompany, t('accountants.company'))}
          {detail.accountantModes.length > 1 && (
            <select value={accMode} onChange={(e) => setAccMode(e.target.value)} className={`${inputClass} sm:w-48`} aria-label={t('accountants.mode')}>
              {detail.accountantModes.map((m) => (
                <option key={m} value={m}>
                  {t(`accountants.modes.${m}.title`)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={closed || !accStudent || !accCompany}
            onClick={() => run(() => assignAccountant(detail.id, { studentId: accStudent, tenantId: accCompany, mode: accMode }))}
            className={buttonClass.secondary}
          >
            {t('accountants.assign')}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t(`accountants.modes.${accMode}.hint`)}</p>
      </section>
    </>
  );
}
