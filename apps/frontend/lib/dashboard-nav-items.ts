import { type LucideIcon, BarChart3, CreditCard, FileText, History, Landmark, LayoutDashboard, Receipt, Settings, Timer, Users } from 'lucide-react';

/**
 * Shared source of truth for the dashboard sections, consumed by both
 * `components/dashboard-nav.tsx` (desktop top navbar) and
 * `components/mobile-bottom-nav.tsx` (phone tab bar) so the two never
 * drift out of sync. Labels come from the `nav` message namespace.
 *
 * On phones only the everyday sections flagged `mobileTab` get a slot in
 * the bar (four, plus the "More" sheet that makes five, Spotify-style);
 * everything else is a tile in that sheet, so no section is unreachable.
 */
export type DashboardNavKey =
  | 'dashboard'
  | 'invoices'
  | 'expenses'
  | 'reports'
  | 'bank'
  | 'time'
  | 'contacts'
  | 'activity'
  | 'billing'
  | 'settings';

export interface DashboardNavItem {
  key: DashboardNavKey;
  href: string;
  icon: LucideIcon;
  /** Gets its own slot in the phone tab bar; otherwise it is a tile in the
   *  "More" sheet. Desktop's `DashboardNav` always shows every item. */
  mobileTab?: boolean;
  /** Account-level section: lives in the avatar menu on desktop (and in
   *  the phone "More" sheet), not in the top navbar. */
  accountMenu?: boolean;
}

export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, mobileTab: true },
  { key: 'invoices', href: '/invoices', icon: FileText, mobileTab: true },
  { key: 'expenses', href: '/expenses', icon: Receipt, mobileTab: true },
  { key: 'reports', href: '/reports', icon: BarChart3 },
  { key: 'bank', href: '/bank', icon: Landmark },
  { key: 'time', href: '/time', icon: Timer },
  { key: 'contacts', href: '/contacts', icon: Users, mobileTab: true },
  { key: 'activity', href: '/activity', icon: History, accountMenu: true },
  { key: 'billing', href: '/billing', icon: CreditCard, accountMenu: true },
  { key: 'settings', href: '/settings', icon: Settings, accountMenu: true }
];
