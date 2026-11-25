'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ExternalLink, EyeOff, FilePlus2, FileText, Link2, MoreHorizontal, RotateCcw, SquareArrowOutUpRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from '@/components/toaster';
import { useCanWrite } from '@/components/access-provider';
import { cn } from '@/lib/utils';
import { menuPosition, type MenuPosition } from '@/lib/menu-position';
import type { BankTransaction } from '@/lib/bank-ui';
import { draftInvoiceFromTransaction, ignoreTransaction, restoreTransaction } from './actions';

/** Opens a bank row in a new tab; also used for ctrl/middle-click on the row itself. */
export function openInNewTab(locale: string, path: string) {
  window.open(`/${locale}${path}`, '_blank', 'noopener');
}

/** The "⋯" menu of one statement line, like the one on the invoice list. */
export function BankRowMenu({ tx }: { tx: BankTransaction }) {
  const t = useTranslations('bank');
  const locale = useLocale();
  const router = useRouter();
  const canEdit = useCanWrite('bank');
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const [pending, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(menuPosition(rect, items.length));
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setPos(null);
    startTransition(async () => {
      const result = await fn();
      toast(result.ok ? { text: done, tone: 'ok' } : { text: `${t('detail.actionFailed')}: ${result.error}`, tone: 'err' });
      router.refresh();
    });
  };

  const detail = `/bank/${tx.id}`;
  const incoming = Number(tx.amount) > 0;
  type Item = { icon: typeof FileText; label: string; onSelect: () => void; write?: boolean };
  const all: Item[] = [
    { icon: ExternalLink, label: t('rowMenu.open'), onSelect: () => router.push(detail) },
    { icon: SquareArrowOutUpRight, label: t('rowMenu.openNewTab'), onSelect: () => (setPos(null), openInNewTab(locale, detail)) },
    ...(tx.matchedInvoiceId
      ? [{ icon: FileText, label: t('rowMenu.openInvoice'), onSelect: () => router.push(`/invoices/${tx.matchedInvoiceId}`) }]
      : []),
    ...(tx.status === 'unmatched' && incoming
      ? [
          { icon: Link2, label: t('rowMenu.findMatch'), write: true, onSelect: () => router.push(detail) },
          {
            icon: FilePlus2,
            label: t('detail.createDraft'),
            write: true,
            onSelect: () => {
              setPos(null);
              startTransition(async () => {
                const result = await draftInvoiceFromTransaction(tx.id);
                if (!result.ok) {
                  toast({ text: `${t('detail.actionFailed')}: ${result.error}`, tone: 'err' });
                  return;
                }
                // A draft to review, never issued: open it so the member checks and issues it.
                toast({ text: t('detail.draftDone'), tone: 'ok' });
                router.push(`/invoices/${result.invoiceId}`);
              });
            }
          }
        ]
      : []),
    ...(tx.status === 'unmatched'
      ? [{ icon: EyeOff, label: t('detail.ignore'), write: true, onSelect: () => run(() => ignoreTransaction(tx.id), t('detail.ignoredDone')) }]
      : []),
    ...(tx.status === 'ignored'
      ? [{ icon: RotateCcw, label: t('detail.restore'), write: true, onSelect: () => run(() => restoreTransaction(tx.id), t('detail.restoredDone')) }]
      : [])
  ];
  const items = canEdit ? all : all.filter((item) => !item.write);

  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        ref={button}
        type="button"
        disabled={pending}
        onClick={() => (pos ? setPos(null) : open())}
        aria-label={t('rowMenu.label')}
        aria-haspopup="menu"
        aria-expanded={Boolean(pos)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:opacity-50"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div role="menu" style={pos} className="fixed z-50 overflow-y-auto w-60 rounded-xl border border-border bg-card p-1.5 text-left shadow-lg">
            {items.map(({ icon: Icon, label, onSelect }) => (
              <button
                key={label}
                role="menuitem"
                type="button"
                onClick={onSelect}
                className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-accent hover:text-primary')}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}
