'use client';

import { useState, useTransition } from 'react';
import { Loader2, Lock, MoonStar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { Link } from '@/i18n/navigation';
import { saveEmailPrefs } from '@/lib/email-prefs-actions';
import type { EmailPrefs, EmailTypeRow } from '@/lib/notifications';
import { cn } from '@/lib/utils';

const GROUPS: EmailTypeRow['group'][] = ['activity', 'digest', 'account', 'customers'];

// Members are almost all in CZ/SK; the current value is added if it is something else.
const TIME_ZONES = ['Europe/Prague', 'Europe/Bratislava', 'Europe/Vienna', 'Europe/Berlin', 'Europe/London', 'UTC'];

/**
 * One switch per e-mail type. Toggles save at once like Settings → Notifikace;
 * quiet hours have a Save button because a half-typed time is not valid.
 */
export function EmailNotificationSettings({ prefs: initial }: { prefs: EmailPrefs }) {
  const t = useTranslations('settings.emailNotifications');
  const tEvents = useTranslations('settings.notifications.events');
  const [prefs, setPrefs] = useState(initial);
  const [quiet, setQuiet] = useState(initial.quietHours);
  const [pending, start] = useTransition();

  const save = (body: Parameters<typeof saveEmailPrefs>[0], optimistic?: EmailPrefs) => {
    const before = prefs;
    if (optimistic) setPrefs(optimistic);
    start(async () => {
      const result = await saveEmailPrefs(body);
      if (result.ok) {
        setPrefs(result.data);
        setQuiet(result.data.quietHours);
        toast({ text: t('saved'), tone: 'ok' });
      } else {
        setPrefs(before);
        toast({ text: t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('saveFailed'), tone: 'err' });
      }
    });
  };

  const toggle = (row: EmailTypeRow) => {
    if (row.locked) return;
    const enabled = !row.enabled;
    save(
      { types: { [row.type]: enabled } },
      { ...prefs, types: prefs.types.map((r) => (r.type === row.type ? { ...r, enabled } : r)) }
    );
  };

  const label = (row: EmailTypeRow) => (row.group === 'activity' ? tEvents(`${row.type}.label`) : t(`types.${row.type}.label`));
  const hint = (row: EmailTypeRow) => (row.group === 'activity' ? tEvents(`${row.type}.hint`) : t(`types.${row.type}.hint`));

  const quietChanged =
    quiet.enabled !== prefs.quietHours.enabled ||
    quiet.start !== prefs.quietHours.start ||
    quiet.end !== prefs.quietHours.end ||
    quiet.timeZone !== prefs.quietHours.timeZone;
  const zones = TIME_ZONES.includes(quiet.timeZone) ? TIME_ZONES : [quiet.timeZone, ...TIME_ZONES];
  const card = 'mt-6 rounded-xl border border-border bg-card p-5';

  return (
    <>
      <p className="mt-4 text-sm text-muted-foreground">
        {t.rich('otherChannels', { link: (chunks) => <Link href="/settings/notifications" className="text-primary hover:underline">{chunks}</Link> })}
      </p>

      {GROUPS.map((group) => {
        const rows = prefs.types.filter((r) => r.group === group);
        if (rows.length === 0) return null;
        return (
          <section key={group} className={card}>
            <div className="flex items-center justify-between gap-3">
              <InfoHint hint={t(`groups.${group}.hint`)}>
                <h2 className="font-bold">{t(`groups.${group}.title`)}</h2>
              </InfoHint>
              {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <ul className="mt-3">
              {rows.map((row) => (
                <li key={row.type} className="flex items-center justify-between gap-3 border-t border-border/60 py-2.5 text-sm first:border-t-0">
                  <InfoHint hint={hint(row)}>
                    <span className={cn(row.locked && 'text-muted-foreground')}>{label(row)}</span>
                  </InfoHint>
                  {row.locked ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title={t('lockedHint')}>
                      <Lock className="h-3.5 w-3.5" aria-hidden />
                      {t('locked')}
                    </span>
                  ) : (
                    <Toggle on={row.enabled} onChange={() => toggle(row)} label={label(row)} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className={card}>
        <InfoHint hint={t('quiet.hint')}>
          <h2 className="flex items-center gap-2 font-bold">
            <MoonStar className="h-4 w-4 text-primary" />
            {t('quiet.title')}
          </h2>
        </InfoHint>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <Toggle on={quiet.enabled} onChange={() => setQuiet({ ...quiet, enabled: !quiet.enabled })} label={t('quiet.toggle')} />
          {t('quiet.toggle')}
        </label>
        <div className={cn('mt-3 grid gap-3 sm:grid-cols-3', !quiet.enabled && 'opacity-60')}>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('quiet.from')}</span>
            <input type="time" className={inputClass} value={quiet.start} disabled={!quiet.enabled} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('quiet.to')}</span>
            <input type="time" className={inputClass} value={quiet.end} disabled={!quiet.enabled} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('quiet.timeZone')}</span>
            <select className={inputClass} value={quiet.timeZone} disabled={!quiet.enabled} onChange={(e) => setQuiet({ ...quiet, timeZone: e.target.value })}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('quiet.note')}</p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className={buttonClass.primary}
            disabled={pending || !quietChanged || !/^\d\d:\d\d$/.test(quiet.start) || !/^\d\d:\d\d$/.test(quiet.end)}
            onClick={() => save({ quiet_hours: { enabled: quiet.enabled, start: quiet.start, end: quiet.end, time_zone: quiet.timeZone } })}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('quiet.save')}
          </button>
        </div>
      </section>
    </>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors', on ? 'bg-primary' : 'bg-border')}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}
