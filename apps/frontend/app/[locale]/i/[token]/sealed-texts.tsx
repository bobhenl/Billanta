'use client';

import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from 'react';
import { Download, KeyRound, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forgetClientKeys, openClientTexts, type ClientCipherText, type ClientTextsResult } from '@faktur/cz-compliance';
import { renderClientPdf, saveDocument } from '@/lib/vault/documents';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { PrintButton } from './print-button';

type State = { status: 'opening' } | ({ status: 'done'; forgotten?: true } & ClientTextsResult);

const SealedContext = createContext<{ state: State; items: (ClientCipherText | null)[]; preview: boolean; forget: (keyIds: string[]) => void }>({
  state: { status: 'done', texts: [], source: null },
  items: [],
  preview: false,
  forget: () => {}
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
export function SealedTextsProvider({ items, preview, children }: { items: (ClientCipherText | null)[]; preview: boolean; children: ReactNode }) {
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

  return <SealedContext.Provider value={{ state, items, preview, forget }}>{children}</SealedContext.Provider>;
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
