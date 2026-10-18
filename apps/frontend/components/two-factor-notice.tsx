import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { buttonClass } from '@/components/modal';

/**
 * Shown on pages whose connect/create actions the backend's `TwoFactorGuard`
 * refuses without two-factor sign-in (bank, API keys, webhooks, backups), so
 * the user learns why before filling in a form, not after.
 */
export async function TwoFactorNotice({ className }: { className?: string }) {
  const session = await auth().catch(() => null);
  if (!session?.user || session.twoFactor === 'verified') return null;
  const t = await getTranslations('twoFactor.notice');
  return (
    <Banner
      tone="warn"
      title={t('title')}
      className={className}
      action={
        <Link href="/settings/security" className={buttonClass.secondary}>
          {t('cta')}
        </Link>
      }
    >
      {t('body')}
    </Banner>
  );
}
