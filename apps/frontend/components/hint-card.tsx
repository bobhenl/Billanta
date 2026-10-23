'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useReveal } from '@/components/info-hint';
import { cn } from '@/lib/utils';

const FINE_POINTER = '(hover: hover) and (pointer: fine)';

/**
 * A card with a one-line title and a short explanation. With a mouse there
 * is room and no reason to hide a sentence, so the text is simply shown and
 * the title is a plain heading. On touch the card starts collapsed and the
 * title row is an accordion button (an <h3> wrapping it, so the page's
 * heading outline stays intact) that slides the text open.
 *
 * globals.css shows the text on fine pointers before hydration too, so the
 * desktop layout does not jump when the effect below switches modes.
 * Same hidden-text rules as InfoHint: see `useReveal`.
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
  const [plain, setPlain] = useState(false);
  const revealRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const id = useId();

  useReveal(open, setOpen, revealRef, bodyRef);

  useEffect(() => {
    const mq = window.matchMedia(FINE_POINTER);
    const sync = () => {
      setPlain(mq.matches);
      if (mq.matches) setOpen(true);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const row = (
    <>
      {leading}
      <span className="min-w-0 flex-1">{title}</span>
    </>
  );

  return (
    <li className={cn('hint-card rounded-xl border border-border bg-card', className)}>
      <h3 className="text-sm font-bold leading-snug">
        {plain ? (
          <span className="flex items-center gap-3 p-3">{row}</span>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
            className="flex w-full items-center gap-3 rounded-xl p-3 text-left"
          >
            {row}
            <ChevronDown
              className={cn(
                'hint-card-chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                open && 'rotate-180'
              )}
              aria-hidden="true"
            />
          </button>
        )}
      </h3>
      <div ref={revealRef} className="hint-reveal">
        <div>
          <p id={id} ref={bodyRef} className="hint-card-body -mt-1 px-3 pb-3 text-sm leading-relaxed text-muted-foreground" hidden>
            {hint}
          </p>
        </div>
      </div>
    </li>
  );
}
