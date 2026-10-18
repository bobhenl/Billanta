'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import { cn } from '@/lib/utils';

/**
 * Day picker of the ČNB rates page, shared by the converter and the rate
 * table. A plain GET form (`?date=YYYY-MM-DD`), so it works without
 * JavaScript and every chosen day is a shareable, server-rendered link.
 * With JavaScript the submit becomes a client navigation that keeps the
 * scroll position and the converter's chosen currencies. It does not
 * navigate on every change: a typed date passes through partial values.
 */
export function FxDatePicker({ value, max, min }: { value: string | null; max: string; min: string }) {
  const t = useTranslations('tools.calculators.items.fx.date');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const day = new FormData(e.currentTarget).get('date');
        const href = typeof day === 'string' && day && day !== max ? `${pathname}?date=${day}` : pathname;
        startTransition(() => router.push(href, { scroll: false }));
      }}
    >
      <label className="text-sm font-medium">
        {t('label')}
        <input
          // Uncontrolled, so remount it when the page's day changes (e.g. back to today).
          key={value ?? max}
          type="date"
          name="date"
          defaultValue={value ?? max}
          min={min}
          max={max}
          required
          className={cn(inputClass, 'mt-1.5 block w-44 tabular-nums')}
        />
      </label>
      <button type="submit" disabled={pending} className={cn(buttonClass.secondary, 'h-10')}>
        {t('show')}
      </button>
      {value && (
        <Link href={pathname} scroll={false} className="inline-flex h-10 items-center px-2 text-sm font-medium text-primary hover:underline">
          {t('today')}
        </Link>
      )}
    </form>
  );
}
