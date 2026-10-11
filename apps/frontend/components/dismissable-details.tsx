'use client';

import { useEffect, useRef, type ComponentProps } from 'react';

/**
 * A `<details>` popover / modal that closes on Escape, on a click outside it,
 * and on a click on any element marked `data-dismiss` (a modal's backdrop or
 * close button). Children stay server-rendered; this only adds the closing.
 */
export function DismissableDetails(props: ComponentProps<'details'>) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = () => {
      el.open = false;
    };
    const onPointer = (event: PointerEvent) => {
      if (el.open && !el.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (el.open && event.key === 'Escape') close();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.dataset.dismiss === 'self' || target.closest('[data-dismiss="button"]')) close();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      el.removeEventListener('click', onClick);
    };
  }, []);

  return <details ref={ref} {...props} />;
}
