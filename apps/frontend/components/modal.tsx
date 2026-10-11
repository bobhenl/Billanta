'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A small dialog on the native `<dialog>` element: focus trapping, Esc and
 * the backdrop come from the browser. Rendered only while `open`.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40',
        className
      )}
    >
      {open && (
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 -mt-1 rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Zavřít"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 text-sm">{children}</div>
          {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export const buttonClass = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50',
  ghost:
    'inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:opacity-50'
};

export const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20';
