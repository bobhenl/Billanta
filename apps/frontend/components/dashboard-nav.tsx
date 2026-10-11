'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { DASHBOARD_NAV_ITEMS } from '@/lib/dashboard-nav-items';

/**
 * Desktop top navbar links for the authenticated dashboard shell. Hidden
 * below `md`, where `mobile-bottom-nav.tsx` takes over instead. A client
 * component (rather than the server-rendered list the old sidebar used) so
 * it can highlight the active section via `usePathname`.
 */
export function DashboardNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <nav aria-label={t('primaryNavigation')} className="hidden items-center gap-1 md:flex">
      {DASHBOARD_NAV_ITEMS.map(({ key, href, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
