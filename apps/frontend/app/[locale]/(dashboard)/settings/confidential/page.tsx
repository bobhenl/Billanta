import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { fetchMyRole } from '@/lib/tenant';
import type { VaultStatus } from '@/lib/vault/types';
import { ConfidentialManager } from './confidential-manager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('vault.settings');
  return { title: t('title') };
}

/**
 * Settings → Důvěrný režim. Every member manages their own unlock methods
 * here; only the owner switches the mode on, owners and admins change the
 * company-wide parts (recovery code, encrypt new documents by default).
 */
export default async function ConfidentialSettingsPage() {
  const locale = await getLocale();
  const t = await getTranslations('vault.settings');
  let role: string | null;
  let status: VaultStatus;
  try {
    [role, status] = await Promise.all([fetchMyRole(), apiFetch<VaultStatus>('/api/v1/vault/me')]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }
  const session = await auth();

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <ConfidentialManager status={status} role={role} user={{ id: session?.user?.id ?? '', name: session?.user?.email ?? '' }} />
    </div>
  );
}
