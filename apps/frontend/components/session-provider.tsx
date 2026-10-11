'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';

/**
 * Thin client-component wrapper around NextAuth's `SessionProvider`.
 * `app/[locale]/layout.tsx` is a server component (it does async work —
 * `getMessages()`, `getTranslations()` — that can't run in a client
 * component), so the client-only `SessionProvider` context can't be used
 * there directly; wrapping it here keeps the rest of the layout server-side
 * while still making `useSession()` available to any client component
 * further down the tree (e.g. `login-form.tsx`, a future signed-in
 * `user-menu.tsx`).
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
