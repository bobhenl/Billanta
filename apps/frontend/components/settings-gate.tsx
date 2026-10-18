import { Lock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { fetchMyAccess, forbiddenSettings, type SettingsKey } from '@/lib/tenant';

/**
 * A friendly "not for your role" page in place of a settings form the member
 * can't save (someone opened it by URL; the hub doesn't list it for them).
 * Returns null when the page is theirs to use. Usage:
 * `const gate = await settingsGate('company'); if (gate) return gate;`
 */
export async function settingsGate(key: SettingsKey): Promise<React.ReactElement | null> {
  // No access info (older backend, network hiccup): show the page; its own read-only mode and the backend still apply.
  const access = await fetchMyAccess().catch(() => null);
  if (!forbiddenSettings(access).has(key)) return null;
  const t = await getTranslations('settings.noAccess');
  const tRoles = await getTranslations('settings.team.roles');
  const role = access?.role;
  return (
    <div className="mx-auto mt-6 max-w-lg rounded-xl border border-border bg-card p-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Lock className="h-5 w-5" />
      </span>
      <h1 className="mt-4 text-lg font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {role === 'accountant' || role === 'viewer' ? t('body', { role: tRoles(role) }) : t('bodyGeneric')}
      </p>
      <Link href="/settings" className={cn(buttonClass.secondary, 'mt-5')}>
        {t('back')}
      </Link>
    </div>
  );
}
