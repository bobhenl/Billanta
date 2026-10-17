'use client';

import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * One header dropdown for the secondary public pages (FAQ, calculators,
 * guides, comparison), so the navbar keeps three items instead of growing.
 * Same `<details>` pattern as LanguageSwitcher: the links stay in the DOM
 * and crawlable while closed, and it works without JavaScript. Script only
 * closes it on outside click, Escape and navigation.
 */
export function MarketingNavMenu({ label, items }: { label: string; items: { href: string; label: string; hint?: string }[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const locale = useLocale();

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

  return (
    <details ref={ref} className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground group-open:text-foreground [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-border bg-card p-1 shadow-lg">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="block rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-secondary">
              <span className="block font-semibold text-foreground">{item.label}</span>
              {item.hint && <span className="block text-xs text-muted-foreground">{item.hint}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
