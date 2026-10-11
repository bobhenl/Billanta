'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * One-tap light/dark toggle for headers. The `mounted` guard avoids a
 * hydration mismatch: `resolvedTheme` is only known client-side.
 */
export function ThemeToggle({ className }: { className?: string }) {
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
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        className
      )}
    >
      {mounted ? (
        isDark ? (
          <Sun className="h-[18px] w-[18px]" />
        ) : (
          <Moon className="h-[18px] w-[18px]" />
        )
      ) : (
        <span className="h-[18px] w-[18px]" aria-hidden="true" />
      )}
    </button>
  );
}

const MODES = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon }
] as const;

/** System / light / dark as a segmented control, for the mobile "More" sheet. */
export function ThemeSegment() {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div role="radiogroup" aria-label={t('toggle')} className="grid grid-cols-3 gap-1 rounded-full border border-border bg-secondary p-1">
      {MODES.map(({ value, icon: Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-semibold transition-colors',
              active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {t(`short.${value}`)}
          </button>
        );
      })}
    </div>
  );
}
