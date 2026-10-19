'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface TrackTab {
  id: string;
  /** Full name, from `sm` up. */
  label: string;
  /** Abbreviation (ZŠ / SŠ / VŠ) that fits three across a 375 px phone. */
  short: string;
}

/**
 * Sticky ZŠ / SŠ / VŠ bar on the lessons hub. Plain anchor links, so every
 * section stays in the HTML and the bar works without JavaScript; the
 * script only highlights the section in view. Three equal columns, so it
 * cannot outgrow a phone screen.
 */
export function LessonTrackTabs({ tabs, label }: { tabs: TrackTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id);

  useEffect(() => {
    const sections = tabs.map((t) => document.getElementById(t.id)).filter((el): el is HTMLElement => el !== null);
    if (!sections.length) return;
    const visible = new Map<string, boolean>();
    // A section counts as current while it crosses a band just below the sticky header and bar.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = tabs.find((t) => visible.get(t.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-120px 0px -55% 0px' }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [tabs]);

  return (
    <nav aria-label={label} className="sticky top-14 z-20 -mx-4 mt-8 bg-background/90 px-4 py-2 backdrop-blur-md sm:mx-0 sm:px-0">
      <ul className="grid gap-1 rounded-full border border-border bg-card p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <li key={t.id} className="min-w-0">
            <a
              href={`#${t.id}`}
              aria-current={active === t.id ? 'true' : undefined}
              onClick={() => setActive(t.id)}
              className={cn(
                'block truncate rounded-full px-2 py-1.5 text-center text-sm font-semibold transition-colors',
                active === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
