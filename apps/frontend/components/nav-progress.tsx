'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const START_EVENT = 'nav-progress:start';

/** For navigations that are not links (`router.push` from a table row). */
export function startNavProgress() {
  window.dispatchEvent(new Event(START_EVENT));
}

/**
 * A thin bar along the top while the next page renders on the server.
 * Next only shows `loading.tsx` when a layout segment changes, so a tap on
 * a list row (contacts → contact) or a filter would otherwise give no sign
 * at all until the new page arrives. Starts on any same-origin link click
 * that is not a new tab / download / hash jump; ends when the URL changes.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, setPending] = useState(false);

  useEffect(() => setPending(false), [pathname, search]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Captured before next/link's own handler, which prevents the default.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setPending(true);
    };
    const onStart = () => setPending(true);
    document.addEventListener('click', onClick, true);
    window.addEventListener(START_EVENT, onStart);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener(START_EVENT, onStart);
    };
  }, []);

  // Never stuck: a navigation that fails or is cancelled clears itself.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(false), 8_000);
    return () => clearTimeout(timer);
  }, [pending]);

  if (!pending) return null;
  return (
    <div role="progressbar" aria-busy="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-primary/20">
      <div className="h-full w-1/3 animate-[nav-progress_1.1s_ease-in-out_infinite] bg-primary" />
    </div>
  );
}
