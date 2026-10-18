'use client';

import { type FormEvent, useState, useTransition } from 'react';
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes, startTwoFactorSetup } from './actions';

type Setup = { secret: string; qr: string };

export function SecurityManager({ enabled, recoveryCodesLeft }: { enabled: boolean; recoveryCodesLeft: number }) {
  const t = useTranslations('settings.security');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'disable' | 'regenerate' | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function fail(errorCode: string) {
    setError(t.has(`errors.${errorCode}`) ? t(`errors.${errorCode}`) : t('errors.generic'));
    setCode('');
  }

  function begin() {
    setError(null);
    startTransition(async () => {
      const result = await startTwoFactorSetup();
      if (result.ok) setSetup({ secret: result.secret, qr: result.qr });
      else fail(result.error);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      if (setup) {
        const result = await confirmTwoFactorSetup(code);
        if (!result.ok) return fail(result.error);
        setSetup(null);
        setCodes(result.codes);
        setCode('');
        toast({ text: t('enabledToast'), tone: 'ok' });
        router.refresh();
      } else if (mode === 'disable') {
        const result = await disableTwoFactor(code);
        if (!result.ok) return fail(result.error);
        setMode(null);
        setCode('');
        toast({ text: t('disabledToast'), tone: 'ok' });
        router.refresh();
      } else if (mode === 'regenerate') {
        const result = await regenerateRecoveryCodes(code);
        if (!result.ok) return fail(result.error);
        setMode(null);
        setCodes(result.codes);
        setCode('');
        router.refresh();
      }
    });
  }

  const codeForm = (label: string, submitLabel: string, onCancel: () => void, danger = false) => (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:max-w-sm">
      <label htmlFor="totp-code" className="text-sm font-medium">
        {label}
      </label>
      <input
        id="totp-code"
        required
        autoFocus
        autoComplete="one-time-code"
        maxLength={20}
        placeholder="123 456"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className={`${inputClass} font-mono tracking-[0.2em]`}
      />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || code.trim().length < 6} className={danger ? buttonClass.danger : buttonClass.primary}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className={buttonClass.ghost}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${enabled ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}`}>
          {enabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldOff className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">{t('twoFactorTitle')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{enabled ? t('statusOn', { n: recoveryCodesLeft }) : t('statusOff')}</p>
        </div>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">{t('why')}</p>

      {error && (
        <Banner tone="err" className="mt-4">
          {error}
        </Banner>
      )}

      {codes && (
        <div className="mt-5 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <h3 className="text-sm font-bold">{t('codesTitle')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('codesHint')}</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => {
                void navigator.clipboard.writeText(codes.join('\n')).then(() => toast({ text: t('copied'), tone: 'ok' }));
              }}
            >
              <Copy className="h-4 w-4" />
              {t('copy')}
            </button>
            <button type="button" className={buttonClass.ghost} onClick={() => setCodes(null)}>
              {t('codesSaved')}
            </button>
          </div>
        </div>
      )}

      {!enabled && !setup && (
        <button type="button" onClick={begin} disabled={pending} className={`${buttonClass.primary} mt-5`}>
          {t('enable')}
        </button>
      )}

      {!enabled && setup && (
        <div className="mt-5 grid gap-5 sm:grid-cols-[auto_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL generated on the server */}
          <img src={setup.qr} alt={t('qrAlt')} width={180} height={180} className="rounded-lg border border-border bg-white p-2" />
          <div className="min-w-0">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>{t('step1')}</li>
              <li>{t('step2')}</li>
              <li>{t('step3')}</li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">{t('manualKey')}</p>
            <code className="mt-1 block break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            {codeForm(t('codeLabelApp'), t('confirm'), () => setSetup(null))}
          </div>
        </div>
      )}

      {enabled && !mode && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode('regenerate')} className={buttonClass.secondary}>
            {t('regenerate')}
          </button>
          <button type="button" onClick={() => setMode('disable')} className={buttonClass.ghost}>
            {t('disable')}
          </button>
        </div>
      )}

      {enabled && mode === 'regenerate' && codeForm(t('codeLabelApp'), t('regenerate'), () => setMode(null))}
      {enabled && mode === 'disable' && codeForm(t('codeLabel'), t('disable'), () => setMode(null), true)}
    </section>
  );
}
