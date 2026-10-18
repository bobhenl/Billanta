import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Link, redirect } from '@/i18n/navigation';
import { demoEnabled } from '@/lib/demo';
import { enabledOAuthProviders } from '@/lib/oauth-providers';
import { LoginForm } from './login-form';

/**
 * Standalone login page — mirrors `(auth)/signup/page.tsx`'s structure
 * exactly (same route-group trick to skip the dashboard shell, same
 * centered-card layout). Stays a plain server component; all interactivity
 * lives in `login-form.tsx`.
 */
export default async function LoginPage() {
  // Password (or OAuth) already accepted, code still missing: dashboard pages
  // treat that session as signed out and land here, so pass it on.
  const session = await auth().catch(() => null);
  if (session?.twoFactor === 'pending') redirect({ href: '/two-factor', locale: await getLocale() });

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <LoginForm providers={enabledOAuthProviders()} />
        {demoEnabled() && <DemoHint />}
      </div>
    </div>
  );
}

async function DemoHint() {
  const t = await getTranslations('demo');
  return (
    <p className="mt-4 text-center text-sm text-muted-foreground">
      {t('ctaHint')}{' '}
      <Link href="/demo" className="font-semibold text-primary hover:underline">
        {t('cta')}
      </Link>
    </p>
  );
}
