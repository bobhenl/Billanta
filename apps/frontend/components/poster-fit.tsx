'use client';

import { useEffect, useRef } from 'react';

const overflows = (body: HTMLElement) => body.scrollHeight > body.clientHeight + 1;

/**
 * Copy length differs a lot between cs, sk and en, and the event line and
 * tear-off strips take room too. Instead of tuning sizes for every mix, each
 * sheet first shrinks its headline (`--fit`), then all of its type, until the
 * body fits. Printing uses the same DOM, so the fitted sizes carry over.
 */
export function PosterFit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current?.parentElement;
    if (!root) return;
    const fit = () => {
      for (const sheet of root.querySelectorAll<HTMLElement>('[data-poster-sheet]')) {
        const body = sheet.firstElementChild as HTMLElement | null;
        if (!body) continue;
        const base = Number(sheet.dataset.fontMm);
        sheet.style.setProperty('--fit', '1');
        sheet.style.fontSize = `${base}mm`;
        for (let f = 1; overflows(body) && f > 0.72; f -= 0.04) sheet.style.setProperty('--fit', f.toFixed(2));
        for (let k = 1; overflows(body) && k > 0.8; k -= 0.02) sheet.style.fontSize = `${(base * k).toFixed(3)}mm`;
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, []);
  return <span ref={ref} hidden />;
}
