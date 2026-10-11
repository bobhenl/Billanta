import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DashboardNav } from '@/components/dashboard-nav';
import { LanguageSwitcher } from '@/components/language-switcher';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';

/**
 * Shell layout for the authenticated dashboard area (route group so these
 * routes stay outside the marketing namespace without adding a URL
 * segment). No auth guard yet — TODO once Auth.js sessions exist
 * (blueprint §2), this layout is where the session check + tenant/plan
 * gating (blueprint §5) belongs.
 *
 * Desktop: a top navbar (`DashboardNav`) instead of the previous
 * sidebar-only layout, plus theme/language controls and a user-menu
 * placeholder. Mobile (below `md`): the navbar's links are replaced by a
 * fixed bottom bar (`MobileBottomNav`) — `<main>` gets extra bottom padding
 * on small screens so content never renders underneath it.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const tApp = await getTranslations('app');

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/dashboard" className="shrink-0 text-lg font-semibold tracking-tight">
            {tApp('name')}
          </Link>

          <DashboardNav />

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container flex-1 overflow-x-auto py-8 pb-24 md:pb-8">{children}</main>

      <MobileBottomNav />
    </div>
  );
}
