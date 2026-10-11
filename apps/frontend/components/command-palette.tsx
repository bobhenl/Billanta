'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BarChart3,
  Blocks,
  Keyboard,
  Bot,
  Briefcase,
  Building2,
  CreditCard,
  DatabaseBackup,
  Download,
  FilePlus2,
  FileSliders,
  FileText,
  KeyRound,
  Landmark,
  Timer,
  LayoutDashboard,
  LayoutTemplate,
  Loader2,
  MessageCircle,
  Receipt,
  ReceiptText,
  Search,
  SearchCheck,
  Settings,
  Sparkles,
  UserCog,
  UserPlus,
  Users,
  History,
  type LucideIcon
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { SHORTCUTS_EVENT } from '@/components/keyboard-shortcuts';
import { fuzzyScore } from '@/lib/fuzzy';
import { invoiceQueryHref, parseInvoiceQuery } from '@/lib/nl-search';
import { loadPaletteData, type PaletteContact, type PaletteInvoice } from '@/lib/search-actions';
import { cn } from '@/lib/utils';

/** sessionStorage key the invoice form reads to run an AI request typed into the palette. */
export const AI_PROMPT_KEY = 'billanta.aiPrompt';

type Group = 'actions' | 'pages' | 'invoices' | 'contacts' | 'ai';

/** Custom event: open the palette (optionally straight in AI mode). */
export const PALETTE_EVENT = 'billanta:palette';

interface Item {
  id: string;
  group: Group;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
  /** Extra words the fuzzy match looks at ("faktura", "nová"…). */
  keywords?: string;
  /** Keyboard shortcut shown on the right. */
  shortcut?: string;
  /** Small chips under the label (what AI search understood). */
  chips?: string[];
}

interface Entry {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Message key for the label (root namespace). */
  label: string;
  /** Section in `hidden` that removes this entry. */
  section?: string;
  shortcut?: string;
}

/** Also the phone tab bar's "+" panel (`mobile-bottom-nav.tsx`). */
export const ACTIONS: Entry[] = [
  { key: 'newInvoice', href: '/invoices/new', icon: FilePlus2, label: 'palette.actions.newInvoice', section: 'createInvoices', shortcut: 'N' },
  { key: 'newProforma', href: '/invoices/new?type=proforma', icon: ReceiptText, label: 'palette.actions.newProforma', section: 'createInvoices', shortcut: 'P' },
  { key: 'newQuote', href: '/invoices/new?type=quote', icon: FileText, label: 'palette.actions.newQuote', section: 'quotes' },
  { key: 'newExpense', href: '/expenses/new', icon: Receipt, label: 'palette.actions.newExpense', section: 'createExpenses', shortcut: 'V' },
  { key: 'newContact', href: '/contacts?new=1', icon: UserPlus, label: 'palette.actions.newContact', section: 'createContacts', shortcut: 'Z' },
  { key: 'bulk', href: '/invoices/bulk', icon: FileText, label: 'palette.actions.bulk', section: 'createInvoices' },
  { key: 'exportData', href: '/settings/exports', icon: Download, label: 'palette.actions.export', section: 'exports' },
  { key: 'invite', href: '/settings/team', icon: Users, label: 'palette.actions.invite', section: 'billing' }
];

const PAGES: Entry[] = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard, label: 'nav.dashboard', shortcut: 'G D' },
  { key: 'invoices', href: '/invoices', icon: FileText, label: 'nav.invoices', section: 'invoices', shortcut: 'G I' },
  { key: 'templates', href: '/invoices/templates', icon: LayoutTemplate, label: 'palette.pages.templates', section: 'invoices' },
  { key: 'expenses', href: '/expenses', icon: Receipt, label: 'nav.expenses', section: 'expenses', shortcut: 'G E' },
  { key: 'reports', href: '/reports', icon: BarChart3, label: 'nav.reports' },
  { key: 'bank', href: '/bank', icon: Landmark, label: 'nav.bank', section: 'bank', shortcut: 'G B' },
  { key: 'time', href: '/time', icon: Timer, label: 'nav.time', section: 'time', shortcut: 'G T' },
  { key: 'contacts', href: '/contacts', icon: Users, label: 'nav.contacts', section: 'contacts', shortcut: 'G C' },
  { key: 'settings', href: '/settings', icon: Settings, label: 'nav.settings', shortcut: 'G S' },
  { key: 'activity', href: '/activity', icon: History, label: 'nav.activity' },
  { key: 'profile', href: '/settings/profile', icon: UserCog, label: 'settings.hub.items.profile.title' },
  { key: 'company', href: '/settings/company', icon: Building2, label: 'settings.hub.items.company.title' },
  { key: 'companies', href: '/settings/companies', icon: Briefcase, label: 'settings.hub.items.companies.title' },
  { key: 'invoiceSettings', href: '/settings/invoices', icon: FileSliders, label: 'settings.hub.items.invoices.title' },
  { key: 'modules', href: '/settings/modules', icon: Blocks, label: 'settings.hub.items.modules.title' },
  { key: 'team', href: '/settings/team', icon: Users, label: 'settings.hub.items.team.title' },
  { key: 'billing', href: '/billing', icon: CreditCard, label: 'nav.billing', section: 'billing' },
  { key: 'exports', href: '/settings/exports', icon: Download, label: 'settings.hub.items.exports.title', section: 'exports' },
  { key: 'backup', href: '/settings/backup', icon: DatabaseBackup, label: 'settings.hub.items.backup.title' },
  { key: 'channels', href: '/settings/channels', icon: MessageCircle, label: 'settings.hub.items.channels.title' },
  { key: 'ai', href: '/settings/ai', icon: Bot, label: 'settings.hub.items.ai.title', section: 'ai' },
  { key: 'apiKeys', href: '/settings/api-keys', icon: KeyRound, label: 'settings.hub.items.apiKeys.title' }
];

