'use client';

import { type FormEvent, useState, useTransition } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { buttonClass, inputClass } from '@/components/modal';
import { cancelTwoFactor, submitTwoFactorCode } from './actions';

/** One field for both kinds of code: six digits are TOTP, anything else is tried as a recovery code. */
export function TwoFactorForm({ email }: { email: string }) {
  const t = useTranslations('auth.twoFactor');
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitTwoFactorCode(code);
      if (result.ok) {
        router.replace(result.usedRecovery ? '/settings/security?recovery=1' : '/dashboard');
        router.refresh();
        return;
      }
      if (result.error === 'not_signed_in') {
        router.replace('/login');
        return;
      }
      setError(t(`errors.${result.error}`));
      setCode('');
    });
  }

  function handleCancel() {
    startTransition(async () => {
      await cancelTwoFactor();
      router.replace('/login');
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <ShieldCheck className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-card-foreground">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle', { email })}</p>

      {error && (
        <Banner tone="err" className="mt-4">
          {error}
        </Banner>
      )}

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="code" className="text-sm font-medium">
            {t('codeLabel')}
          </label>
          <input
            id="code"
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="text"
            maxLength={20}
            placeholder="123 456"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${inputClass} text-center font-mono text-lg tracking-[0.3em]`}
          />
          <p className="text-xs text-muted-foreground">{t('recoveryHint')}</p>
        </div>

        <button type="submit" disabled={pending || code.trim().length < 6} className={buttonClass.primary}>
          {t('submit')}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <button type="button" onClick={handleCancel} disabled={pending} className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
          {t('cancel')}
        </button>
      </p>
    </div>
  );
}
