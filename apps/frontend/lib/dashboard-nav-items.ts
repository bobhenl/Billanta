import type { ComponentType } from 'react';
import { CreditCard, FileText, Landmark, LayoutDashboard, Receipt, Settings, Users } from 'lucide-react';

/**
 * Shared source of truth for the dashboard sections, consumed by both
 * `components/dashboard-nav.tsx` (desktop top navbar) and
 * `components/mobile-bottom-nav.tsx` (mobile fixed bottom bar) so the two
 * never drift out of sync. Labels come from the `nav` message namespace
 * (`messages/{cs,sk,en}.json`), keyed by `key` below.
 *
 * The original design brief fixed the mobile bottom bar at exactly 5 icons
 * (Dashboard/Invoices/Contacts/Billing/Settings) — a deliberate layout
 * constraint, not an oversight. Newer sections (e.g. `expenses`, `bank`) are
 * added here with `hideOnMobile: true` so they show up in the desktop navbar
 * without growing the mobile bar past 5 icons; `MobileBottomNav` filters on
 * that flag before rendering.
 */
export type DashboardNavKey =
  | 'dashboard'
  | 'invoices'
  | 'expenses'
  | 'bank'
  | 'contacts'
  | 'billing'
  | 'settings';

export interface DashboardNavItem {
  key: DashboardNavKey;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** When true, `MobileBottomNav` skips this item to preserve the 5-icon
   *  mobile layout. Desktop's `DashboardNav` always shows every item. */
  hideOnMobile?: boolean;
}

export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'invoices', href: '/invoices', icon: FileText },
  { key: 'expenses', href: '/expenses', icon: Receipt, hideOnMobile: true },
  { key: 'bank', href: '/bank', icon: Landmark, hideOnMobile: true },
  { key: 'contacts', href: '/contacts', icon: Users },
  { key: 'billing', href: '/billing', icon: CreditCard },
  { key: 'settings', href: '/settings', icon: Settings }
];
