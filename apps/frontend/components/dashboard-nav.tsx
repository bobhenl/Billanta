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
export function DashboardNav({ hidden = [] }: { hidden?: string[] }) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <nav aria-label={t('primaryNavigation')} className="hidden min-w-0 items-center gap-0.5 md:flex">
      {DASHBOARD_NAV_ITEMS.filter((item) => !item.accountMenu && !hidden.includes(item.key)).map(({ key, href, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            aria-label={t(key)}
            className={cn(
              'group relative flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
              isActive
                ? 'bg-secondary text-foreground ring-1 ring-inset ring-border'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {/* Between md and xl only the active section keeps its label, so the bar still fits
                and you always see where you are; the rest show a tooltip on hover/focus. */}
            <span aria-hidden className={isActive ? 'whitespace-nowrap' : 'hidden xl:inline'}>
              {t(key)}
            </span>
            {!isActive && (
              <span
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-md transition-opacity delay-150 group-hover:opacity-100 group-focus-visible:opacity-100 xl:hidden"
              >
                {t(key)}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
