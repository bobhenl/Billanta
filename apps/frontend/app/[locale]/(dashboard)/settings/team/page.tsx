import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { fetchAccountants, type PublicAccountant } from '@/lib/accountant-directory';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole } from '@/lib/tenant';
import { TeamManager, type TeamData } from './team-manager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.team');
  return { title: t('title') };
}

export default async function TeamPage() {
  const locale = await getLocale();
  const t = await getTranslations('settings.team');
  const session = await auth();

  let team: TeamData;
  let role: string | null;
  let accountants: PublicAccountant[];
  try {
    // The directory is public and fails soft to an empty list, so it never blocks the team page.
    [team, role, accountants] = await Promise.all([apiFetch<TeamData>('/api/v1/team'), fetchMyRole(), fetchAccountants()]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <TeamManager team={team} canManage={canManage(role)} currentUserId={session?.user?.id ?? ''} accountants={accountants} />
    </div>
  );
}
