import type { Metadata } from 'next';
import { Bell, BellRing, Blocks, Braces, Bot, Briefcase, Building2, Calculator, ChevronRight, CreditCard, DatabaseBackup, Download, FileSliders, FolderInput, Gift, Globe, Hash, History, KeyRound, Mail, MessageCircle, ShieldCheck, UserCog, Users, Wallet, Webhook, type LucideIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { canManage, fetchMyAccess, forbiddenSettings } from '@/lib/tenant';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

// The personal group holds only pages every role can use, so non-managers still get a tidy "my account" list.
const GROUPS: { key: string; items: { key: string; href: string; icon: LucideIcon }[] }[] = [
  {
    key: 'company',
    items: [
      { key: 'company', href: '/settings/company', icon: Building2 },
      { key: 'team', href: '/settings/team', icon: Users },
      { key: 'billing', href: '/billing', icon: CreditCard },
      { key: 'modules', href: '/settings/modules', icon: Blocks },
      { key: 'publicProfile', href: '/settings/public-profile', icon: Globe },
      { key: 'referrals', href: '/settings/referrals', icon: Gift },
      { key: 'accountantProfile', href: '/settings/accountant-profile', icon: Calculator }
    ]
  },
  {
    key: 'invoicing',
    items: [
      { key: 'invoices', href: '/settings/invoices', icon: FileSliders },
      { key: 'numbering', href: '/settings/numbering', icon: Hash },
      { key: 'paymentMethods', href: '/settings/payment-methods', icon: Wallet },
      { key: 'emails', href: '/settings/emails', icon: Mail },
      { key: 'variables', href: '/settings/variables', icon: Braces }
    ]
  },
  {
    key: 'personal',
    items: [
      { key: 'profile', href: '/settings/profile', icon: UserCog },
      { key: 'security', href: '/settings/security', icon: ShieldCheck },
      { key: 'notifications', href: '/settings/notifications', icon: Bell },
      { key: 'emailNotifications', href: '/settings/email-notifications', icon: BellRing },
      { key: 'companies', href: '/settings/companies', icon: Briefcase }
    ]
  },
  {
    key: 'data',
    items: [
      { key: 'exports', href: '/settings/exports', icon: Download },
      { key: 'backup', href: '/settings/backup', icon: DatabaseBackup },
      { key: 'import', href: '/settings/import', icon: FolderInput },
      { key: 'activity', href: '/activity', icon: History }
    ]
  },
  {
    key: 'integrations',
    items: [
      { key: 'channels', href: '/settings/channels', icon: MessageCircle },
      { key: 'ai', href: '/settings/ai', icon: Bot },
      { key: 'integrations', href: '/settings/integrations', icon: Webhook },
      { key: 'apiKeys', href: '/settings/api-keys', icon: KeyRound }
    ]
  }
];

/** Settings hub: every company-, invoicing-, personal-, data- and integration-level page as a row in its group. */
export default async function SettingsPage() {
  const t = await getTranslations('settings.hub');
  const access = await fetchMyAccess().catch(() => null);
  // Pages the role can't use are left out; opened by URL, they say who manages them (settingsGate).
  // Switched-off modules drop their settings card too (the page itself stays reachable by URL).
  const hidden = new Set<string>(forbiddenSettings(access));
  if (access && !access.modules.reports) hidden.add('exports');
  if (access && !access.modules.ai) hidden.add('ai');
  const manager = !access || canManage(access.role);
  const groups = GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !hidden.has(item.key)) })).filter((group) => group.items.length > 0);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>

      {/* Two columns on wide screens; the groups flow top to bottom and never split. */}
      <div className="mt-6 gap-6 lg:columns-2">
      {groups.map((group) => (
        <section key={group.key} className="mb-6 break-inside-avoid">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`groups.${group.key}`)}</h2>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {group.items.map(({ key, href, icon: Icon }) => (
              <li key={key}>
                <Link href={href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{t(`items.${key}.title`)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t(`items.${key}.description`)}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      </div>

      {!manager && <p className="mt-1 text-sm text-muted-foreground">{t('managedByAdmins')}</p>}
    </div>
  );
}
