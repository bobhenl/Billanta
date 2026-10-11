'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import { signIn } from 'next-auth/react';
import { Link, useRouter } from '@/i18n/navigation';
import { TOS_VERSION } from '@/lib/tos';

// Signup gates on this exact ToS version (see lib/tos.ts).

/**
 * Signup form — company name, email, password, and a required, NOT
 * preselected ToS checkbox (blueprint §9's "signup gate"). This is a client
 * component because the submit button's disabled state depends on live
 * checkbox state.
 *
 * Real network wiring: POSTs to `POST /api/auth/register` (this app's own
 * route handler, `app/api/auth/register/route.ts`) which hashes the
 * password and creates the `users` row, then signs the new user in via
 * NextAuth's Credentials provider and redirects to the dashboard.
 *
 * GAP (see `app/api/auth/register/route.ts`'s doc comment for the full
 * explanation): `companyName` and the `tosVersionAccepted`/`acceptedAt`
 * pair are still collected and sent, but the backend cannot yet log a
 * `tos_acceptances` row or create a tenant from them — tenant bootstrap
 * (`TenantsService.signup()`) is a separate, not-yet-implemented task. This
 * form's own ToS-acceptance gating logic (the required, non-preselected
 * checkbox) is unchanged and still enforced client-side regardless.
 */
export function SignupForm() {
  const t = useTranslations('auth.signup');
  const router = useRouter();

  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false); // deliberately NOT preselected
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = tosAccepted && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tosAccepted) return; // belt-and-braces guard alongside the disabled submit button

    setSubmitting(true);
    setError(null);

    const payload = {
      companyName,
      email,
      password,
      // blueprint §9 `tos_acceptances` audit fields — currently unused by
      // the backend, see this file's doc comment.
      tosVersionAccepted: TOS_VERSION,
      // The same checkbox confirms the age (18+, see tosLabel); the route
      // refuses a signup without it.
      adultConfirmed: tosAccepted,
      acceptedAt: new Date().toISOString()
    };

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error === 'email_taken' ? t('emailTakenError') : response.status === 429 ? t('rateLimitedError') : t('genericError'));
        setSubmitting(false);
        return;
      }

      // Auto sign-in right after registration, then a few setup questions
      // (/welcome) — avoids making them re-enter credentials they just typed.
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError(t('genericError'));
        setSubmitting(false);
        return;
      }

      router.push('/welcome');
    } catch {
      setError(t('genericError'));
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="companyName" className="text-sm font-medium">
            {t('companyNameLabel')}
          </label>
          <input
            id="companyName"
            name="companyName"
            type="text"
            required
            autoComplete="organization"
            placeholder={t('companyNamePlaceholder')}
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>

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

        {/* Required, non-preselected ToS acceptance checkbox — blueprint §9
            "signup gate". The submit button stays disabled until this is
            checked; `t.rich` renders the `<tos>` and `<dpa>` tags from the
            message catalog as links to /legal/terms and /legal/dpa. The
            label also confirms the user signs up as a business (B2B only). */}
        <label htmlFor="tosAccepted" className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            id="tosAccepted"
            name="tosAccepted"
            type="checkbox"
            required
            checked={tosAccepted}
            onChange={(event) => setTosAccepted(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <span>
            {t.rich('tosLabel', {
              tos: (chunks) => (
                <Link
                  href="/legal/terms"
                  target="_blank"
                  className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                >
                  {chunks}
                </Link>
              ),
              dpa: (chunks) => (
                <Link
                  href="/legal/dpa"
                  target="_blank"
                  className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                >
                  {chunks}
                </Link>
              )
            })}
          </span>
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('submit')}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t('hasAccount')}{' '}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
          {t('loginLink')}
        </Link>
      </p>
    </div>
  );
}
