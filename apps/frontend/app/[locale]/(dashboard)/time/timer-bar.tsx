'use client';

import { useEffect, useState, useTransition } from 'react';
import { Play, Plus, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from '@/components/toaster';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { formatElapsed, formatMinutes, type Project, type RunningTimer } from '@/lib/time-ui';
import { cn } from '@/lib/utils';
import { startTimer, stopTimer } from './actions';
import { EntryModal } from './entry-modal';

/** Start/stop timer, plus "add by hand". One running timer per person. */
export function TimerBar({ running, projects }: { running: RunningTimer | null; projects: Project[] }) {
  const t = useTranslations('time');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [manual, setManual] = useState(false);
  // Clock starts after mount so the server and client render the same text.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast({ text: r.error ?? t('error'), tone: 'err' });
      else done?.();
      router.refresh();
    });

  const elapsed = running && now != null ? (now - new Date(running.startedAt).getTime()) / 1000 : null;

  return (
    <div className="mt-5 rounded-xl border border-border bg-card p-3 sm:p-4">
      {running ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">
            {/* The ping says "recording"; with reduced motion the solid dot says it alone. */}
            <span className="absolute inline-flex h-full w-full rounded-full bg-destructive/60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{running.description || t('noDescription')}</div>
            <div className="truncate text-xs text-muted-foreground">{running.projectName ?? t('noProject')}</div>
          </div>
          <div className="font-mono text-2xl font-extrabold tabular-nums" aria-live="off">
            {elapsed == null ? '–:––:––' : formatElapsed(elapsed)}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => stopTimer(running.id),
                () => toast({ text: t('stopped', { time: formatMinutes(Math.max(1, Math.round((elapsed ?? 0) / 60))) }), tone: 'ok' })
              )
            }
            className={cn(buttonClass.danger, 'h-10')}
          >
            <Square className="h-4 w-4 fill-current" />
            {t('stop')}
          </button>
        </div>
      ) : (
        <form
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem] lg:grid-cols-[minmax(0,1fr)_12rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => startTimer({ description: description.trim(), project_id: projectId || null }),
              () => setDescription('')
            );
          }}
        >
          <input
            className={cn(inputClass, 'h-10 min-w-0')}
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('whatAreYouWorkingOn')}
            aria-label={t('columns.description')}
          />
          <select className={cn(inputClass, 'h-10 min-w-0')} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={t('columns.project')}>
            <option value="">{t('noProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
            <button type="submit" disabled={pending} className={cn(buttonClass.primary, 'h-10 flex-1 sm:flex-none')}>
              <Play className="h-4 w-4 fill-current" />
              {t('start')}
            </button>
            {/* Starting the clock is the everyday action; a hand-made entry is the (+) beside it on a phone. */}
            <button
              type="button"
              onClick={() => setManual(true)}
              aria-label={t('addManual')}
              title={t('addManual')}
              className={cn(buttonClass.secondary, 'h-10 w-10 shrink-0 whitespace-nowrap px-0 sm:w-auto sm:px-4')}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t('addManual')}</span>
            </button>
          </div>
        </form>
      )}
      <EntryModal open={manual} onClose={() => setManual(false)} projects={projects} />
    </div>
  );
}
