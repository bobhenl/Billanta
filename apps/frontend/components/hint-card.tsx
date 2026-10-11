'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A card whose whole surface is the (i) toggle: the title row stays one
 * line, and a click anywhere on the card opens its explanation underneath
 * as plain body text (no hint-note box, the card already is the box).
 * Built as the accordion pattern, an <h3> wrapping the button, so the
 * page's heading outline stays intact.
 *
 * Same hidden-text rules as InfoHint: the explanation is server-rendered,
 * only hidden, so it is indexed and reachable by screen readers, and on
 * browsers that support `hidden="until-found"` Ctrl+F finds it and opens
 * the card by itself.
 */
export function HintCard({
  leading,
  title,
  hint,
  className
}: {
  /** Icon / step number shown before the title. */
  leading?: ReactNode;
  title: ReactNode;
  hint: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const id = useId();

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (open) {
      el.removeAttribute('hidden');
    } else if ('onbeforematch' in document.body) {
      el.setAttribute('hidden', 'until-found');
    } else {
      el.setAttribute('hidden', '');
    }
    const onMatch = () => setOpen(true);
    el.addEventListener('beforematch', onMatch);
    return () => el.removeEventListener('beforematch', onMatch);
  }, [open]);

  return (
    <li
      className={cn(
        'rounded-xl border transition-colors',
        open ? 'border-primary/30 bg-accent/50' : 'border-border bg-card hover:border-primary/30',
        className
      )}
    >
      <h3 className="text-sm font-bold leading-snug">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-3 rounded-xl p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {leading}
          <span className="min-w-0 flex-1">{title}</span>
          <Info
            className={cn('h-4 w-4 shrink-0 transition-colors', open ? 'text-primary' : 'text-muted-foreground')}
            aria-hidden="true"
          />
        </button>
      </h3>
      <p
        id={id}
        ref={bodyRef}
        className="-mt-1 px-3 pb-3 text-sm leading-relaxed text-muted-foreground [&[hidden]:not([hidden='until-found'])]:hidden [&[hidden]]:p-0"
        hidden
      >
        {hint}
      </p>
    </li>
  );
}
