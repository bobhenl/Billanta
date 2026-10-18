'use client';

import { useTranslations } from 'next-intl';
import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { MobileTabBar } from '@/components/mobile-tab-bar';
import { ThemeSegment } from '@/components/theme-toggle';
import { ACTIONS } from '@/components/command-palette';
import { useLeaveOffline } from '@/components/offline-sync';
import { DASHBOARD_NAV_ITEMS } from '@/lib/dashboard-nav-items';

/**
 * The dashboard's phone tab bar: the four everyday sections, then "More"
 * — a panel with the remaining sections plus language, appearance and
 * sign-out (the dashboard's phone header carries only brand + account). See `mobile-tab-bar.tsx` for the bar itself.
 */
/** Create actions of the "+" panel (the palette's, minus the less everyday ones). */
const QUICK_ACTIONS = ['newInvoice', 'newExpense', 'newContact', 'newProforma', 'newQuote'];

export function MobileBottomNav({ hidden = [], actionsHidden = hidden }: { hidden?: string[]; actionsHidden?: string[] }) {
  const t = useTranslations('nav');
  const tRoot = useTranslations();
  const tMobile = useTranslations('mobile');
  const tCommon = useTranslations('common');

  const tabs = DASHBOARD_NAV_ITEMS.filter((item) => item.mobileTab && !hidden.includes(item.key)).map(({ key, href, icon }) => ({
    key,
    href,
    icon,
    label: t(key)
  }));
  const links = DASHBOARD_NAV_ITEMS.filter((item) => !item.mobileTab && !hidden.includes(item.key)).map(({ key, href, icon }) => ({
    key,
    href,
    icon,
    label: t(key)
  }));

  const actions = ACTIONS.filter((a) => QUICK_ACTIONS.includes(a.key) && !(a.section && actionsHidden.includes(a.section)))
    .sort((a, b) => QUICK_ACTIONS.indexOf(a.key) - QUICK_ACTIONS.indexOf(b.key))
    .map(({ key, href, icon, label }) => ({ key, href, icon, label: tRoot(label) }));

  return (
    <MobileTabBar
      label={t('primaryNavigation')}
      items={tabs}
      moreLabel={tMobile('more')}
      links={links}
      panelFooter={<PanelSettings logOutLabel={tCommon('logOut')} />}
      actions={actions}
      actionsLabel={tMobile('create')}
    />
  );
}

export function PanelSettings({ logOutLabel }: { logOutLabel?: string }) {
  const tMobile = useTranslations('mobile');
  const leaveOffline = useLeaveOffline();
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{tMobile('language')}</span>
        <LanguageSwitcher variant="inline" />
      </div>
      <div className="space-y-2">
        <span className="text-sm font-semibold">{tMobile('appearance')}</span>
        <ThemeSegment />
      </div>
      {logOutLabel && (
        <button
          type="button"
          onClick={async () => (await leaveOffline()) && signOut({ callbackUrl: '/' })}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-border py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          {logOutLabel}
        </button>
      )}
    </>
  );
}
