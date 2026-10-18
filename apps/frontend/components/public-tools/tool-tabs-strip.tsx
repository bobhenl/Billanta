'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * The scrolling box of `ToolTabs`. Every tab is its own page, so each click
 * mounts a fresh strip that would start scrolled to the left, often with
 * the tab just clicked off-screen on a phone. This puts back the sideways
 * offset the visitor left it at (sessionStorage, per tab row) and then
 * nudges the active tab into view. It only ever sets `scrollLeft` of the
 * strip itself: `scrollIntoView` would also scroll the page vertically.
 */
export function ToolTabsStrip({ storageKey, label, className, children }: { storageKey: string; label: string; className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  // Layout effect, so the restored offset is in place before the first paint.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = `tool-tabs:${storageKey}`;
    try {
      const saved = Number(sessionStorage.getItem(key));
      if (saved > 0) el.scrollLeft = saved;
    } catch {
      // Storage blocked (private mode, cookies off): start from the left.
    }

    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      const box = el.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      const pad = 16;
      if (tab.left < box.left) el.scrollLeft -= box.left - tab.left + pad;
      else if (tab.right > box.right) el.scrollLeft += tab.right - box.right + pad;
    }

    let frame = 0;
    const save = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          sessionStorage.setItem(key, String(Math.round(el.scrollLeft)));
        } catch {
          // Not stored; the active tab is still scrolled into view next time.
        }
      });
    };
    save();
    el.addEventListener('scroll', save, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', save);
    };
  }, [storageKey]);

  return (
    <nav ref={ref} aria-label={label} className={className}>
      {children}
    </nav>
  );
}
