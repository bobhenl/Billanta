'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/modal';
import { PasswordInput } from '@/components/password-input';
import { Link } from '@/i18n/navigation';
import { confirmPasskeyStepUp, confirmStepUp, passkeyStepUpChallenge, stepUpInfo } from '@/lib/step-up-actions';
import { passkeyStepUpAssertion } from '@/lib/vault/passkey';
import type { StepUpKind } from '@/lib/reauth';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const ERRORS = new Set(['invalid_code', 'wrong_current', 'reauth_required', 'too_many_attempts']);

function needsStepUp(result: { ok: boolean }): boolean {
  const error = (result as { error?: unknown }).error;
  return !result.ok && typeof error === 'string' && error.includes('step_up_required');
}

/**
 * The UI half of the backend's step-up (`src/auth/step-up.ts`): run the
 * action, and only when the backend answers `step_up_required` ask for the
 * code or password, then run it once more. `withStepUp` resolves to null
 * when the person closes the dialog. Render `stepUpDialog` somewhere in the
 * component.
 */
export function useStepUp() {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  }, []);

  const withStepUp = useCallback(async <R extends { ok: boolean }>(action: () => Promise<R>): Promise<R | null> => {
    const first = await action();
    if (!needsStepUp(first)) return first;
    const confirmed = await new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
    return confirmed ? action() : null;
  }, []);

  return { withStepUp, stepUpDialog: <StepUpDialog open={open} onDone={finish} /> };
}

function StepUpDialog({ open, onDone }: { open: boolean; onDone: (ok: boolean) => void }) {
  const t = useTranslations('stepUp');
  const [kind, setKind] = useState<StepUpKind | null>(null);
  const [passkey, setPasskey] = useState(false);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSecret('');
    setError(null);
    void stepUpInfo().then((r) => {
      setKind(r.ok ? r.data.kind : 'password');
      setPasskey(r.ok && r.data.passkey && typeof window !== 'undefined' && !!window.PublicKeyCredential);
    });
  }, [open]);

  async function confirmWithPasskey() {
    setBusy(true);
    setError(null);
    try {
      const challenge = await passkeyStepUpChallenge();
      const assertion = challenge.ok ? await passkeyStepUpAssertion(challenge.data.challenge, challenge.data.credentialIds) : null;
      const r = assertion ? await confirmPasskeyStepUp(assertion) : null;
      if (r?.ok) return onDone(true);
      setError(r && ERRORS.has(r.error) ? t(`errors.${r.error}`) : t('errors.passkey_failed'));
    } catch {
      // The person closed the browser's passkey prompt, or it timed out.
      setError(t('errors.passkey_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await confirmStepUp(secret);
    setBusy(false);
    if (r.ok) return onDone(true);
    setError(ERRORS.has(r.error) ? t(`errors.${r.error}`) : t('errors.generic'));
    setSecret('');
  }

  return (
    <Modal open={open} onClose={() => onDone(false)} title={t('title')}>
      <form onSubmit={submit} className="space-y-3">
        <p className="flex items-start gap-2 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {kind ? t(`intro.${kind}`) : t('loading')}
        </p>
        {kind === 'totp' && (
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t('code')}
            aria-label={t('code')}
            autoFocus
            className={cn(inputClass, 'font-mono tracking-widest')}
          />
        )}
        {kind === 'password' && (
          <PasswordInput
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="current-password"
            placeholder={t('password')}
            aria-label={t('password')}
            autoFocus
            className={inputClass}
          />
        )}
        {passkey && (
          <button type="button" onClick={confirmWithPasskey} disabled={busy} className={cn(buttonClass.secondary, 'w-full justify-center')}>
            <Fingerprint className="h-4 w-4" aria-hidden="true" />
            {t('usePasskey')}
          </button>
        )}
        {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
        {kind && kind !== 'totp' && (
          <p className="rounded-lg bg-secondary px-3 py-2 text-xs">
            {t('twoFactorHint')}{' '}
            <Link href="/settings/security" className="font-semibold text-primary underline-offset-2 hover:underline">
              {t('twoFactorLink')}
            </Link>
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t('note')}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onDone(false)} className={buttonClass.secondary}>
            {t('cancel')}
          </button>
          <button type="submit" disabled={busy || !kind || (kind !== 'sign_in' && !secret.trim())} className={buttonClass.primary}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
