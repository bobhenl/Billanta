import { getLocale } from 'next-intl/server';
import { auth } from '@/auth';
import { redirect } from '@/i18n/navigation';
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
      </div>
    </div>
  );
}
