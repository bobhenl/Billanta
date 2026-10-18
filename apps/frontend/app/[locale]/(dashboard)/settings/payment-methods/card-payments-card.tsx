'use client';

import { type FormEvent, useState, useTransition } from 'react';
import { CreditCard, Loader2, Unplug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { type CardPaymentSettings, connectStripe, disconnectStripe, setCardPaymentsEnabled } from '../actions';

const KNOWN_ERRORS = ['invalid_key_format', 'invalid_key', 'not_connected', 'plan_required'];

/**
 * Card payments from the invoice link: the company pastes its own Stripe
 * secret (or restricted) key, the backend verifies it, and invoice links
 * show "Pay by card". The key is never sent back, only its last 4 digits.
 */
export function CardPaymentsCard({ initial, readOnly }: { initial: CardPaymentSettings | null; readOnly: boolean }) {
  const t = useTranslations('settings.paymentMethods.card');
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [key, setKey] = useState('');
  const [pending, start] = useTransition();

  const errorText = (code: string) => (KNOWN_ERRORS.includes(code) ? t(`errors.${code}` as 'errors.invalid_key') : t('errors.generic'));
  const apply = (result: Awaited<ReturnType<typeof connectStripe>>, okText: string) => {
    if (!result.ok) return toast({ text: errorText(result.error), tone: 'err' });
    setSettings(result.data);
    toast({ text: okText, tone: 'ok' });
    router.refresh();
  };

  function connect(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await connectStripe(key);
      if (result.ok) setKey('');
      apply(result, t('connected'));
    });
  }

  if (!settings) return null;

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CreditCard className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <InfoHint hint={t('hint')}>
            <h2 className="font-bold">{t('title')}</h2>
          </InfoHint>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      {settings.connected ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{settings.accountName ?? t('stripeAccount')}</span>
            {settings.mode && (
              <span
                className={
                  settings.mode === 'live'
                    ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400'
                    : 'rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400'
                }
              >
                {t(`mode.${settings.mode}`)}
              </span>
            )}
            {settings.keyLast4 ? (
              <span className="text-muted-foreground">•••• {settings.keyLast4}</span>
            ) : (
              <span className="text-destructive">{t('reconnect')}</span>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={settings.enabled}
              disabled={readOnly || pending}
              onChange={(event) => {
                const enabled = event.target.checked;
                start(async () => apply(await setCardPaymentsEnabled(enabled), enabled ? t('enabledOn') : t('enabledOff')));
              }}
            />
            {t('enabled')}
          </label>
          {!readOnly && (
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => apply(await disconnectStripe(), t('disconnected')))}
              className={buttonClass.secondary}
            >
              <Unplug className="h-4 w-4" />
              {t('disconnect')}
            </button>
          )}
        </div>
      ) : readOnly ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('notConnected')}</p>
      ) : (
        <form onSubmit={connect} className="mt-4 space-y-2">
          <label htmlFor="stripeKey" className="text-sm font-medium">
            {t('keyLabel')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="stripeKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="rk_live_…"
              className={`${inputClass} font-mono`}
            />
            <button type="submit" disabled={pending || key.trim().length < 20} className={`${buttonClass.primary} shrink-0`}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('connect')}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t('keyHelp')}</p>
        </form>
      )}
    </section>
  );
}
