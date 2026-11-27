'use client';

import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from 'react';
import { Download, KeyRound, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  amountTotals,
  decodeItemAmounts,
  forgetClientKeys,
  itemBase,
  openClientTexts,
  type ClientCipherText,
  type ClientTextsResult,
  type DocumentAmounts,
  type ItemAmounts,
  type SealedPdfQrPlan
} from '@faktur/cz-compliance';
import { sealedQrPng } from '@/lib/vault/amounts';
import { renderClientPdf, saveDocument } from '@/lib/vault/documents';
import { PaymentDetails, type PaymentDetailRow } from './payment-details';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { PrintButton } from './print-button';

type State = { status: 'opening' } | ({ status: 'done'; forgotten?: true } & ClientTextsResult);

/** Category "amounts": where the items' amount envelopes sit in `items`. */
export type SealedAmountsSlots = { offset: number; count: number; reverseCharge: boolean };

const SealedContext = createContext<{
  state: State;
  items: (ClientCipherText | null)[];
  preview: boolean;
  forget: (keyIds: string[]) => void;
  amounts: SealedAmountsSlots | null;
}>({
  state: { status: 'done', texts: [], source: null },
  items: [],
  preview: false,
  forget: () => {},
  amounts: null
});

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Opens the encrypted item texts in the client's browser: the key comes from
 * the link's `#k=` (then leaves the address bar) or from this browser's
 * storage. `items` has one entry per line item, null for a plain one.
 */
export function SealedTextsProvider({
  items,
  preview,
  amounts = null,
  children
}: {
  items: (ClientCipherText | null)[];
  preview: boolean;
  amounts?: SealedAmountsSlots | null;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>({ status: 'opening' });
  const itemsJson = JSON.stringify(items);

  useEffect(() => {
    let live = true;
    const list = JSON.parse(itemsJson) as (ClientCipherText | null)[];
    openClientTexts({
      location: window.location,
      history: window.history,
      storage: browserStorage(),
      items: list.map((i) => i ?? { cipher: '', keyId: null }),
      // The supplier's own preview must not leave the key in their browser.
      remember: !preview
    })
      .then((result) => live && setState({ status: 'done', ...result }))
      .catch(() => live && setState({ status: 'done', texts: list.map(() => null), source: null }));
    return () => {
      live = false;
    };
  }, [itemsJson, preview]);

  // Forgetting also closes the texts on screen, so the client sees what this browser keeps now.
  const forget = (keyIds: string[]) => {
    forgetClientKeys(browserStorage(), keyIds);
    setState((s) => (s.status === 'done' ? { status: 'done', texts: s.texts.map(() => null), source: null, forgotten: true } : s));
  };

  return <SealedContext.Provider value={{ state, items, preview, forget, amounts }}>{children}</SealedContext.Provider>;
}

/** The opened amounts of every item and their totals; null while any is closed or broken. */
function useSealedAmounts(): { items: ItemAmounts[]; totals: DocumentAmounts } | null {
  const { state, amounts } = useContext(SealedContext);
  if (!amounts || state.status !== 'done') return null;
  try {
    const items = state.texts.slice(amounts.offset, amounts.offset + amounts.count).map((text) => {
      if (text == null) throw new Error('closed');
      return decodeItemAmounts(text);
    });
    if (items.length !== amounts.count) return null;
    return { items, totals: amountTotals(items, { reverseCharge: amounts.reverseCharge }) };
  } catch {
    return null;
  }
}

function useMoney(currency: string) {
  const locale = useLocale();
  return (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}

function Closed() {
  const t = useTranslations('publicInvoice');
  const { state } = useContext(SealedContext);
  return <span className="text-base font-normal italic text-muted-foreground">{state.status === 'opening' ? '…' : t('confidentialAmount')}</span>;
}

/** One of the document's totals, opened here (`due` is what is left after partial payments). */
export function SealedTotalText({ part, currency, amountPaid = 0 }: { part: 'total' | 'subtotal' | 'vat' | 'due'; currency: string; amountPaid?: number }) {
  const opened = useSealedAmounts();
  const money = useMoney(currency);
  if (!opened) return <Closed />;
  const { totals } = opened;
  const value =
    part === 'subtotal' ? totals.totalWithoutVat : part === 'vat' ? totals.totalVat : part === 'due' ? Math.max(0, totals.totalWithVat - amountPaid) : totals.totalWithVat;
  return <>{money(value)}</>;
}

/** Subtotal and VAT lines, only once opened and only when there is VAT. */
export function SealedVatLines({ currency, subtotalLabel, vatLabel }: { currency: string; subtotalLabel: string; vatLabel: string }) {
  const opened = useSealedAmounts();
  const money = useMoney(currency);
  if (!opened || opened.totals.totalVat <= 0) return null;
  return (
    <>
      <div className="flex justify-between gap-4 text-muted-foreground">
        <span>{subtotalLabel}</span>
        <span className="tabular-nums">{money(opened.totals.totalWithoutVat)}</span>
      </div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        <span>{vatLabel}</span>
        <span className="tabular-nums">{money(opened.totals.totalVat)}</span>
      </div>
    </>
  );
}

/** One number of one item. */
export function SealedItemAmountText({ index, part, currency }: { index: number; part: 'quantity' | 'unitPrice' | 'vat' | 'line' | 'summary'; currency: string }) {
  const t = useTranslations('publicInvoice');
  const opened = useSealedAmounts();
  const money = useMoney(currency);
  const locale = useLocale();
  const item = opened?.items[index];
  if (!item) return part === 'summary' ? null : <span className="italic text-muted-foreground">…</span>;
  const pct = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  switch (part) {
    case 'quantity':
      return <>{item.quantity}</>;
    case 'unitPrice':
      return <>{money(item.unitPrice)}</>;
    case 'vat':
      return <>{item.vatRate != null ? `${pct(item.vatRate)} %` : ''}</>;
    case 'line':
      return <>{money(itemBase(item))}</>;
    case 'summary':
      return (
        <>
          {item.quantity} × {money(item.unitPrice)}
          {item.vatRate != null ? ` · ${t('columns.vatRate')} ${pct(item.vatRate)} %` : ''}
          {item.discountPercent ? ` · ${t('columns.discount')} ${pct(item.discountPercent)} %` : ''}
        </>
      );
  }
}

/**
 * The payment block of a sealed document: the amount and the QR exist only
 * here, once the amounts opened. Until then the account and symbol, so the
 * payer still knows where to pay.
 */
export function SealedPayment({
  rows,
  plan,
  amountPaid = 0,
  currency,
  amountLabel,
  hint
}: {
  rows: PaymentDetailRow[];
  plan: SealedPdfQrPlan | null;
  amountPaid?: number;
  currency: string;
  amountLabel: string;
  hint: ReactNode;
}) {
  const opened = useSealedAmounts();
  const money = useMoney(currency);
  const locale = useLocale();
  const due = opened ? Math.max(0, Math.round((opened.totals.totalWithVat - amountPaid) * 100) / 100) : null;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!plan || due == null || due <= 0) return setQr(null);
    let live = true;
    sealedQrPng(plan, due)
      .then((png) => live && setQr(png))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
    // The plan comes from the server render and does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due]);
  const plain = due == null ? null : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(due);
  const all = due == null ? rows : [...rows, { label: amountLabel, value: money(due), copy: plain, strong: true }];
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
      {qr && (
        <div className="order-last flex flex-col items-center gap-2 sm:order-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="" className="h-44 w-44 shrink-0 rounded-lg bg-white p-1" />
          {hint}
        </div>
      )}
      <PaymentDetails rows={all} />
    </div>
  );
}

