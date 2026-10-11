import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { redirect } from '@/i18n/navigation';
import { SettingsHeader } from '@/components/settings-header';
import { db } from '@/lib/db';
import { accounts, users } from '@/lib/auth-schema';
import { formatDate } from '@/lib/invoice-ui';
import { ProfileForms } from './profile-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.profile');
  return { title: t('title') };
}

export default async function ProfilePage() {
  const locale = await getLocale();
  const t = await getTranslations('settings.profile');
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect({ href: '/login', locale });

  const [user] = await db
    .select({ name: users.name, email: users.email, passwordHash: users.passwordHash, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId!))
    .limit(1);
  if (!user) redirect({ href: '/login', locale });
  const providers = await db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId!));

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <ProfileForms
        name={user!.name ?? ''}
        email={user!.email}
        hasPassword={Boolean(user!.passwordHash)}
        memberSince={formatDate(user!.createdAt.toISOString(), locale) ?? ''}
        providers={providers.map((p) => p.provider)}
      />
    </div>
  );
}
