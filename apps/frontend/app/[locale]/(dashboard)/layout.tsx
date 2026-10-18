import { Suspense } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Link, redirect } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { CommandPalette } from '@/components/command-palette';
import { DashboardNav } from '@/components/dashboard-nav';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { LanguageSwitcher } from '@/components/language-switcher';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { NavProgress } from '@/components/nav-progress';
import { NotificationBell } from '@/components/notification-bell';
import { ReferralClaim } from '@/components/referral-claim';
import { ThemeToggle } from '@/components/theme-toggle';
import { TrialBanner } from '@/components/trial-banner';
import { UserMenu } from '@/components/user-menu';
import { NOINDEX } from '@/lib/seo';
import { fetchMyAccess, hiddenSections } from '@/lib/tenant';
import { fetchMyCompanies } from '@/lib/api-client';
import { REFERRAL_COOKIE } from '@/lib/referral';
import { dashboardClientMessages } from '@/lib/client-messages';

// The signed-in app is never a search result (robots.ts also disallows it).
export const metadata: Metadata = { robots: NOINDEX };

/**
 * Shell for the signed-in dashboard (a route group, so no URL segment).
 *
 * Desktop: one compact 56px bar — brand, section links, language, theme,
 * account. Phones: the bar keeps only brand + account (Spotify-style), and
 * the sections move to the fixed tab bar at the bottom (`MobileBottomNav`),
 * whose "More" sheet also carries language and theme. `.pb-tabbar` keeps
 * content clear of that bar.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Signed-in area: no session, no dashboard. (Each page's backend calls are
  // independently authorised by the backend JWT; this is the UI gate.)
  const session = await auth();
  if (!session?.user) {
    return redirect({ href: '/login', locale: await getLocale() });
  }
  if (session.twoFactor === 'pending') {
    redirect({ href: '/two-factor', locale: await getLocale() });
  }

  const tApp = await getTranslations('app');
  // The backend enforces access (RoleAccessGuard); the shell just leaves out
  // what this member can't open or the company switched off, and tells a
  // viewer up front that they can only look.
  const [access, companies] = await Promise.all([fetchMyAccess().catch(() => null), fetchMyCompanies().catch(() => null)]);
  const role = access?.role ?? null;
  const hidden = hiddenSections(access);
  // Arrived via someone's invite link: the owner of the (new) company claims it.
  const claimReferral = role === 'owner' && (await cookies()).has(REFERRAL_COOKIE);
  // The Ctrl+K palette also drops create actions the member can't perform and switched-off modules.
  const paletteHidden = [...hidden];
  if (access) {
    const p = access.permissions;
    if (p.invoices !== 'write') paletteHidden.push('createInvoices');
    if (p.expenses !== 'write' || !access.modules.expenses) paletteHidden.push('createExpenses');
    if (p.contacts !== 'write') paletteHidden.push('createContacts');
    if (!access.modules.quotes || p.invoices !== 'write') paletteHidden.push('quotes');
    if (!access.modules.reports || p.reports === 'none') paletteHidden.push('exports');
    if (!access.modules.ai) paletteHidden.push('ai');
  }

  // The root layout sends the browser only the public namespaces; the app
  // needs its own as well (lib/client-messages.ts).
  const messages = dashboardClientMessages(await getMessages());

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="flex min-h-screen flex-col">
        <header className="site-header sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
          <div className="container flex h-14 items-center justify-between gap-3">
            <Link href="/dashboard" className="flex shrink-0 items-center gap-2 text-base font-bold tracking-tight">
              <BrandMark />
              {tApp('name')}
            </Link>

            <DashboardNav hidden={hidden} />

            <div className="flex items-center gap-1.5">
              <CommandPalette hidden={paletteHidden} />
              <NotificationBell />
              <LanguageSwitcher className="hidden md:inline-flex" />
              <ThemeToggle className="hidden md:inline-flex" />
              <UserMenu
                companies={companies?.tenants.map((c) => ({ id: c.id, companyName: c.companyName })) ?? []}
                activeId={companies?.active.id ?? null}
              />
            </div>
          </div>
        </header>

        <main className="container pb-tabbar flex-1 overflow-x-auto py-6 md:py-8">
          {role === 'viewer' && (
            <p className="mb-4 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">{tApp('readOnlyRole')}</p>
          )}
          <TrialBanner plan={access?.plan} />
          {children}
        </main>

        <MobileBottomNav hidden={hidden} actionsHidden={paletteHidden} />
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <KeyboardShortcuts hidden={paletteHidden} />
        {claimReferral && <ReferralClaim />}
      </div>
    </NextIntlClientProvider>
  );
}
