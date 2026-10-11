'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * The (i) pattern from VoxelRank (`hint()` in src/views/partials.js there):
 * a label stays one compact line, and its explanation sits behind a small
 * round info button that opens a note underneath.
 *
 * The note's text is server-rendered and always present in the DOM — only
 * hidden — so search engines index it and screen readers can reach it. On
 * browsers that support it the note switches to `hidden="until-found"`,
 * which lets in-page search (Ctrl+F) find the text and open the hint by
 * itself (`beforematch`).
 *
 * `hidden` is rendered once and then owned by the effect below rather than
 * by React, because React would otherwise reset `until-found` back to a
 * plain boolean on the next render.
 */
export function InfoHint({
  children,
  hint,
  label,
  className,
  rowClassName,
  bodyClassName
}: {
  /** The visible label row (a heading, a form label, a term). */
  children: ReactNode;
  /** The explanation shown when the (i) is opened. */
  hint: ReactNode;
  /** Accessible name for the button; defaults to "More info". */
  label?: string;
  className?: string;
  rowClassName?: string;
  bodyClassName?: string;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLSpanElement>(null);
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
    <div className={className}>
      <div className={cn('flex items-center gap-1', rowClassName)}>
        {children}
        <button
          type="button"
          className="hint-btn"
          aria-expanded={open}
          aria-controls={id}
          title={label ?? t('moreInfo')}
          onClick={() => setOpen((value) => !value)}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{label ?? t('moreInfo')}</span>
        </button>
      </div>
      <span id={id} ref={bodyRef} className={cn('hint-body', bodyClassName)} hidden>
        {hint}
      </span>
    </div>
  );
}
