'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * "Reset password" form — mirrors `(auth)/login/login-form.tsx`'s visual
 * conventions. Reads the raw reset token from the `?token=` URL search
 * param (the link from the email — see `lib/email.ts` /
 * `app/api/auth/forgot-password/route.ts`) and posts `{ token, password }`
 * to `POST /api/auth/reset-password`.
 *
 * Three explicit UI states, matching this feature's brief:
 * - missing token (malformed/bookmarked link with no `?token=` at all) —
 *   treated the same as an invalid token, with a link back to
 *   `/forgot-password`.
 * - success — confirmation + link to `/login`.
 * - error (invalid/expired token, or any other failure) — message + link
 *   back to `/forgot-password` to request a new link. Deliberately does not
 *   distinguish "expired" from "invalid" (the API itself doesn't either —
 *   see that route's doc comment).
 */
export function ResetPasswordForm() {
  const t = useTranslations('auth.resetPassword');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    if (password !== confirmPassword) {
      setError(t('mismatchError'));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error === 'invalid_input' ? t('invalidInputError') : response.status === 429 ? t('rateLimitedError') : t('invalidTokenError'));
        setSubmitting(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError(t('genericError'));
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">{t('title')}</h1>
        <p className="mt-4 text-sm text-destructive">{t('invalidTokenError')}</p>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            href="/forgot-password"
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            {t('requestNewLink')}
          </Link>
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">{t('title')}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{t('successMessage')}</p>
        <button
          type="button"
          onClick={() => router.push('/login')}
          className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          {t('goToLogin')}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            {t('passwordLabel')}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-medium">
            {t('confirmPasswordLabel')}
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t('confirmPasswordPlaceholder')}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
          {mismatch && <p className="text-sm text-destructive">{t('mismatchError')}</p>}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={submitting || mismatch}
          className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('submit')}
        </button>
      </form>
    </div>
  );
}
