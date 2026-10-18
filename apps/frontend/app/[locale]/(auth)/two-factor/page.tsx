import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { redirect } from '@/i18n/navigation';
import { TwoFactorForm } from './two-factor-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.twoFactor');
  return { title: t('title') };
}

/** Second sign-in step for users with two-factor sign-in on (see lib/two-factor.ts). */
export default async function TwoFactorPage() {
  const locale = await getLocale();
  const session = await auth();
  if (!session?.user) return redirect({ href: '/login', locale });
  if (session.twoFactor !== 'pending') return redirect({ href: '/dashboard', locale });

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <TwoFactorForm email={session.user.email ?? ''} />
      </div>
    </div>
  );
}
