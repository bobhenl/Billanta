'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';

/**
 * Two-icon light/dark toggle. Reads/writes via next-themes' `useTheme`
 * (see components/theme-provider.tsx for the provider setup).
 *
 * The `mounted` guard avoids a hydration mismatch: `resolvedTheme` is only
 * known client-side (it depends on `localStorage`/`matchMedia`), so the
 * server-rendered markup can't know which icon to show yet.
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={t('toggle')}
      title={mounted ? (isDark ? t('light') : t('dark')) : undefined}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {mounted ? (
        isDark ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )
      ) : (
        <span className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
