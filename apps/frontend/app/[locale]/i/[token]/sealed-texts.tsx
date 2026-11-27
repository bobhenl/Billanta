'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forgetClientKeys, openClientTexts, type ClientCipherText, type ClientTextsResult } from '@faktur/cz-compliance';

type State = { status: 'opening' } | ({ status: 'done'; forgotten?: true } & ClientTextsResult);

const SealedContext = createContext<{ state: State; preview: boolean; forget: (keyIds: string[]) => void }>({
  state: { status: 'done', texts: [], source: null },
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

  return <SealedContext.Provider value={{ state, preview, forget }}>{children}</SealedContext.Provider>;
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
