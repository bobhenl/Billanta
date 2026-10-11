'use client';

import { useEffect, useState, useTransition } from 'react';
import { Bell, BellRing, Loader2, Mail, MonitorSmartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { saveNotificationPrefs } from '@/lib/notification-actions';
import { NOTIFICATION_EVENTS, type NotificationEvent, type NotificationPrefs } from '@/lib/notifications';
import { cn } from '@/lib/utils';

type Channel = 'app' | 'email';

/**
 * Event × channel grid. Every toggle saves at once (the backend merges the
 * patch), so there is no Save button to forget.
 */
export function NotificationSettings({ prefs: initial }: { prefs: NotificationPrefs }) {
  const t = useTranslations('settings.notifications');
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setPermission('Notification' in window ? Notification.permission : 'unsupported');
  }, []);

  const patch = (body: Parameters<typeof saveNotificationPrefs>[0], optimistic: NotificationPrefs) => {
    const before = prefs;
    setPrefs(optimistic);
    start(async () => {
      const result = await saveNotificationPrefs(body);
      if (result.ok) {
        setPrefs(result.data);
        toast({ text: t('saved'), tone: 'ok' });
      } else {
        setPrefs(before);
        toast({ text: `${t('saveFailed')}: ${result.error}`, tone: 'err' });
      }
    });
  };

  const toggle = (event: NotificationEvent, channel: Channel) => {
    const value = !prefs.events[event][channel];
    patch(
      { events: { [event]: { [channel]: value } } },
      { ...prefs, events: { ...prefs.events, [event]: { ...prefs.events[event], [channel]: value } } }
    );
  };

  const setAll = (channel: Channel, value: boolean) => {
    const events = Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, { [channel]: value }]));
    patch(
      { events },
      { ...prefs, events: Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, { ...prefs.events[e], [channel]: value }])) as NotificationPrefs['events'] }
    );
  };

  const askBrowser = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      new Notification(t('testTitle'), { body: t('testBody'), icon: '/icon.svg' });
      if (!prefs.browserPopups) patch({ browser_popups: true }, { ...prefs, browserPopups: true });
    }
  };

  const card = 'mt-6 rounded-xl border border-border bg-card p-5';
  const channels: { key: Channel; icon: typeof Bell }[] = [
    { key: 'app', icon: Bell },
    { key: 'email', icon: Mail }
  ];

  return (
    <>
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <InfoHint hint={t('eventsHint')}>
            <h2 className="font-bold">{t('eventsTitle')}</h2>
          </InfoHint>
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-semibold" />
                {channels.map(({ key, icon: Icon }) => {
                  const allOn = NOTIFICATION_EVENTS.every((e) => prefs.events[e][key]);
                  return (
                    <th key={key} className="w-24 pb-2 text-center font-semibold">
                      <span className="inline-flex items-center gap-1">
                        <Icon className="h-3.5 w-3.5" />
                        {t(`channels.${key}`)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAll(key, !allOn)}
                        className="mt-0.5 block w-full text-[11px] font-normal text-primary hover:underline"
                      >
                        {allOn ? t('noneOn') : t('allOn')}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENTS.map((event) => (
                <tr key={event} className="border-t border-border/60">
                  <td className="py-2 pr-2">
                    <InfoHint hint={t(`events.${event}.hint`)}>
                      <span>{t(`events.${event}.label`)}</span>
                    </InfoHint>
                  </td>
                  {channels.map(({ key }) => (
                    <td key={key} className="py-2 text-center">
                      <Toggle on={prefs.events[event][key]} onChange={() => toggle(event, key)} label={`${t(`events.${event}.label`)} – ${t(`channels.${key}`)}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <InfoHint hint={t('browserHint')}>
          <h2 className="flex items-center gap-2 font-bold">
            <MonitorSmartphone className="h-4 w-4 text-primary" />
            {t('browserTitle')}
          </h2>
        </InfoHint>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Toggle
              on={prefs.browserPopups}
              onChange={() => patch({ browser_popups: !prefs.browserPopups }, { ...prefs, browserPopups: !prefs.browserPopups })}
              label={t('browserToggle')}
            />
            {t('browserToggle')}
          </label>
          {permission === 'granted' ? (
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t('permission.granted')}</span>
          ) : permission === 'denied' ? (
            <span className="text-xs text-muted-foreground">{t('permission.denied')}</span>
          ) : permission === 'unsupported' ? (
            <span className="text-xs text-muted-foreground">{t('permission.unsupported')}</span>
          ) : (
            <button type="button" onClick={askBrowser} className={buttonClass.secondary}>
              <BellRing className="h-4 w-4" />
              {t('permission.ask')}
            </button>
          )}
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
