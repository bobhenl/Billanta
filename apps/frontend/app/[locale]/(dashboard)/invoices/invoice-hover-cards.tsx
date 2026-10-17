'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatDate, formatMoney, fxLabelOf, type InvoiceRow } from '@/lib/invoice-ui';

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 150;

/**
 * Hover/focus popover shared by the amount tooltip and the customer card.
 * Opens after a short delay on mouse hover or on keyboard focus (never on a
 * tap, so a tap still opens the row), closes on leave, blur or Esc. The card
 * is `position: fixed` next to the trigger, so the table never shifts.
 */
function HoverPopover({
  trigger,
  children,
  onOpen,
  onClose,
  width = 288,
  interactive = false
}: {
  trigger: ReactNode;
  children: ReactNode;
  onOpen?: () => void;
  onClose?: () => void;
  width?: number;
  /** Holds a link: not a plain tooltip, and keyboard users can Tab into it. */
  interactive?: boolean;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const isOpen = useRef(false);
  const close = useCallback(() => {
    clear();
    if (!isOpen.current) return;
    isOpen.current = false;
    setPos(null);
    onClose?.();
  }, [onClose]);
  const open = useCallback(() => {
    clear();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || isOpen.current) return;
    isOpen.current = true;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPos({ top: rect.bottom + 6, left });
    onOpen?.();
  }, [onOpen, width]);
  const later = (fn: () => void, ms: number) => {
    clear();
    timer.current = setTimeout(fn, ms);
  };

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Focus inside the card would be lost with it: hand it back to the trigger.
      if (wrapRef.current?.contains(document.activeElement)) (wrapRef.current.firstElementChild as HTMLElement | null)?.focus();
      close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos, close]);
  useEffect(() => clear, []);

  return (
    <span
      ref={wrapRef}
      className="inline-block"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        // Moving from the trigger into the card keeps it open.
        if (isOpen.current) clear();
        else later(open, OPEN_DELAY_MS);
      }}
      onPointerLeave={(e) => e.pointerType === 'mouse' && later(close, CLOSE_DELAY_MS)}
      onFocus={(e) => {
        // Keyboard focus only: a tap also focuses, but must just open the row.
        if (e.target === e.currentTarget.firstElementChild && e.target.matches(':focus-visible')) open();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <span tabIndex={0} aria-describedby={pos ? id : undefined} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {trigger}
      </span>
      {pos && (
        <span
          id={id}
          role={interactive ? undefined : 'tooltip'}
          style={{ top: pos.top, left: pos.left, width }}
          className="fixed z-50 block cursor-default rounded-lg border border-border bg-card p-3 text-left text-xs font-normal leading-relaxed text-foreground shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** The total cell: CZK equivalent at the stored ČNB rate, or the VAT split for CZK. */
export function AmountHover({ row, children }: { row: InvoiceRow; children: ReactNode }) {
  const t = useTranslations('invoices.hover');
  const locale = useLocale();
  const rate = row.exchangeRate ? Number(row.exchangeRate) : null;
  let info: string | null = null;
  if (row.currency !== 'CZK' && rate) {
    const amount = formatMoney(row.total * rate, 'CZK', locale);
    const rateText = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(rate);
    const fx = fxLabelOf(row);
    if (fx.kind === 'annual' && fx.year) info = t('fxAnnual', { amount, rate: rateText, year: fx.year });
    else if (fx.kind === 'manual' || fx.kind === 'hidden') info = t('fxManual', { amount, rate: rateText });
    else {
      const date = formatDate(fx.kind === 'on' ? fx.date : (row.taxableSupplyDate ?? row.issueDate), locale);
      info = date ? t('fx', { amount, rate: rateText, date }) : t('fxNoDate', { amount, rate: rateText });
    }
  } else if (row.currency === 'CZK' && row.totalVat !== 0) {
    info = t('breakdown', { base: formatMoney(row.totalWithoutVat, 'CZK', locale), vat: formatMoney(row.totalVat, 'CZK', locale) });
  }
  if (!info) return <>{children}</>;
  return (
    <HoverPopover trigger={children} width={260}>
      {info}
    </HoverPopover>
  );
}

interface ContactSummary {
  id: string;
  legalName: string;
  email: string | null;
  ico: string | null;
  country: string;
  invoiceCount: number;
  overdueCount: number;
  lastInvoiceDate: string | null;
  byCurrency: { currency: string; invoiceCount: number; invoiced: number; unpaid: number; overdue: number }[];
}

// Per-session cache: one request per contact, shared by every row of that contact.
const summaryCache = new Map<string, ContactSummary>();

/** The customer cell: a small contact card, fetched on first hover/focus. */
export function ContactHover({ contactId, children }: { contactId: string | null; children: ReactNode }) {
  const t = useTranslations('invoices.hover');
  const locale = useLocale();
  const [data, setData] = useState<ContactSummary | null>(contactId ? summaryCache.get(contactId) ?? null : null);
  const [failed, setFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const onOpen = useCallback(() => {
    if (!contactId) return;
    const cached = summaryCache.get(contactId);
    if (cached) return setData(cached);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setFailed(false);
    fetch(`/api/contacts/${contactId}/summary`, { signal: ctrl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ContactSummary>) : Promise.reject(new Error(String(res.status)))))
      .then((summary) => {
        summaryCache.set(contactId, summary);
        setData(summary);
      })
      .catch(() => !ctrl.signal.aborted && setFailed(true));
  }, [contactId]);
  // Leaving before the answer arrives cancels the request.
  const onClose = useCallback(() => abort.current?.abort(), []);
  useEffect(() => () => abort.current?.abort(), []);

  if (!contactId) return <>{children}</>;
  const money = (n: number, c: string) => formatMoney(n, c, locale);
  return (
    <HoverPopover trigger={children} onOpen={onOpen} onClose={onClose} interactive>
      {!data ? (
        <span className="text-muted-foreground">{failed ? t('error') : t('loading')}</span>
      ) : (
        <span className="block space-y-1.5">
          <span className="block">
            <span className="block text-sm font-semibold">{data.legalName}</span>
            {data.email && <span className="block truncate text-muted-foreground">{data.email}</span>}
            <span className="block text-muted-foreground">
              {data.ico ? `${t('ico')} ${data.ico} · ` : ''}
              {data.country}
            </span>
          </span>
          {data.invoiceCount === 0 ? (
            <span className="block text-muted-foreground">{t('none')}</span>
          ) : (
            <span className="block space-y-1 border-t border-border pt-1.5">
              <span className="block font-medium">{t('count', { count: data.invoiceCount })}</span>
              {data.byCurrency.map((c) => (
                <span key={c.currency} className="grid grid-cols-[1fr_auto] gap-x-3 tabular-nums">
                  <span className="text-muted-foreground">{t('invoiced')}</span>
                  <span className="text-right">{money(c.invoiced, c.currency)}</span>
                  {c.unpaid > 0 && (
                    <>
                      <span className="text-muted-foreground">{t('unpaid')}</span>
                      <span className="text-right">{money(c.unpaid, c.currency)}</span>
                    </>
                  )}
                  {c.overdue > 0 && (
                    <>
                      <span className="text-destructive">{t('overdue')}</span>
                      <span className="text-right font-semibold text-destructive">{money(c.overdue, c.currency)}</span>
                    </>
                  )}
                </span>
              ))}
              {data.lastInvoiceDate && (
                <span className="block text-muted-foreground">
                  {t('last')}: {formatDate(data.lastInvoiceDate, locale)}
                </span>
              )}
            </span>
          )}
          <Link href={`/contacts/${data.id}`} className="inline-block font-medium text-primary hover:underline">
            {t('open')}
          </Link>
        </span>
      )}
    </HoverPopover>
  );
}