/** One line item's text: the opened one, or "Důvěrná položka" while it stays closed. */
export function SealedItemText({ index }: { index: number }) {
  const t = useTranslations('publicInvoice');
  const { state } = useContext(SealedContext);
  const text = state.status === 'done' ? state.texts[index] : null;
  if (text != null) return <span className="whitespace-pre-line break-words">{text}</span>;
  return <span className="italic text-muted-foreground">{state.status === 'opening' ? '…' : t('confidentialItem')}</span>;
}

/** Above the items: where the full text is when this browser has no key, and a way to drop a kept one. */
export function SealedNotice({ keyIds }: { keyIds: string[] }) {
  const t = useTranslations('publicInvoice.sealed');
  const { state, preview, forget } = useContext(SealedContext);
  if (state.status === 'opening') return null;
  const opened = state.texts.some((text) => text != null);

  if (!opened) {
    return (
      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground print:hidden">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span>{state.forgotten ? t('forgotten') : t('noKey')}</span>
      </p>
    );
  }
  return (
    <p className="mt-2 flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground print:hidden">
      <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1">{state.source === 'stored' ? t('openedStored') : preview ? t('openedPreview') : t('openedLink')}</span>
      {/* The preview stored nothing, so there is nothing to forget. */}
      {!preview || state.source === 'stored' ? (
        <button
          type="button"
          className="font-semibold text-primary hover:underline"
          onClick={() => forget(keyIds)}
        >
          {t('forget')}
        </button>
      ) : null}
    </p>
  );
}

/**
 * The download button of an encrypted document: once every item text opened
 * here, this browser draws the PDF from them (the server cannot). Until then,
 * or if drawing fails, the page's own print dialog stays the way out.
 */
export function SealedPdfButton({ token }: { token: string }) {
  const t = useTranslations('publicInvoice');
  const { state, items } = useContext(SealedContext);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const opened = new Map<string, string>();
  if (state.status === 'done') items.forEach((item, i) => item && state.texts[i] != null && opened.set(item.cipher, state.texts[i]!));
  const ready = state.status === 'done' && items.every((item) => !item || opened.has(item.cipher));
  if (!ready || failed) return <PrintButton />;

  const download = () =>
    startTransition(async () => {
      try {
        const doc = await renderClientPdf(token, async (cipher) => {
          const text = opened.get(cipher);
          if (text == null) throw new Error('closed');
          return text;
        });
        saveDocument(doc);
      } catch {
        setFailed(true);
      }
    });

  return (
    <button
      type="button"
      onClick={download}
      disabled={pending}
      className={cn(buttonClass.primary, 'h-10 shrink-0 px-3 sm:px-4 print:hidden')}
      aria-label={t('downloadPdf')}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      <span className="sm:hidden">{t('downloadPdfShort')}</span>
      <span className="hidden sm:inline">{t('downloadPdf')}</span>
    </button>
  );
}
