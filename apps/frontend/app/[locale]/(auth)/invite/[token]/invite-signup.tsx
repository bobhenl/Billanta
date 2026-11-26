'use client';

import { type FormEvent, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { OAuthButton } from '@/components/oauth-button';
import { PasswordInput } from '@/components/password-input';
import { PROVIDER_NAMES, type OAuthProviderId } from '@/lib/oauth-providers';
import { TOS_VERSION } from '@/lib/tos';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const linkClass = 'font-medium text-foreground underline underline-offset-2 hover:no-underline';

/**
 * Signup for someone invited into a team: the email is the invited one and
 * cannot change, there is no company name and no "I act as a business"
 * statement (they join the inviter's company, an employee or a partner need
 * not be self-employed), and the new account lands straight in that company.
 */
export function InviteSignup({ token, email, providers }: { token: string; email: string; providers: OAuthProviderId[] }) {
  const t = useTranslations('invite.signup');
  const tSignup = useTranslations('auth.signup');
  const tLogin = useTranslations('auth.login');
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<'taken' | 'invalid' | 'limited' | 'generic' | null>(null);
  const back = `/invite/${encodeURIComponent(token)}`;
  const loginHref = `/login?next=${encodeURIComponent(back)}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteToken: token, email, name, password, tosVersionAccepted: TOS_VERSION, adultConfirmed: tosAccepted })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error === 'email_taken' ? 'taken' : body?.error === 'invite_invalid' ? 'invalid' : response.status === 429 ? 'limited' : 'generic');
        setSubmitting(false);
        return;
      }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('generic');
        setSubmitting(false);
        return;
      }
      router.push('/dashboard');
    } catch {
      setError('generic');
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {/* POST so a submit before hydration never puts the fields in the URL. */}
      <form method="post" className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            {tSignup('emailLabel')}
          </label>
          <input id="email" type="email" value={email} readOnly autoComplete="email" className={cn('min-h-10 bg-muted/50', inputClass)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            {t('nameLabel')}
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={120}
            placeholder={t('namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`min-h-10 ${inputClass}`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            {tSignup('passwordLabel')}
          </label>
          <PasswordInput
            id="password"
            name="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            placeholder={tSignup('passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`min-h-10 ${inputClass}`}
          />
        </div>
        <label htmlFor="tosAccepted" className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            id="tosAccepted"
            type="checkbox"
            required
            checked={tosAccepted}
            onChange={(e) => setTosAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <span>
            {t.rich('tosLabel', {
              tos: (chunks) => (
                <Link href="/legal/terms" target="_blank" className={linkClass}>
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link href="/legal/privacy" target="_blank" className={linkClass}>
                  {chunks}
                </Link>
              )
            })}
          </span>
        </label>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {error === 'taken' ? (
              <>
                {t('emailTaken')}{' '}
                <Link href={loginHref} className={linkClass}>
                  {tSignup('loginLink')}
                </Link>
              </>
            ) : error === 'invalid' ? (
              t('invalid')
            ) : error === 'limited' ? (
              tSignup('rateLimitedError')
            ) : (
              tSignup('genericError')
            )}
          </p>
        )}

        <button type="submit" disabled={submitting || !tosAccepted || password.length < 8} className={cn(buttonClass.primary, 'mt-1 py-2.5')}>
          {t('submit')}
        </button>
      </form>

      {providers.length > 0 && (
        <>
          <div className="mt-6 flex items-center gap-3 text-xs uppercase text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {tLogin('orContinueWith')}
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="mt-4 grid gap-2">
            {providers.map((id) => (
              <OAuthButton key={id} provider={id} label={tLogin('continueWith', { provider: PROVIDER_NAMES[id] })} callbackUrl={`/${locale}${back}`} />
            ))}
          </div>
        </>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {tSignup('hasAccount')}{' '}
        <Link href={loginHref} className={linkClass}>
          {tSignup('loginLink')}
        </Link>
      </p>
    </div>
  );
}
