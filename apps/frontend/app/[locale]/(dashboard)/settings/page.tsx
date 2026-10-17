import type { Metadata } from 'next';
import { Bell, Blocks, Braces, Bot, Briefcase, Building2, ChevronRight, CreditCard, DatabaseBackup, Download, FileSliders, FolderInput, Gift, Globe, Hash, History, KeyRound, Mail, MessageCircle, ShieldCheck, UserCog, Users, Wallet, Webhook, type LucideIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { fetchMyAccess } from '@/lib/tenant';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

const GROUPS: { key: string; items: { key: string; href: string; icon: LucideIcon }[] }[] = [
  {
    key: 'account',
    items: [
      { key: 'profile', href: '/settings/profile', icon: UserCog },
      { key: 'security', href: '/settings/security', icon: ShieldCheck },
      { key: 'notifications', href: '/settings/notifications', icon: Bell },
      { key: 'company', href: '/settings/company', icon: Building2 },
      { key: 'companies', href: '/settings/companies', icon: Briefcase },
      { key: 'invoices', href: '/settings/invoices', icon: FileSliders },
      { key: 'numbering', href: '/settings/numbering', icon: Hash },
      { key: 'emails', href: '/settings/emails', icon: Mail },
      { key: 'variables', href: '/settings/variables', icon: Braces },
      { key: 'paymentMethods', href: '/settings/payment-methods', icon: Wallet },
      { key: 'publicProfile', href: '/settings/public-profile', icon: Globe },
      { key: 'modules', href: '/settings/modules', icon: Blocks },
      { key: 'team', href: '/settings/team', icon: Users },
      { key: 'billing', href: '/billing', icon: CreditCard },
      { key: 'referrals', href: '/settings/referrals', icon: Gift }
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

/** Settings hub: every account-, data- and integration-level page as a card. */
export default async function SettingsPage() {
  const t = await getTranslations('settings.hub');
  const access = await fetchMyAccess().catch(() => null);
  // Switched-off modules drop their settings card too (the page itself stays reachable by URL).
  const hidden = new Set<string>();
  if (access && !access.modules.reports) hidden.add('exports');
  if (access && !access.modules.ai) hidden.add('ai');

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>

      {GROUPS.map((group) => (
        <section key={group.key} className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`groups.${group.key}`)}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {group.items.filter((item) => !hidden.has(item.key)).map(({ key, href, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary hover:shadow-md"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{t(`items.${key}.title`)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t(`items.${key}.description`)}</span>
                </span>
                <ChevronRight className="mt-2 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
