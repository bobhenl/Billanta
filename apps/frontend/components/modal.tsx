'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonClass } from '@/lib/ui-classes';
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
  const tCommon = useTranslations('common');

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
        'anim-dialog w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40',
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
              className="-mr-2 -mt-2 rounded-full p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={tCommon('close')}
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

/**
 * "Are you sure?" in the app's own dialog instead of `window.confirm`:
 * the way back first as a secondary button, then the confirm, red when
 * `danger` (the same order as every other dialog).
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  backLabel,
  pending = false,
  danger = false,
  icon
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel: React.ReactNode;
  backLabel: React.ReactNode;
  pending?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {backLabel}
          </button>
          <button type="button" className={danger ? buttonClass.danger : buttonClass.primary} disabled={pending} onClick={onConfirm}>
            {icon}
            {confirmLabel}
          </button>
        </>
      }
    >
      {body && <p className="text-muted-foreground">{body}</p>}
    </Modal>
  );
}

export { buttonClass, inputClass } from '@/lib/ui-classes';
