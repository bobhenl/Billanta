'use client';

import { useId, useState, type CSSProperties, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

/** `next` with `id` moved to where `target` is now (before it when moving up, after it when moving down). */
export function moveTo<T>(items: readonly T[], id: T, target: T): T[] {
  const from = items.indexOf(id);
  const to = items.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...items];
  const next = items.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

/** One step up or down; the arrow buttons that keep reordering usable from the keyboard. */
export function moveBy<T>(items: readonly T[], id: T, dir: -1 | 1): T[] {
  const i = items.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return [...items];
  return moveTo(items, id, items[j]!);
}

/**
 * Pointer drag & drop for a short list (mouse, pen and touch alike), without
 * a library: the grip captures the pointer, and whichever item of the same
 * list is under it takes the dragged one's place as it moves. Works for a
 * one-column list and a grid the same way, since it only asks what is under
 * the pointer. Items carry `itemProps(id)`, the grip `handleProps(id)`.
 */
export function useDragSort<T extends string>(items: readonly T[], onChange: (next: T[]) => void) {
  const group = useId();
  const [dragging, setDragging] = useState<T | null>(null);
  const end = () => setDragging(null);

  const handleProps = (id: T) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(id);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (dragging !== id) return;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-sort-group]');
      if (!over || over.dataset.sortGroup !== group) return;
      const target = over.dataset.sortId as T | undefined;
      if (target && target !== id && items.includes(target)) onChange(moveTo(items, id, target));
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    // No page scroll or pinch while the grip is held on a touch screen.
    style: { touchAction: 'none' } as CSSProperties
  });

  const itemProps = (id: T) => ({ 'data-sort-group': group, 'data-sort-id': id });

  return { dragging, handleProps, itemProps };
}

/** The grip a list item is dragged by. Hidden from screen readers: the arrow buttons next to it do the same. */
export function DragHandle({ label, className, ...props }: { label: string; className?: string } & ReturnType<ReturnType<typeof useDragSort>['handleProps']>) {
  return (
    <span
      {...props}
      aria-hidden="true"
      title={label}
      className={cn('flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-secondary active:cursor-grabbing', className)}
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );
}
