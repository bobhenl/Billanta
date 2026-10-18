'use client';

import { useEffect } from 'react';

const PHONE = '(max-width: 639px)';

/**
 * Turns the footer's link columns into an accordion on phones only. The
 * columns are `<details open>` in the HTML, so the desktop grid (and a
 * visitor without JavaScript) sees every link; on a phone this closes them
 * after hydration so the footer is a short list of headings. The footer is
 * far below the fold, so nobody sees it collapse. On wider screens the
 * columns are forced back open and cannot be toggled shut.
 */
export function FooterAccordion({ selector }: { selector: string }) {
  useEffect(() => {
    const columns = Array.from(document.querySelectorAll<HTMLDetailsElement>(selector));
    const phone = window.matchMedia(PHONE);
    const apply = () => columns.forEach((d) => (d.open = !phone.matches));
    const keepOpen = (event: Event) => {
      const d = event.currentTarget as HTMLDetailsElement;
      if (!phone.matches && !d.open) d.open = true;
    };
    apply();
    phone.addEventListener('change', apply);
    columns.forEach((d) => d.addEventListener('toggle', keepOpen));
    return () => {
      phone.removeEventListener('change', apply);
      columns.forEach((d) => d.removeEventListener('toggle', keepOpen));
    };
  }, [selector]);
  return null;
}
