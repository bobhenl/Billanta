'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/modal';
import { useRouter } from '@/i18n/navigation';

/** Fired by the palette's "Keyboard shortcuts" entry to open the help sheet. */
export const SHORTCUTS_EVENT = 'billanta:shortcuts';

/** `g` then a letter (Gmail-style) jumps to a section. */
const GO_TO: Record<string, { href: string; section?: string }> = {
  d: { href: '/dashboard' },
  i: { href: '/invoices', section: 'invoices' },
  e: { href: '/expenses', section: 'expenses' },
  b: { href: '/bank', section: 'bank' },
  t: { href: '/time', section: 'time' },
  c: { href: '/contacts', section: 'contacts' },
  s: { href: '/settings' }
};

/** Single-key creates (also with Alt, so they work while a field has focus). */
const CREATE: Record<string, { href: string; section: string }> = {
  n: { href: '/invoices/new', section: 'createInvoices' },
  p: { href: '/invoices/new?type=proforma', section: 'createInvoices' },
  v: { href: '/expenses/new', section: 'createExpenses' },
  z: { href: '/contacts?new=1', section: 'createContacts' }
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/** Forms that save something — not the GET search boxes (`action=""`). */
const savable = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLFormElement>('form')].filter((f) => f.getAttribute('action') !== '' && !f.querySelector('[data-page-search]'));

/**
 * The form Ctrl+S should submit: the one holding focus, else the only one in
 * an open dialog, else the page's only one. Several forms and no focus
 * (e.g. profile: name vs. password) is ambiguous, so nothing happens.
 */
const saveTarget = (target: EventTarget | null): HTMLFormElement | null => {
  const focused = (target as HTMLElement | null)?.closest?.('form');
  if (focused && savable(focused.parentElement ?? document).includes(focused)) return focused;
  const dialog = document.querySelector('dialog[open], [aria-modal="true"]');
  const forms = savable(dialog ?? document);
  return forms.length === 1 ? forms[0]! : null;
};

/**
 * App-wide keyboard shortcuts for the dashboard. Ctrl+K lives in the
 * palette; Ctrl+S submits the current form (the invoice form adds
 * Ctrl+Shift+S to save and issue). Ctrl+N and Ctrl+T are reserved by the browser, hence N / Alt+N for a new invoice.
 * Ctrl+F (or /) focuses the page's own search box (`data-page-search`);
 * pressed again while it has focus, the browser's find takes over.
 */
export function KeyboardShortcuts({ hidden = [] }: { hidden?: string[] }) {
  const t = useTranslations('shortcuts');
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const openHelp = () => setHelp(true);
    window.addEventListener(SHORTCUTS_EVENT, openHelp);

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;

      // Ctrl+S submits the form you're in (or the page's only form) instead of
      // the browser's "Save page". The invoice form handles it itself.
      if (mod && key === 's' && !event.altKey && !event.shiftKey) {
        const form = saveTarget(event.target);
        if (form) {
          event.preventDefault();
          form.requestSubmit();
        }
        return;
      }

      if ((mod && key === 'f' && !event.shiftKey && !event.altKey) || (key === '/' && !mod && !isTyping(event.target))) {
        const search = document.querySelector<HTMLInputElement>('[data-page-search]');
        if (search && document.activeElement !== search) {
          event.preventDefault();
          search.focus();
          search.select();
        }
        return;
      }

      // Alt+letter works everywhere; bare letters only outside text fields.
      const bare = !mod && !event.altKey && !isTyping(event.target);
      const alt = event.altKey && !mod && !event.shiftKey;
      if (!bare && !alt) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;

      if (bare && pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const target = GO_TO[key];
        if (target && !hidden.includes(target.section ?? '')) {
          event.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (bare && key === 'g') {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
        return;
      }
      // F opens/closes the list's filter panel and puts focus in it.
      if (bare && key === 'f' && !event.shiftKey) {
        const panel = document.querySelector<HTMLDetailsElement>('details[data-filter-panel]');
        if (panel) {
          event.preventDefault();
          panel.open = !panel.open;
          if (panel.open) panel.querySelector<HTMLElement>('select, input:not([type=hidden])')?.focus();
        }
        return;
      }
      if (bare && event.key === '?') {
        event.preventDefault();
        setHelp(true);
        return;
      }
      // event.code so Alt+N still means N on layouts where Alt changes the character.
      const letter = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : key;
      const create = CREATE[letter];
      if (create && !event.shiftKey && !hidden.includes(create.section)) {
        event.preventDefault();
        router.push(create.href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(SHORTCUTS_EVENT, openHelp);
    };
  }, [hidden, router]);

  const groups: { title: string; rows: [string[], string][] }[] = [
    {
      title: t('groups.general'),
      rows: [
        [['Ctrl', 'K'], t('palette')],
        [['Ctrl', 'F'], t('search')],
        [['/'], t('search')],
        [['Ctrl', 'S'], t('saveForm')],
        [['F'], t('filters')],
        [['?'], t('help')]
      ]
    },
    {
      title: t('groups.create'),
      rows: [
        [['N'], t('newInvoice')],
        [['Alt', 'N'], t('newInvoiceAnywhere')],
        [['P'], t('newProforma')],
        [['V'], t('newExpense')],
        [['Z'], t('newContact')]
      ]
    },
    {
      title: t('groups.goTo'),
      rows: [
        [['G', 'D'], t('goDashboard')],
        [['G', 'I'], t('goInvoices')],
        [['G', 'E'], t('goExpenses')],
        [['G', 'B'], t('goBank')],
        [['G', 'C'], t('goContacts')],
        [['G', 'S'], t('goSettings')]
      ]
    },
    {
      title: t('groups.invoiceForm'),
      rows: [
        [['Ctrl', 'S'], t('saveDraft')],
        [['Ctrl', 'Shift', 'S'], t('saveIssue')],
        [['Ctrl', 'Enter'], t('runAi')]
      ]
    }
  ];

  return (
    <Modal open={help} onClose={() => setHelp(false)} title={t('title')} className="w-[min(40rem,calc(100vw-2rem))]">
      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h3>
            <ul className="mt-2 space-y-1.5">
              {group.rows.map(([keys, label], i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span>{label}</span>
                  <span className="flex shrink-0 gap-1">
                    {keys.map((k) => (
                      <kbd key={k} className="min-w-[1.5rem] rounded border border-border bg-secondary px-1.5 py-0.5 text-center text-[11px] font-semibold">
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t('note')}</p>
    </Modal>
  );
}
