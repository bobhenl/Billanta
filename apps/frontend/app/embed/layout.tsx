import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '../globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-sans', display: 'swap' });

/**
 * Root layout for the widgets other sites put in an iframe (lib/embeds.ts).
 * Its own root, outside `[locale]`, so none of the site's chrome comes
 * along: no session, consent banner, analytics or theme script, nothing
 * that sets a cookie on a stranger's page. Only `/embed/*` may be framed
 * by other origins (next.config.mjs, Caddyfile).
 *
 * `light` on <html> switches off the prefers-color-scheme fallback in
 * globals.css: the widget follows the host page's `theme` choice, not the
 * visitor's OS.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
  referrer: 'strict-origin-when-cross-origin'
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className="light" suppressHydrationWarning>
      <body className={`${inter.variable} bg-transparent font-sans`}>{children}</body>
    </html>
  );
}
