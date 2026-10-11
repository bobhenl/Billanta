'use client';

import { useState, useTransition } from 'react';
import { Check, KeyRound, Loader2, PowerOff, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { cn } from '@/lib/utils';
import type { AiSettings } from '../../invoices/new/types';
import { saveAiSettings } from './actions';

const API_EXAMPLE = (text: string) =>
  ['POST /api/v1/ai/invoice-suggestion', 'Authorization: Bearer sk_live_…', 'Content-Type: application/json', '', JSON.stringify({ text })].join('\n');

/**
 * Choose how AI pre-fill is powered: the company's own Anthropic key (first,
 * since it is always available and has no daily cap), Billanta's key (when
 * the deployment has one, within a daily fair-use limit), or off. The key is
 * write-only from here: the backend verifies it, stores it encrypted and only
 * ever shows its last four characters back.
 */
export function AiSettingsForm({ initial }: { initial: AiSettings }) {
  const t = useTranslations('settings.ai');
  const [settings, setSettings] = useState(initial);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = (input: Parameters<typeof saveAiSettings>[0]) => {
    setError(null);
    start(async () => {
      const result = await saveAiSettings(input);
      if (result.ok) {
        setSettings(result.settings);
        setKey('');
        toast(t('saved'));
      } else {
        setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.save_failed'));
      }
    });
  };

  const options = [
    {
      mode: 'own' as const,
      icon: KeyRound,
      disabled: !settings.hasOwnKey,
      note: settings.hasOwnKey ? t('own.saved', { last4: settings.ownKeyLast4 ?? '' }) : t('own.needsKey')
    },
    {
      mode: 'platform' as const,
      icon: Sparkles,
      disabled: !settings.platformAvailable,
      note: settings.platformAvailable ? t('platform.limit', { limit: settings.platformDailyLimit }) : t('platform.unavailable')
    },
    { mode: 'off' as const, icon: PowerOff, disabled: false, note: t('off.note') }
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <InfoHint hint={t('keyHint')}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('keyTitle')}</h2>
        </InfoHint>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (key.trim()) save({ apiKey: key.trim(), mode: 'own' });
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={settings.hasOwnKey ? `sk-ant-…${settings.ownKeyLast4 ?? ''}` : 'sk-ant-…'}
            aria-label={t('keyTitle')}
            className="h-10 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="submit"
            disabled={pending || key.trim().length < 20}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('keySave')}
          </button>
        </form>
        {settings.hasOwnKey && (
          <button
            type="button"
            disabled={pending}
            onClick={() => save({ apiKey: null })}
            className="mt-2 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
          >
            {t('keyRemove')}
          </button>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t('keyStorage', { model: settings.model })}</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <InfoHint hint={t('modeHint')}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('modeTitle')}</h2>
        </InfoHint>
        <div role="radiogroup" aria-label={t('modeTitle')} className="mt-3 grid gap-2">
          {options.map(({ mode, icon: Icon, disabled, note }) => {
            const active = settings.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled || pending}
                onClick={() => save({ mode })}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  active ? 'border-primary bg-accent/60' : 'border-border hover:bg-secondary'
                )}
              >
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    active ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{t(`${mode}.title`)}</span>
                  <span className="block text-xs text-muted-foreground">{note}</span>
                </span>
                {active && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <InfoHint hint={t('apiHint')}>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('apiTitle')}</h2>
        </InfoHint>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-secondary p-3 text-xs leading-relaxed">
          <code>{API_EXAMPLE(t('apiExample'))}</code>
        </pre>
      </section>

      {error && <Banner tone="err">{error}</Banner>}
    </div>
  );
}
