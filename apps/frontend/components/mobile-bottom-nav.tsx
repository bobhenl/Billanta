'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { DASHBOARD_NAV_ITEMS } from '@/lib/dashboard-nav-items';

/**
 * Fixed bottom navigation shown only below `md` — the mobile counterpart to
 * `dashboard-nav.tsx`'s desktop top navbar. Deliberately capped at the
 * original 5 sections (Dashboard/Invoices/Contacts/Billing/Settings) per the
 * original design brief — items flagged `hideOnMobile` in
 * `dashboard-nav-items.ts` (e.g. `expenses`) are filtered out here so this
 * bar never grows past that, even though the desktop navbar shows them.
 * Active route highlighted via `usePathname`.
 *
 * `(dashboard)/layout.tsx` adds bottom padding on `<main>` on small screens
 * so page content never renders underneath this fixed bar.
 */
export function MobileBottomNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const items = DASHBOARD_NAV_ITEMS.filter((item) => !item.hideOnMobile);

  return (
    <nav
      aria-label={t('primaryNavigation')}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:hidden"
    >
      {items.map(({ key, href, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className={cn('h-5 w-5', isActive && 'stroke-[2.5]')} />
            <span>{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