// Customers and pages before invoices: there are few of them, but invoices pile up.
const GROUP_ORDER: Group[] = ['ai', 'actions', 'contacts', 'pages', 'invoices'];
const LIMIT = 6;

/**
 * Ctrl/⌘+K search across the dashboard (VoxelRank-style): actions, pages,
 * invoices and customers in one typo-tolerant list, plus "create an invoice
 * with AI" from whatever was typed. Invoices and contacts load once per
 * opening; `hidden` drops what this member can't use or the company
 * switched off (same keys as the nav, plus create*, quotes, exports, ai).
 */
export function CommandPalette({ hidden = [] }: { hidden?: string[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [data, setData] = useState<{ invoices: PaletteInvoice[]; contacts: PaletteContact[]; aiReady: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isHidden = useCallback((section?: string) => Boolean(section && hidden.includes(section)), [hidden]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = (event: Event) => {
      setAiMode(Boolean((event as CustomEvent<{ ai?: boolean }>).detail?.ai));
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    setLoading(true);
    loadPaletteData()
      .then(setData)
      .catch(() => setData({ invoices: [], contacts: [], aiReady: false }))
      .finally(() => setLoading(false));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const money = (amount: number, currency: string) => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
      } catch {
        return `${amount} ${currency}`;
      }
    };
    const entries = (list: Entry[], group: Group): Item[] =>
      list
        .filter((e) => !isHidden(e.section))
        .map((e) => ({
          id: `${group}:${e.key}`,
          group,
          label: t(e.label),
          icon: e.icon,
          keywords: t.has(`palette.keywords.${e.key}`) ? t(`palette.keywords.${e.key}`) : undefined,
          shortcut: e.shortcut,
          run: () => go(e.href)
        }));

    const actions = entries(ACTIONS, 'actions');
    actions.push({
      id: 'actions:shortcuts',
      group: 'actions',
      label: t('palette.actions.shortcuts'),
      icon: Keyboard,
      keywords: t('palette.keywords.shortcuts'),
      shortcut: '?',
      run: () => {
        setOpen(false);
        window.dispatchEvent(new Event(SHORTCUTS_EVENT));
      }
    });
    const pages = entries(PAGES, 'pages');
    if (!q) return [...actions, ...pages.slice(0, 7)];

    const rank = <T,>(list: T[], fields: (x: T) => (string | null | undefined)[]) =>
      list
        .map((x) => ({ x, score: fuzzyScore(q, fields(x)) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, LIMIT)
        .map((r) => r.x);

    const out: Item[] = [];
    // AI search: the question turned into the invoice list's filters.
    if (!isHidden('invoices') && q.length >= 3) {
      const nl = parseInvoiceQuery(q, data?.contacts.map((c) => c.name) ?? []);
      const meaningful = nl.understood.some((u) => u.kind !== 'text');
      if (meaningful || aiMode) {
        out.push({
          id: 'ai:search',
          group: 'ai',
          label: t('palette.aiSearch'),
          icon: SearchCheck,
          chips: nl.understood.map((u) =>
            u.kind === 'status'
              ? t(`palette.nlStatus.${u.value}`)
              : u.kind === 'type'
                ? t(`doc.type.${u.value}`)
                : u.value
          ),
          run: () => go(invoiceQueryHref(nl))
        });
      }
    }
    if (data?.aiReady && !isHidden('ai') && !isHidden('createInvoices') && q.length >= 3) {
      out.push({
        id: 'ai:invoice',
        group: 'ai',
        label: t('palette.aiInvoice', { q }),
        hint: t('palette.aiHint'),
        icon: Sparkles,
        run: () => {
          try {
            sessionStorage.setItem(AI_PROMPT_KEY, q);
          } catch {
            /* the form just opens without the prompt */
          }
          go('/invoices/new?ai=1');
        }
      });
    }
    out.push(...rank(actions, (a) => [a.label, a.keywords]));
    if (data && !isHidden('invoices')) {
      out.push(
        ...rank(data.invoices, (i) => [i.number, i.contact, i.ico, i.vs]).map((i) => ({
          id: `inv:${i.id}`,
          group: 'invoices' as const,
          label: `${i.number ?? t('palette.draft')} · ${i.contact ?? '–'}`,
          hint: `${money(i.total, i.currency)} · ${t.has(`invoices.status.${i.status}`) ? t(`invoices.status.${i.status}`) : i.status}`,
          icon: FileText,
          run: () => go(`/invoices/${i.id}`)
        }))
      );
    }
    if (data && !isHidden('contacts')) {
      out.push(
        ...rank(data.contacts, (c) => [c.name, c.ico, c.email]).map((c) => ({
          id: `con:${c.id}`,
          group: 'contacts' as const,
          label: c.name,
          hint: [c.ico && `IČO ${c.ico}`, c.email].filter(Boolean).join(' · ') || undefined,
          icon: Users,
          run: () => go(`/contacts/${c.id}`)
        }))
      );
    }
    out.push(...rank(pages, (p) => [p.label, p.keywords]));
    // In AI mode (or when the text reads like a question) AI leads; otherwise
    // real hits come first and AI suggestions follow.
    const aiFirst = aiMode || out.filter((i) => i.group !== 'ai').length === 0 || out.some((i) => i.id === 'ai:search');
    const order = aiFirst ? GROUP_ORDER : [...GROUP_ORDER.slice(1), 'ai' as const];
    return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  }, [query, data, t, locale, isHidden, go, aiMode]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onInputKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      items[active]?.run();
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      setAiMode((v) => !v);
    }
  };

  return (
    <>
      <div className="flex items-center rounded-full border border-border bg-secondary/50 text-sm text-muted-foreground transition-colors hover:border-primary">
        <button
          type="button"
          onClick={() => {
            setAiMode(false);
            setOpen(true);
          }}
          aria-label={t('palette.open')}
          title={`${t('palette.open')} (Ctrl K)`}
          className="flex items-center gap-2 rounded-l-full py-1.5 pl-2.5 pr-1.5 hover:text-foreground lg:min-w-[9.5rem]"
        >
          <Search className="h-4 w-4" />
          <span className="hidden flex-1 text-left lg:inline">{t('palette.trigger')}</span>
          <kbd className="hidden rounded border border-border bg-background px-1.5 text-[10px] font-semibold lg:inline">Ctrl K</kbd>
        </button>
        <button
          type="button"
          onClick={() => {
            setAiMode(true);
            setOpen(true);
          }}
          aria-label={t('palette.aiOpen')}
          title={t('palette.aiOpen')}
          className="flex items-center rounded-r-full border-l border-border py-1.5 pl-1.5 pr-2.5 text-primary hover:text-primary/80"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      </div>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div role="dialog" aria-modal="true" aria-label={t('palette.open')} className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border px-4">
              {aiMode ? <Sparkles className="h-4 w-4 shrink-0 text-primary" /> : <Search className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKey}
                placeholder={aiMode ? t('palette.aiPlaceholder') : t('palette.placeholder')}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={items[active] ? `palette-${active}` : undefined}
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none ring-0 placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <button
                type="button"
                onClick={() => {
                  setAiMode((v) => !v);
                  inputRef.current?.focus();
                }}
                aria-pressed={aiMode}
                title={t('palette.aiToggle')}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors',
                  aiMode ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'
                )}
              >
                <Sparkles className="h-3 w-3" />
                AI
              </button>
              <kbd className="rounded border border-border px-1.5 text-[10px] text-muted-foreground">Esc</kbd>
            </div>
            <div ref={listRef} id="palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
              {aiMode && !query.trim() && (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  <p className="mb-2">{t('palette.aiIntro')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['ex1', 'ex2', 'ex3', 'ex4'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setQuery(t(`palette.aiExamples.${k}`));
                          inputRef.current?.focus();
                        }}
                        className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
                      >
                        {t(`palette.aiExamples.${k}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('palette.empty')}</p>}
              {items.map((item, index) => {
                const Icon = item.icon;
                const first = index === 0 || items[index - 1]?.group !== item.group;
                return (
                  <div key={item.id}>
                    {first && (
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`palette.groups.${item.group}`)}</p>
                    )}
                    <button
                      type="button"
                      id={`palette-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={index === active}
                      onMouseMove={() => setActive(index)}
                      onClick={item.run}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                        index === active ? 'bg-accent text-foreground' : 'text-foreground/90'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                          item.group === 'ai' ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.label}</span>
                        {item.hint && <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>}
                        {item.chips && item.chips.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {item.chips.map((c) => (
                              <span key={c} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                {c}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      {item.shortcut && (
                        <span className="hidden shrink-0 gap-1 sm:flex">
                          {item.shortcut.split(' ').map((k) => (
                            <kbd key={k} className="rounded border border-border bg-background px-1.5 text-[10px] font-semibold text-muted-foreground">
                              {k}
                            </kbd>
                          ))}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <span>↑↓ {t('palette.navigate')}</span>
              <span>↵ {t('palette.select')}</span>
              <span>Tab {t('palette.aiTab')}</span>
              <span className="ml-auto hidden sm:inline">{t('palette.typoHint')}</span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
