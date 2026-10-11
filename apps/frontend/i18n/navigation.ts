import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Locale-aware wrappers around Next.js navigation primitives — always
// import these instead of `next/link` / `next/navigation` so links and
// redirects stay under the current /:locale prefix.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
