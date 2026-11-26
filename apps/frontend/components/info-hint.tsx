'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** Gap between the (i) and its tooltip, and the minimum distance to the viewport edge. */
const GAP = 6;
const EDGE = 8;
/** Matches the `.hint-reveal` transition in globals.css. */
const REVEAL_MS = 200;

/**
 * Keeps a server-rendered explanation in the DOM while it is closed and
 * slides it open (`.hint-reveal`, a grid row going 0fr → 1fr). Closed text
 * gets `hidden="until-found"` where supported, so Ctrl+F finds it and opens
 * it (`beforematch`), and crawlers and screen readers still see it.
 *
 * `hidden` and `data-open` are owned by this hook rather than by React,
 * because React would reset `until-found` back to a plain boolean on the
 * next render, and the transition needs the text unhidden one frame before
 * the row starts to grow.
 */
export function useReveal(
  open: boolean,
  setOpen: (open: boolean) => void,
  revealRef: RefObject<HTMLElement | null>,
  bodyRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const wrap = revealRef.current;
    const el = bodyRef.current;
    if (!wrap || !el) return;
    const hide = () => el.setAttribute('hidden', 'onbeforematch' in document.body ? 'until-found' : '');
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      el.removeAttribute('hidden');
      void wrap.offsetHeight;
      wrap.setAttribute('data-open', '');
    } else if (wrap.hasAttribute('data-open')) {
      wrap.removeAttribute('data-open');
      const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      timer = setTimeout(hide, instant ? 0 : REVEAL_MS);
    } else {
      hide();
    }
    // The browser scrolls to the match right after this event, so the row
    // has to be at full height already, without waiting for a transition.
    const onMatch = () => {
      wrap.style.transition = 'none';
      wrap.setAttribute('data-open', '');
      void wrap.offsetHeight;
      wrap.style.transition = '';
      setOpen(true);
    };
    el.addEventListener('beforematch', onMatch);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('beforematch', onMatch);
    };
  }, [open, setOpen, revealRef, bodyRef]);
}

/**
 * The (i) pattern: a label stays one compact line, and its explanation sits
 * behind a small info icon. With a mouse (or keyboard focus) the note shows
 * as a tooltip, placed in the viewport so it never runs off-screen; on
 * touch a tap slides it open inline under the label, where there is no
 * hover and no room beside a field. Keyboard Enter does the same, which is
 * also how keyboard users reach links inside a hint.
 *
 * The inline copy is the one that is always in the DOM (see `useReveal`);
 * the tooltip is a visual duplicate in a portal, so it escapes overflow
 * clipping in tables and cards, and it is hidden from screen readers, who
 * get the text through `aria-describedby` instead.
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
  /** Accessible name for the icon; defaults to "More info". */
  label?: string;
  className?: string;
  rowClassName?: string;
  bodyClassName?: string;
}) {
  const t = useTranslations('common');
  const name = label ?? t('moreInfo');
  const [expanded, setExpanded] = useState(false);
  const [tip, setTip] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pointerType = useRef('mouse');
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();

  useReveal(expanded, setExpanded, revealRef, bodyRef);

  const show = () => {
    clearTimeout(leaveTimer.current);
    if (!expanded) setTip(true);
  };
  // A short grace period lets the mouse travel from the icon into the tooltip.
  const hideSoon = () => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setTip(false), 120);
  };
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const place = useCallback(() => {
    const btn = btnRef.current;
    const el = tipRef.current;
    if (!btn || !el) return;
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const { offsetWidth: w, offsetHeight: h } = el;
    const left = Math.min(Math.max(r.left - EDGE, EDGE), vw - w - EDGE);
    let top = r.bottom + GAP;
    if (top + h > vh - EDGE) {
      top = r.top - GAP - h >= EDGE ? r.top - GAP - h : Math.max(EDGE, vh - h - EDGE);
    }
    el.style.left = `${Math.max(EDGE, left)}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
  }, []);

  useLayoutEffect(() => {
    if (!tip) return;
    place();
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, { capture: true });
      window.removeEventListener('resize', place);
    };
  }, [tip, place]);

  useEffect(() => {
    if (!tip && !expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (tip) {
        // Escape belongs to the tooltip first, so it does not also close a modal around it.
        e.stopPropagation();
        setTip(false);
      } else if (expanded && rootRef.current?.contains(document.activeElement)) {
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tip, expanded]);

  return (
    <div ref={rootRef} className={className}>
      <div className={cn('relative flex items-center gap-1', rowClassName)}>
        {children}
        <button
          ref={btnRef}
          type="button"
          className="hint-btn"
          aria-label={name}
          aria-describedby={id}
          aria-expanded={expanded}
          aria-controls={id}
          onPointerDown={(e) => {
            pointerType.current = e.pointerType;
          }}
          onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
          onPointerLeave={(e) => e.pointerType === 'mouse' && hideSoon()}
          onFocus={(e) => e.currentTarget.matches(':focus-visible') && show()}
          onBlur={hideSoon}
          onClick={(e) => {
            // Inside a <label> the click would also toggle its checkbox.
            e.preventDefault();
            // A mouse already sees the tooltip; touch, pen and keyboard (detail 0) expand inline.
            if (pointerType.current === 'mouse' && e.detail > 0) {
              show();
              return;
            }
            setTip(false);
            setExpanded(!expanded);
          }}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div ref={revealRef} className="hint-reveal">
        <div>
          <div id={id} ref={bodyRef} className={cn('hint-inline', bodyClassName)} hidden>
            {hint}
          </div>
        </div>
      </div>
      {tip &&
        createPortal(
          <div
            ref={tipRef}
            aria-hidden="true"
            className={cn('hint-tip', bodyClassName)}
            onPointerEnter={() => clearTimeout(leaveTimer.current)}
            onPointerLeave={hideSoon}
          >
            {hint}
          </div>,
          document.body
        )}
    </div>
  );
}
