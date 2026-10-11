'use client';

import type { ComponentProps } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Thin client wrapper around next-themes' provider. The root locale layout
 * (`app/[locale]/layout.tsx`) is a server component and can't touch
 * `next-themes` directly (it reads `window`/`localStorage`), so this
 * boundary component is what actually gets mounted client-side.
 *
 * Used with `attribute="class"` so Tailwind's `darkMode: ['class']` picks up
 * the `dark`/`light` class next-themes puts on `<html>` — see the `.dark`
 * class block in `app/globals.css`.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
