'use client';

import { type FormEvent, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * "Forgot password?" form — mirrors `(auth)/login/login-form.tsx`'s visual
 * conventions exactly (same card/input/button classes) so the auth pages
 * read as one consistent flow.
 *
 * Submits `{ email, locale }` to `POST /api/auth/forgot-password`, which
 * ALWAYS responds with the same generic success shape regardless of whether
 * the email is registered (anti-enumeration — see that route's doc
 * comment). This form mirrors that on the UI side: once submitted, it
 * always shows the same confirmation message and does not go back to a
 * re-submittable form, so a user can't tell from the UI whether their email
 * matched an account, and can't casually re-trigger multiple sends by
 * resubmitting the same form state.
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgotPassword');
  const locale = useLocale();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale })
      });
    } catch {
      // Deliberately ignored: the confirmation message is shown regardless
      // of network-level failure too, per this endpoint's anti-enumeration
      // contract (the UI must not distinguish outcomes from the caller's
      // point of view).
    }

    // Always shows the confirmation, even on a network error — see above.
    setSubmitted(true);
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">{t('title')}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{t('successMessage')}</p>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
            {t('backToLogin')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            {t('emailLabel')}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('submit')}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
