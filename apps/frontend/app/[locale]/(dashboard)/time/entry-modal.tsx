'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { InfoHint } from '@/components/info-hint';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { formatMinutes, parseDuration, type Project, type TimeEntry } from '@/lib/time-ui';
import { createEntry, updateEntry } from './actions';

const field = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const label = 'mb-1 block text-xs font-semibold text-muted-foreground';

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Add a block of work by hand, or edit one that is not invoiced yet. */
export function EntryModal({ open, onClose, projects, entry }: { open: boolean; onClose: () => void; projects: Project[]; entry?: TimeEntry | null }) {
  const t = useTranslations('time');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [day, setDay] = useState('');
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [rate, setRate] = useState('');
  const [billable, setBillable] = useState(true);

  useEffect(() => {
    if (!open) return;
    const start = entry ? new Date(entry.startedAt) : null;
    setDay(start ? localDay(start) : localDay(new Date()));
    setTime(start ? localTime(start) : '09:00');
    setDuration(entry ? formatMinutes(entry.minutes) : '');
    setDescription(entry?.description ?? '');
    setProjectId(entry?.projectId ?? '');
    setRate(entry?.hourlyRate ? String(Number(entry.hourlyRate)) : '');
    setBillable(entry?.billable ?? true);
  }, [open, entry]);

  const minutes = parseDuration(duration);
  const project = projects.find((p) => p.id === projectId);
  const invalid = !day || !minutes || minutes < 1;

  const save = () =>
    startTransition(async () => {
      const startedAt = new Date(`${day}T${time || '09:00'}`);
      const body = {
        description: description.trim(),
        project_id: projectId || null,
        hourly_rate: rate ? Number(rate.replace(',', '.')) : null,
        billable,
        started_at: startedAt.toISOString(),
        minutes: minutes ?? 0
      };
      const r = entry ? await updateEntry(entry.id, body) : await createEntry(body);
      if (!r.ok) {
        toast({ text: r.error, tone: 'err' });
        return;
      }
      toast({ text: entry ? t('saved') : t('added'), tone: 'ok' });
      onClose();
      router.refresh();
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? t('editEntry') : t('addManual')}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={pending || invalid}
            onClick={save}
            className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {t('save')}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="block">
          <span className={label}>{t('columns.description')}</span>
          <input className={field} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder={t('whatAreYouWorkingOn')} />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 block sm:col-span-1">
            <span className={label}>{t('columns.date')}</span>
            <input type="date" className={field} value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>{t('from')}</span>
            <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label className="col-span-2 block sm:col-span-1">
            <InfoHint hint={t('durationHint')} className={label}>
              <span>{t('columns.duration')}</span>
            </InfoHint>
            <input
              className={field}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="1:30"
              inputMode="decimal"
              aria-invalid={!!duration && !minutes}
            />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className={label}>{t('columns.project')}</span>
            <select className={field} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t('noProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <InfoHint hint={t('rateHint')} className={label}>
              <span>
                {t('columns.rate')} ({project?.currency ?? 'CZK'}/h)
              </span>
            </InfoHint>
            <input
              className={field}
              value={rate}
              inputMode="decimal"
              onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ''))}
              placeholder={project?.hourlyRate ? String(Number(project.hourlyRate)) : '0'}
            />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
          <span>{t('billable')}</span>
        </label>
        {minutes ? <p className="text-xs text-muted-foreground">{t('durationRead', { time: formatMinutes(minutes) })}</p> : null}
      </div>
    </Modal>
  );
}
