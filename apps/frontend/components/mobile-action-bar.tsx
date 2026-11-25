'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/** Class for an entry in the bar's "⋯" menu (a button or a link). */
export const actionBarItem =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-secondary disabled:opacity-60';

/**
 * A long form's save buttons, pinned to the bottom of a phone screen just
 * above the dashboard tab bar, so saving never needs a scroll to the end.
 * `children` is the primary action (and at most one plain secondary);
 * anything else goes into `more`, a small menu that opens upwards.
 * Hidden from `md` up, where the form's own buttons are within reach.
 *
 * It sits under the tab bar's panels (z-40/z-50) so "More" and "+" still
 * cover it, and renders a spacer so the last field is not hidden behind it.
 */
export function MobileActionBar({ children, more }: { children: ReactNode; more?: ReactNode }) {
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <div aria-hidden className="h-16 md:hidden" />
      <div
        ref={ref}
        className="fixed inset-x-0 z-30 border-t border-border bg-card/95 px-4 py-2.5 backdrop-blur md:hidden"
        style={{ bottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px))' }}
      >
        {more && open && (
          <div
            id="action-bar-more"
            // A click on any entry closes the menu.
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest('a,button')) setOpen(false);
            }}
            className="absolute bottom-full right-3 mb-2 w-60 max-w-[calc(100vw-1.5rem)] space-y-0.5 rounded-xl border border-border bg-card p-1.5 shadow-xl anim-rise"
          >
            {more}
          </div>
        )}
        <div className="flex items-center gap-2 [&>*:first-child]:flex-1">
          {children}
          {more && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="action-bar-more"
              aria-label={tCommon('moreActions')}
              title={tCommon('moreActions')}
              className={cn(buttonClass.secondary, 'h-10 w-10 shrink-0 px-0')}
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
