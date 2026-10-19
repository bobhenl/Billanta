import { Suspense } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Link, redirect } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { CommandPalette } from '@/components/command-palette';
import { ClassroomBanner } from '@/components/classroom/classroom-banner';
import { DemoBanner } from '@/components/demo/demo-banner';
import { DemoTransferClaim } from '@/components/demo/demo-transfer-claim';
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
import { fetchMyAccess, fetchTenant, hiddenSections, type TenantSettings } from '@/lib/tenant';
import { apiFetch, fetchMyCompanies, isStudentCompanyOfOthers } from '@/lib/api-client';
import { classroomEnabled, type StudentCompany } from '@/lib/classroom';
import { REFERRAL_COOKIE } from '@/lib/referral';
import { DEMO_TRANSFER_COOKIE } from '@/lib/demo-session';
import { DEMO_VIEW_ROLES } from '@/lib/demo';
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
  const locale = await getLocale();
  // A demo company shows its countdown. Fetched without a blanket catch so an
  // expired demo's redirect (lib/api-client.ts) is not swallowed here.
  let demo: TenantSettings | null = null;
  if (session.isDemo) {
    try {
      demo = await fetchTenant();
    } catch (error) {
      unstable_rethrow(error);
    }
  }
  // The backend enforces access (RoleAccessGuard); the shell just leaves out
  // what this member can't open or the company switched off, and tells a
  // viewer up front that they can only look.
  const [access, companies] = await Promise.all([fetchMyAccess().catch(() => null), fetchMyCompanies().catch(() => null)]);
  const role = access?.role ?? null;
  // A practice company of a class shows the class strip instead of the demo countdown.
  const classroom = companies?.active.classroom ? await apiFetch<StudentCompany>('/api/v1/classroom/student').catch(() => null) : null;
  // A teacher's students' companies are opened from the class page, not listed in the menu.
  const menuCompanies = (companies?.tenants ?? []).filter((c) => c.id === companies?.active.id || !isStudentCompanyOfOthers(c));
  const hidden = hiddenSections(access);
  // Arrived via someone's invite link: the owner of the (new) company claims it.
  const jar = await cookies();
  const claimReferral = role === 'owner' && jar.has(REFERRAL_COOKIE);
  // Came from a demo with "take my work along": the owner of the new company decides whether it comes in.
  const claimDemo = !session.isDemo && (role === 'owner' || role === 'admin') && jar.has(DEMO_TRANSFER_COOKIE);
  const demoRole = DEMO_VIEW_ROLES.find((r) => r === role) ?? 'owner';
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
                companies={menuCompanies.map((c) => ({ id: c.id, companyName: c.companyName }))}
                activeId={companies?.active.id ?? null}
                classroom={classroomEnabled() && !session.isDemo}
              />
            </div>
          </div>
        </header>

        <main className="container pb-tabbar flex-1 overflow-x-auto py-6 md:py-8">
          {role === 'viewer' && (
            <p className="mb-4 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">{tApp('readOnlyRole')}</p>
          )}
          {classroom ? (
            <ClassroomBanner info={classroom} />
          ) : demo?.isDemo && demo.demoExpiresAt ? (
            <DemoBanner
              expiresAt={demo.demoExpiresAt}
              aiLeft={demo.demoAiCallsLeft ?? null}
              locale={locale}
              kind={demo.demoKind ?? null}
              role={demoRole}
            />
          ) : (
            <TrialBanner plan={access?.plan} />
          )}
          {claimDemo && <DemoTransferClaim />}
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
