import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { twoFactorState } from '@/lib/two-factor';
import { SecurityManager } from './security-manager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.security');
  return { title: t('title') };
}

/** Settings → Zabezpečení: two-factor sign-in for the signed-in user (per person, not per company). */
export default async function SecuritySettingsPage({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return redirect({ href: '/login', locale: await getLocale() });
  const t = await getTranslations('settings.security');
  const state = await twoFactorState(session.user.id);
  const { recovery } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {recovery === '1' && state.enabled && (
        <Banner tone="warn" className="mt-4">
          {t('usedRecovery', { n: state.recoveryCodesLeft })}
        </Banner>
      )}
      <SecurityManager enabled={state.enabled} recoveryCodesLeft={state.recoveryCodesLeft} />
    </div>
  );
}
