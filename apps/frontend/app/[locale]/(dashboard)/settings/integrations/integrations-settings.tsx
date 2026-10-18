'use client';

import { useState, useTransition } from 'react';
import { CalendarDays, Copy, ExternalLink, KeyRound, Loader2, Plus, RefreshCw, Rss, Send, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { Link } from '@/i18n/navigation';
import { saveWebhooks, setFeed, testWebhook, type IntegrationsState, type Webhook, type WebhookKind } from '@/lib/integration-actions';
import { NOTIFICATION_EVENTS, type NotificationEvent } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { copyText } from '@/lib/clipboard';

type Draft = Omit<Webhook, 'id' | 'kind'> & { id?: string; kind?: WebhookKind; key: string };

const detectKind = (url: string): WebhookKind =>
  /^https:\/\/(\w+\.)?discord(app)?\.com\/api\/webhooks\//i.test(url) ? 'discord' : /^https:\/\/hooks\.slack\.com\//i.test(url) ? 'slack' : 'json';

const toDraft = (h: Webhook): Draft => ({ ...h, key: h.id });

export function IntegrationsSettings({ initial, siteUrl }: { initial: IntegrationsState; siteUrl: string }) {
  const t = useTranslations('settings.integrations');
  const tEvents = useTranslations('settings.notifications.events');
  const [token, setToken] = useState(initial.feedToken);
  const [hooks, setHooks] = useState<Draft[]>(initial.webhooks.map(toDraft));
  const [saved, setSaved] = useState(JSON.stringify(initial.webhooks.map(toDraft)));
  const [pending, start] = useTransition();
  const [testing, setTesting] = useState<string | null>(null);

  const dirty = JSON.stringify(hooks) !== saved;
  const feedBase = token ? `${siteUrl}/api/v1/feeds/${token}` : null;
  const calendarUrl = feedBase ? `${feedBase}/calendar.ics` : '';
  const rssUrl = feedBase ? `${feedBase}/invoices.rss` : '';
  const webcal = calendarUrl.replace(/^https?:/, 'webcal:');

  const copy = async (text: string) => {
    try {
      await copyText(text);
      toast({ text: t('copied'), tone: 'ok' });
    } catch {
      toast({ text: text, tone: 'info' });
    }
  };

  const feed = (on: boolean) =>
    start(async () => {
      const r = await setFeed(on);
      if (r.ok) {
        setToken(r.data.feedToken);
        toast({ text: on ? t('feed.created') : t('feed.disabled'), tone: 'ok' });
      } else toast({ text: `${t('saveFailed')}: ${r.error}`, tone: 'err' });
    });

  const update = (key: string, patch: Partial<Draft>) => setHooks((list) => list.map((h) => (h.key === key ? { ...h, ...patch } : h)));

  const add = () =>
    setHooks((list) => [
      ...list,
      { key: `new-${Date.now()}`, name: '', url: '', events: ['invoice_paid', 'invoice_overdue', 'invoice_viewed'], enabled: true }
    ]);

  const save = () =>
    start(async () => {
      const r = await saveWebhooks(
        hooks.map(({ id, name, url, events, enabled }) => ({ ...(id ? { id } : {}), name, url: url.trim(), events, enabled }))
      );
      if (r.ok) {
        const next = r.data.webhooks.map(toDraft);
        setHooks(next);
        setSaved(JSON.stringify(next));
        toast({ text: t('saved'), tone: 'ok' });
      } else {
        const known = ['https_only', 'private_host', 'invalid_url', 'too_many', 'two_factor_required'];
        toast({ text: known.includes(r.error) ? t(`errors.${r.error}`) : `${t('saveFailed')}: ${r.error}`, tone: 'err' });
      }
    });

  const test = async (id: string) => {
    setTesting(id);
    const r = await testWebhook(id);
    setTesting(null);
    if (r.ok && r.data.ok) toast({ text: t('webhooks.testOk'), tone: 'ok' });
    else toast({ text: t('webhooks.testFailed', { status: r.ok ? r.data.status : r.error }), tone: 'err' });
  };

  const card = 'mt-6 rounded-xl border border-border bg-card p-5';

  return (
    <>
      {/* ---------------------------------------------------------- feeds */}
      <section className={card}>
        <InfoHint hint={t('feed.hint')}>
          <h2 className="flex items-center gap-2 font-bold">
            <CalendarDays className="h-4 w-4 text-primary" />
            {t('feed.title')}
          </h2>
        </InfoHint>
        {!token ? (
          <div className="mt-3">
            <p className="text-sm text-muted-foreground">{t('feed.off')}</p>
            <button type="button" className={cn(buttonClass.primary, 'mt-3')} disabled={pending} onClick={() => feed(true)}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t('feed.enable')}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {[
              { key: 'calendar', url: calendarUrl, icon: CalendarDays },
              { key: 'rss', url: rssUrl, icon: Rss }
            ].map(({ key, url, icon: Icon }) => (
              <div key={key}>
                <InfoHint hint={t(`feed.${key}Hint`)}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {t(`feed.${key}`)}
                  </span>
                </InfoHint>
                <div className="mt-1.5 flex gap-2">
                  <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={cn(inputClass, 'font-mono text-xs')} />
                  <button type="button" className={buttonClass.secondary} onClick={() => copy(url)} title={t('copy')}>
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                {key === 'calendar' && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <a href={webcal} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" />
                      {t('feed.openCalendar')}
                    </a>
                    <a
                      href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t('feed.google')}
                    </a>
                  </div>
                )}
              </div>
            ))}
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{t('feed.secretNote')}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass.secondary} disabled={pending} onClick={() => feed(true)}>
                <RefreshCw className="h-4 w-4" />
                {t('feed.rotate')}
              </button>
              <button type="button" className={buttonClass.ghost} disabled={pending} onClick={() => feed(false)}>
                {t('feed.disable')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- webhooks */}
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <InfoHint hint={t('webhooks.hint')}>
            <h2 className="flex items-center gap-2 font-bold">
              <WebhookIcon className="h-4 w-4 text-primary" />
              {t('webhooks.title')}
            </h2>
          </InfoHint>
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {!initial.canManageWebhooks ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('webhooks.adminOnly')}</p>
        ) : (
          <>
            {hooks.length === 0 && <p className="mt-3 text-sm text-muted-foreground">{t('webhooks.empty')}</p>}
            <div className="mt-4 space-y-4">
              {hooks.map((h) => {
                const kind = h.kind && h.url === initial.webhooks.find((w) => w.id === h.id)?.url ? h.kind : detectKind(h.url);
                return (
                  <div key={h.key} className={cn('rounded-lg border border-border p-4', !h.enabled && 'opacity-70')}>
                    <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                      <label className="text-xs font-semibold text-muted-foreground">
                        {t('webhooks.name')}
                        <input
                          value={h.name}
                          maxLength={60}
                          placeholder={t('webhooks.namePlaceholder')}
                          onChange={(e) => update(h.key, { name: e.target.value })}
                          className={cn(inputClass, 'mt-1')}
                        />
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        <span className="flex items-center justify-between">
                          URL
                          {h.url && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">{t(`webhooks.kinds.${kind}`)}</span>}
                        </span>
                        <input
                          value={h.url}
                          maxLength={500}
                          placeholder="https://discord.com/api/webhooks/…"
                          onChange={(e) => update(h.key, { url: e.target.value })}
                          className={cn(inputClass, 'mt-1 font-mono text-xs')}
                        />
                      </label>
                    </div>
                    <fieldset className="mt-3">
                      <legend className="text-xs font-semibold text-muted-foreground">{t('webhooks.events')}</legend>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {NOTIFICATION_EVENTS.map((ev: NotificationEvent) => {
                          const on = h.events.includes(ev);
                          return (
                            <button
                              key={ev}
                              type="button"
                              aria-pressed={on}
                              onClick={() => update(h.key, { events: on ? h.events.filter((x) => x !== ev) : [...h.events, ev] })}
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                                on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                              )}
                            >
                              {tEvents(`${ev}.label`)}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                    {h.secret && (
                      <div className="mt-3">
                        <InfoHint hint={t('webhooks.secretHint')}>
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <KeyRound className="h-3 w-3" />
                            {t('webhooks.secret')}
                          </span>
                        </InfoHint>
                        <div className="mt-1 flex gap-2">
                          <input readOnly value={h.secret} className={cn(inputClass, 'font-mono text-xs')} onFocus={(e) => e.currentTarget.select()} />
                          <button type="button" className={buttonClass.secondary} onClick={() => copy(h.secret!)} title={t('copy')}>
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="mr-auto flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={h.enabled} onChange={(e) => update(h.key, { enabled: e.target.checked })} className="h-4 w-4 accent-primary" />
                        {t('webhooks.enabled')}
                      </label>
                      {h.id && (
                        <button
                          type="button"
                          className={buttonClass.secondary}
                          disabled={dirty || testing === h.id}
                          title={dirty ? t('webhooks.saveFirst') : undefined}
                          onClick={() => test(h.id!)}
                        >
                          {testing === h.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          {t('webhooks.test')}
                        </button>
                      )}
                      <button type="button" className={buttonClass.ghost} onClick={() => setHooks((list) => list.filter((x) => x.key !== h.key))}>
                        <Trash2 className="h-4 w-4" />
                        {t('webhooks.remove')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={buttonClass.secondary} onClick={add} disabled={hooks.length >= 10}>
                <Plus className="h-4 w-4" />
                {t('webhooks.add')}
              </button>
              <button type="button" className={buttonClass.primary} onClick={save} disabled={!dirty || pending}>
                {t('webhooks.save')}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ------------------------------------------------------------ API */}
      <section className={card}>
        <InfoHint hint={t('api.hint')}>
          <h2 className="flex items-center gap-2 font-bold">
            <KeyRound className="h-4 w-4 text-primary" />
            {t('api.title')}
          </h2>
        </InfoHint>
        <p className="mt-2 text-sm text-muted-foreground">{t('api.description')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/settings/api-keys" className={buttonClass.secondary}>
            {t('api.keys')}
          </Link>
          <a href={`${siteUrl}/api/docs`} target="_blank" rel="noreferrer" className={buttonClass.ghost}>
            <ExternalLink className="h-4 w-4" />
            {t('api.docs')}
          </a>
        </div>
      </section>
    </>
  );
}
