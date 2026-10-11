'use client';

import { useEffect, useRef } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Compact language dropdown: a globe + current code ("CS ▾") that opens a
 * small menu with each language's own name. Built on `<details>` so the
 * options are real `<a hreflang>` links that stay in the DOM while closed —
 * crawlable, and reinforcing the hreflang tags in the head — and it works
 * without JavaScript. Script only adds close-on-outside-click / Escape /
 * navigation.
 *
 * next-intl's locale-aware `Link` keeps the current path and swaps only the
 * prefix (and stores the choice in its locale cookie).
 */
export function LanguageSwitcher({
  className,
  align = 'right',
  variant = 'dropdown'
}: {
  className?: string;
  align?: 'left' | 'right';
  /** `inline`: a flat CS / SK / EN row, for places a popover would be clipped (the phone "More" panel). */
  variant?: 'dropdown' | 'inline';
}) {
  const t = useTranslations('language');
  const locale = useLocale();
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    ref.current?.removeAttribute('open');
  }, [pathname, locale]);

  useEffect(() => {
    const close = (event: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !el.contains(event.target as Node)) {
        el.removeAttribute('open');
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  if (variant === 'inline') {
    return (
      <nav aria-label={t('label')} className={cn('inline-flex rounded-full border border-border bg-secondary p-0.5', className)}>
        {routing.locales.map((loc) => (
          <Link
            key={loc}
            href={pathname}
            locale={loc}
            hrefLang={loc}
            lang={loc}
            title={t(loc)}
            aria-current={loc === locale ? 'true' : undefined}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
              loc === locale ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {loc}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <details ref={ref} className={cn('group relative shrink-0', className)}>
      <summary
        aria-label={t('label')}
        title={t('label')}
        className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-full px-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground group-open:bg-secondary group-open:text-foreground [&::-webkit-details-marker]:hidden"
      >
        <Globe className="h-4 w-4" aria-hidden="true" />
        {locale}
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul
        className={cn(
          'absolute top-full z-50 mt-1.5 min-w-[10rem] rounded-lg border border-border bg-card p-1 shadow-lg',
          align === 'right' ? 'right-0' : 'left-0'
        )}
      >
        {routing.locales.map((loc) => {
          const active = loc === locale;
          return (
            <li key={loc}>
              <Link
                href={pathname}
                locale={loc}
                hrefLang={loc}
                lang={loc}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-secondary',
                  active ? 'font-semibold text-foreground' : 'text-muted-foreground'
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="w-5 text-[11px] font-bold uppercase text-muted-foreground">{loc}</span>
                  {t(loc)}
                </span>
                {active && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
