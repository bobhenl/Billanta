'use client';

import type { ChangeEvent } from 'react';
import { Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

/**
 * EN/CZ/SK switcher. A native `<select>` rather than a custom dropdown —
 * accessible for free (keyboard, screen readers) and avoids pulling in a
 * new dependency just for this.
 *
 * Navigates via next-intl's locale-aware `usePathname`/`useRouter` (see
 * `@/i18n/navigation`) so the current path is preserved and the URL prefix
 * is swapped correctly, instead of hand-rolling `/cs/...` string logic.
 */
export function LanguageSwitcher() {
  const t = useTranslations('language');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value as (typeof routing.locales)[number];
    router.replace(pathname, { locale: nextLocale });
  }

  return (
    <div className="relative inline-flex shrink-0 items-center">
      <Globe className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <label htmlFor="language-switcher" className="sr-only">
        {t('label')}
      </label>
      <select
        id="language-switcher"
        value={locale}
        onChange={handleChange}
        aria-label={t('label')}
        className="h-9 appearance-none rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm text-foreground outline-none transition-colors hover:bg-accent focus:ring-2 focus:ring-ring"
      >
        {routing.locales.map((loc) => (
          <option key={loc} value={loc}>
            {t(loc)}
          </option>
        ))}
      </select>
    </div>
  );
}
