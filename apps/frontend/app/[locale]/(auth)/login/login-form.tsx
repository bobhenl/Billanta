'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import { signIn } from 'next-auth/react';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * Login form — email/password via NextAuth's Credentials provider, plus
 * "Continue with Google" / "Continue with Discord" OAuth buttons. Mirrors
 * `(auth)/signup/signup-form.tsx`'s visual conventions (same card, input,
 * and button classes) so the two auth pages read as one consistent flow.
 *
 * Client component: form state (email/password/error/submitting) and the
 * `signIn(...)` calls both require it. `signIn` here comes from
 * `next-auth/react` (the client-side API, backed by the `SessionProvider`
 * wrapper in `components/session-provider.tsx`) — NOT the `signIn` exported
 * from the root `auth.ts`, which is meant for server actions/route handlers.
 */
export function LoginForm() {
  const t = useTranslations('auth.login');
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn('credentials', { email, password, redirect: false });

    if (result?.error) {
      setError(t('error'));
      setSubmitting(false);
      return;
    }

    router.push('/dashboard');
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            {t('passwordLabel')}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('submit')}
        </button>
      </form>

      <div className="mt-6 flex items-center gap-3 text-xs uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t('orContinueWith')}
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {t('continueWithGoogle')}
        </button>
        <button
          type="button"
          onClick={() => signIn('discord', { callbackUrl: '/dashboard' })}
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {t('continueWithDiscord')}
        </button>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
          {t('signupLink')}
        </Link>
      </p>
    </div>
  );
}
