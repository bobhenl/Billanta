'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { ColorDot } from '@/components/color-dot';
import { isContactColor } from '@/lib/contact-colors';
import {
  AlertTriangle,
  CalendarPlus,
  FolderInput,
  Globe,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Banknote,
  Calculator,
  CalendarRange,
  ChevronRight,
  Clock,
  CalendarClock,
  Download,
  EyeOff,
  FilePen,
  FilePlus2,
  FileText,
  Landmark,
  LayoutTemplate,
  Paperclip,
  Plus,
  Mic,
  QrCode,
  Receipt,
  RefreshCw,
  Settings2,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  Timer,
  X,
  type LucideIcon
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { Modal, buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { Link, useRouter } from '@/i18n/navigation';
import { STATUS_BADGE_CLASSES, displayStatus, formatDate, formatMoney } from '@/lib/invoice-ui';
import {
  TAX_DEADLINE_KINDS,
  defaultTaxDeadlineKinds,
  relevantTaxDeadlineKinds,
  taxDeadlinesFor,
  type OfficialTaxEvent,
  type TaxProfile,
  type TaxDeadline,
  type TaxDeadlineKind
} from '@/lib/tax-deadlines';
import type { VatStatus } from '@faktur/cz-compliance';
import type { TaxAdvances } from '@/lib/tenant';
import { formatElapsed, formatMinutes, type TimeSummary } from '@/lib/time-ui';

const DEFAULT_PROFILE: TaxProfile = { country: 'CZ', vatStatus: 'non_payer', legalEntity: false };
/** Advances entered in Settings → Firma; without one the deadline links there. */
const SETTINGS_ADVANCE_KINDS: TaxDeadlineKind[] = ['social', 'health', 'flat_tax'];
import { minimumsFor, type MinimumKind } from '@/lib/tax-minimums';
import { cn } from '@/lib/utils';
import { saveDashboardConfig } from './actions';
import { USAGE_DRIVEN_KEYS, recommendDashboard, withUsageDefaults, type DashboardRecommendation, type Usage, type UsageDrivenKey } from '@/lib/usage-defaults';
import {
  DEFAULT_TILES,
  KPI_CARDS,
  QUICK_TILES,
  type DashboardConfig,
  type DashboardConfigPatch,
  type DashboardDoc,
  type DashboardSummary,
  type KpiCard,
  type PeriodStats,
  type QuickTile
} from './types';
import { PeriodReport } from './period-report';

const DEFAULT_CONFIG: DashboardConfig = {
  cards: ['revenue_month', 'unpaid', 'overdue', 'expenses_month'],
  tiles: null,
  showChart: true,
  showRecent: true,
  showTopCustomers: true,
  showDueSoon: true,
  showTaxDeadlines: true,
  taxDeadlines: null,
  showFxRates: true,
  fxCurrencies: null,
  taxAmounts: null
};

const FX_CHOICES = ['EUR', 'USD', 'GBP', 'PLN', 'HUF', 'CHF', 'JPY', 'CNY'] as const;
const DEFAULT_FX = ['EUR', 'USD', 'GBP'];
/** Matches the backend limit on saved ČNB currencies. */
const FX_MAX = 12;

/** Where each KPI card leads, its icon and tone. */
const CARD_META: Record<KpiCard, { href: string; icon: LucideIcon; tone: string }> = {
  revenue_month: { href: '/invoices?type=invoice', icon: TrendingUp, tone: 'bg-primary/10 text-primary' },
  unpaid: { href: '/invoices?status=issued', icon: Clock, tone: 'bg-warning/15 text-warning' },
  overdue: { href: '/invoices?status=overdue', icon: AlertTriangle, tone: 'bg-destructive/10 text-destructive' },
  expenses_month: { href: '/expenses', icon: Receipt, tone: 'bg-secondary text-foreground' },
  revenue_year: { href: '/invoices?type=invoice', icon: CalendarRange, tone: 'bg-primary/10 text-primary' },
  drafts: { href: '/invoices?status=draft', icon: FilePen, tone: 'bg-secondary text-foreground' },
  profit_month: { href: '/expenses', icon: Wallet, tone: 'bg-success/15 text-success' },
  vat_month: { href: '/settings/exports', icon: Calculator, tone: 'bg-accent text-accent-foreground' },
  due_soon: { href: '', icon: CalendarClock, tone: 'bg-warning/15 text-warning' },
  unviewed: { href: '/invoices?status=issued&sent=yes&viewed=no', icon: EyeOff, tone: 'bg-secondary text-foreground' },
  missing_receipts: { href: '/expenses?receipt=no', icon: Paperclip, tone: 'bg-secondary text-foreground' }
};

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Issued documents due today … in 7 days (same window as the backend's DUE_SOON_DAYS). */
function dueSoonHref() {
  const from = new Date();
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  return `/invoices?status=issued&date_field=due&from=${isoDay(from)}&to=${isoDay(to)}`;
}

const TILE_META: Record<QuickTile, { href: string; icon: LucideIcon }> = {
  new_invoice: { href: '/invoices/new', icon: FilePlus2 },
  new_proforma: { href: '/invoices/new?type=proforma', icon: Banknote },
  new_quote: { href: '/invoices/new?type=quote', icon: FileText },
  new_expense: { href: '/expenses/new', icon: Receipt },
  scan_invoice: { href: '/expenses/new?scan=1', icon: QrCode },
  dictate_invoice: { href: '/invoices/new?dictate=1', icon: Mic },
  calendar_feed: { href: '/settings/integrations', icon: CalendarPlus },
  public_profile: { href: '/settings/public-profile', icon: Globe },
  migration: { href: '/settings/import', icon: FolderInput },
  templates: { href: '/invoices/templates', icon: LayoutTemplate },
  bulk: { href: '/invoices/bulk', icon: Users },
  new_contact: { href: '/contacts', icon: UserPlus },
  bank: { href: '/bank', icon: Landmark },
  bank_sync: { href: '/bank', icon: RefreshCw },
  exports: { href: '/settings/exports', icon: Download }
};

function normalize(config: DashboardConfig | null): DashboardConfig {
  const merged = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  return { ...merged, cards: merged.cards.filter((c): c is KpiCard => (KPI_CARDS as readonly string[]).includes(c)) };
}

export function DashboardView({
  summary,
  initialConfig,
  firstName,
  profile = DEFAULT_PROFILE,
  advances = {},
  country = 'CZ',
  time = null,
  stats = null,
  usage = null
}: {
  summary: DashboardSummary;
  initialConfig: DashboardConfig | null;
  firstName: string | null;
  /** VAT status, country and legal form: decides which deadlines apply. */
  profile?: TaxProfile;
  /** Advances typed in Settings → Firma (win over the dashboard amounts). */
  advances?: TaxAdvances;
  /** Company country: an SK company books its insurance as an expense from the deadline card. */
  country?: string;
  time?: TimeSummary | null;
  /** The period card; without it (older backend) the fixed 12-month chart shows. */
  stats?: PeriodStats | null;
  /** What the company uses: decides the defaults the member hasn't overridden. */
  usage?: Usage | null;
}) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const [stored, setStored] = useState(() => normalize(initialConfig));
  const [savedKeys, setSavedKeys] = useState<string[] | undefined>(initialConfig?.savedKeys);
  const recommendation = useMemo(() => recommendDashboard(usage), [usage]);
  // Saved choices win; every key the member never touched follows usage.
  const config = useMemo(() => normalize(withUsageDefaults(stored, savedKeys, recommendation)), [stored, savedKeys, recommendation]);
  const [customizing, setCustomizing] = useState(false);
  const money = (n: number) => formatMoney(n, summary.currency, locale);
  const { kpi } = summary;
  const tiles = (config.tiles ?? DEFAULT_TILES).filter((id): id is QuickTile => (QUICK_TILES as readonly string[]).includes(id));

  const cardValue: Record<KpiCard, { value: string; sub: string }> = {
    revenue_month: { value: money(kpi.revenueMonth), sub: t('cards.revenue_month.sub') },
    unpaid: { value: money(kpi.unpaidTotal), sub: t('cards.unpaid.sub', { count: kpi.unpaidCount }) },
    overdue: { value: money(kpi.overdueTotal), sub: t('cards.overdue.sub', { count: kpi.overdueCount }) },
    expenses_month: { value: money(kpi.expensesMonth), sub: t('cards.expenses_month.sub') },
    revenue_year: { value: money(kpi.revenueYear), sub: t('cards.revenue_year.sub') },
    drafts: { value: String(kpi.draftCount), sub: t('cards.drafts.sub') },
    profit_month: { value: money(kpi.profitMonth), sub: t('cards.profit_month.sub') },
    vat_month: { value: money(kpi.vatMonth), sub: t('cards.vat_month.sub') },
    due_soon: { value: money(kpi.dueSoonTotal ?? 0), sub: t('cards.due_soon.sub', { count: kpi.dueSoonCount ?? 0 }) },
    unviewed: { value: String(kpi.unviewedCount ?? 0), sub: t('cards.unviewed.sub') },
    missing_receipts: { value: String(kpi.missingReceiptsCount ?? 0), sub: t('cards.missing_receipts.sub') }
  };

  const hasData = summary.recent.length > 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{firstName ? t('greeting', { name: firstName }) : t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('welcome')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setCustomizing(true)} className={buttonClass.secondary}>
            <Settings2 className="h-4 w-4" />
            {t('customize')}
          </button>
          <Link href="/invoices/new" className={buttonClass.primary}>
            <Plus className="h-4 w-4" />
            {t('newInvoice')}
          </Link>
        </div>
      </div>

      {config.cards.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {config.cards.map((card) => {
            const meta = CARD_META[card];
            const Icon = meta.icon;
            const alert = card === 'overdue' && kpi.overdueCount > 0;
            return (
              <Link
                key={card}
                href={card === 'due_soon' ? dueSoonHref() : meta.href}
                className={cn(
                  'group rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md',
                  alert ? 'border-destructive/40' : 'border-border'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`cards.${card}.label`)}</span>
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', meta.tone)}>
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className={cn('mt-2 truncate text-xl font-extrabold tabular-nums sm:text-2xl', alert && 'text-destructive')}>{cardValue[card].value}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">{cardValue[card].sub}</span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                </p>
              </Link>
            );
          })}
        </div>
      )}
      {summary.foreignCurrencyCount > 0 && <p className="mt-2 text-xs text-muted-foreground">{t('foreignNote', { count: summary.foreignCurrencyCount })}</p>}

      {tiles.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tiles.map((tile) => {
            const { href, icon: Icon } = TILE_META[tile];
            return (
              <Link
                key={tile}
                href={href}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
              >
                <Icon className="h-4 w-4" />
                {t(`tiles.${tile}`)}
              </Link>
            );
          })}
        </div>
      )}

      {!hasData && (
        <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="font-bold">{t('emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('emptyHint')}</p>
          <Link href="/invoices/new" className={cn(buttonClass.primary, 'mt-4')}>
            {t('newInvoice')}
          </Link>
        </div>
      )}

      {summary.overdue.length > 0 && (
        <section className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-bold text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {t('overdueTitle', { count: kpi.overdueCount })}
            </h2>
            <Link href="/invoices?status=overdue" className="text-sm font-semibold text-destructive hover:underline">
              {t('showAll')}
            </Link>
          </div>
          <DocList docs={summary.overdue} showDue />
        </section>
      )}

      {config.showDueSoon && (summary.dueSoon?.length ?? 0) > 0 && (
        <section className="mt-6 rounded-xl border border-warning/30 bg-warning/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-bold">
              <CalendarClock className="h-4 w-4 text-warning" />
              {t('dueSoonTitle', { count: kpi.dueSoonCount ?? 0 })}
            </h2>
            <Link href={dueSoonHref()} className="text-sm font-semibold text-primary hover:underline">
              {t('showAll')}
            </Link>
          </div>
          <DocList docs={summary.dueSoon ?? []} showDue />
        </section>
      )}

      {time && <TimeCard time={time} />}
      {config.showTaxDeadlines && <TaxDeadlines kinds={taxKindsOf(config, profile.vatStatus)} profile={profile} amounts={{ ...(config.taxAmounts ?? {}), ...advances }} country={country} />}
      {(config.showFxRates ?? true) && <FxRates currencies={config.fxCurrencies ?? DEFAULT_FX} />}

      <div className={cn('mt-6 grid gap-4', config.showChart && config.showTopCustomers && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')}>
        {config.showChart && hasData && (stats ? <PeriodReport initial={stats} compact usage={usage} /> : <RevenueChart chart={summary.chart} money={money} />)}
        {config.showTopCustomers && summary.topCustomers.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-bold">{t('topCustomers')}</h2>
            <p className="text-xs text-muted-foreground">{t('topCustomersHint')}</p>
            <ol className="mt-3 space-y-1">
              {summary.topCustomers.map((c, i) => {
                const top = summary.topCustomers[0]?.total ?? 0;
                const share = top > 0 ? (c.total / top) * 100 : 0;
                return (
                  <li key={c.contactId}>
                    <Link href={`/contacts/${c.contactId}`} className="block rounded-lg px-2 py-1.5 hover:bg-secondary">
                      <span className="flex items-center gap-2 text-sm">
                        <span className="w-4 text-xs font-bold text-muted-foreground">{i + 1}.</span>
                        <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{money(c.total)}</span>
                      </span>
                      <span className="ml-6 mt-1 block h-1 rounded-full bg-secondary">
                        <span className="block h-1 rounded-full bg-primary" style={{ width: `${share}%` }} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>

      {config.showRecent && hasData && (
        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">{t('recent')}</h2>
            <Link href="/invoices" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              {t('showAll')} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <DocList docs={summary.recent} />
        </section>
      )}

      <CustomizeModal
        open={customizing}
        onClose={() => setCustomizing(false)}
        config={config}
        profile={profile}
        country={country}
        usage={usage}
        recommendation={recommendation}
        savedKeys={savedKeys}
        onSaved={(patch) => {
          const kept = Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) as Partial<DashboardConfig>;
          setStored((cur) => normalize({ ...cur, ...kept }));
          setSavedKeys((cur) => {
            const keys = new Set(cur ?? []);
            for (const [k, v] of Object.entries(patch)) {
              if (v == null) keys.delete(k);
              else keys.add(k);
            }
            return [...keys];
          });
          setCustomizing(false);
        }}
      />
    </div>
  );
}

function DocList({ docs, showDue = false }: { docs: DashboardDoc[]; showDue?: boolean }) {
  const t = useTranslations('dashboard');
  const tDoc = useTranslations('doc');
  const tStatus = useTranslations('invoices.status');
  const tGloss = useTranslations('glossary');
  const tColors = useTranslations('contacts.colors');
  const locale = useLocale();
  return (
    <ul className="mt-2 divide-y divide-border">
      {docs.map((doc) => {
        const status = displayStatus(doc);
        return (
          <li key={doc.id}>
            <Link href={`/invoices/${doc.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-secondary/60">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate font-semibold">
                  <ColorDot color={doc.contactColor} label={isContactColor(doc.contactColor) ? tGloss('contactColor', { color: tColors(doc.contactColor) }) : undefined} />
                  <span className="truncate">{doc.contactName ?? tDoc('noCustomer')}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {tDoc(`type.${doc.documentType}`)} {doc.invoiceNumber ?? tDoc('unnumbered')}
                  {' · '}
                  {showDue ? t('dueOn', { date: formatDate(doc.dueDate, locale) ?? '–' }) : formatDate(doc.issueDate, locale) ?? '–'}
                </span>
              </span>
              <span title={tGloss(`status.${status}`)} className={cn('hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline-flex', STATUS_BADGE_CLASSES[status])}>
                {status === 'overdue' ? tDoc('overdue') : tStatus(status)}
              </span>
              <span className="w-28 shrink-0 text-right font-semibold tabular-nums">{formatMoney(doc.total, doc.currency, locale)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function RevenueChart({ chart, money }: { chart: DashboardSummary['chart']; money: (n: number) => string }) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const max = Math.max(1, ...chart.flatMap((m) => [m.revenue, m.expenses]));
  const monthLabel = (key: string) => new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(`${key}-01T00:00:00`));
  const totalRevenue = chart.reduce((s, m) => s + m.revenue, 0);
  const totalExpenses = chart.reduce((s, m) => s + m.expenses, 0);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">{t('chart.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('chart.hint')}</p>
        </div>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
            {t('chart.revenue')} <strong className="tabular-nums">{money(totalRevenue)}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" />
            {t('chart.expenses')} <strong className="tabular-nums">{money(totalExpenses)}</strong>
          </span>
        </div>
      </div>
      <div className="mt-4 flex h-44 items-end gap-1 sm:gap-2" role="img" aria-label={t('chart.title')}>
        {chart.map((m) => (
          <div key={m.month} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-0.5">
              <div className="w-1/2 max-w-4 rounded-t bg-primary transition-opacity group-hover:opacity-80" style={{ height: `${(m.revenue / max) * 100}%` }} />
              <div className="w-1/2 max-w-4 rounded-t bg-muted-foreground/40" style={{ height: `${(m.expenses / max) * 100}%` }} />
            </div>
            <span className="mt-1 text-center text-[10px] text-muted-foreground">{monthLabel(m.month)}</span>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-2 py-1 text-[11px] text-background shadow group-hover:block">
              {monthLabel(m.month)}: {money(m.revenue)} / {money(m.expenses)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomizeModal({
  open,
  onClose,
  config,
  onSaved,
  profile,
  country,
  usage,
  recommendation,
  savedKeys
}: {
  open: boolean;
  onClose: () => void;
  config: DashboardConfig;
  onSaved: (patch: DashboardConfigPatch) => void;
  profile: TaxProfile;
  country: string;
  usage: Usage | null;
  recommendation: DashboardRecommendation;
  savedKeys: string[] | undefined;
}) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const minimums = minimumsFor(country);
  const router = useRouter();
  const [cards, setCards] = useState<KpiCard[]>(config.cards);
  const [tiles, setTiles] = useState<string[]>(config.tiles ?? DEFAULT_TILES);
  const [sections, setSections] = useState({
    showChart: config.showChart,
    showRecent: config.showRecent,
    showTopCustomers: config.showTopCustomers,
    showDueSoon: config.showDueSoon,
    showTaxDeadlines: config.showTaxDeadlines,
    showFxRates: config.showFxRates ?? true
  });
  const [fx, setFx] = useState<string[]>(config.fxCurrencies ?? DEFAULT_FX);
  // Usage-driven keys the member changed (or saved before); the others are sent as null and keep following usage.
  const [touched, setTouched] = useState<Set<UsageDrivenKey>>(
    () => new Set(USAGE_DRIVEN_KEYS.filter((k) => (savedKeys ?? USAGE_DRIVEN_KEYS).includes(k)))
  );
  const touch = (key: UsageDrivenKey) => setTouched((cur) => (cur.has(key) ? cur : new Set(cur).add(key)));
  // Every currency ČNB publishes; the short fallback list is used when cnb.cz is unreachable.
  const [fxList, setFxList] = useState<{ code: string; country: string; name: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/dashboard/fx-rates/currencies')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { currencies?: { code: string; country: string; name: string }[] | null } | null) => alive && setFxList(json?.currencies ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const fxChoices = fxList
    ? [...fxList].sort((a, b) => a.code.localeCompare(b.code)).map((c) => ({ code: c.code, label: `${c.name} (${c.country})` }))
    : FX_CHOICES.map((code) => ({ code, label: '' }));
  const fxNames: Record<string, string> = Object.fromEntries(fxChoices.map((c) => [c.code, c.label]));
  const [taxKinds, setTaxKinds] = useState<TaxDeadlineKind[]>(() => taxKindsOf(config, profile.vatStatus));
  const [taxAmounts, setTaxAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(config.taxAmounts ?? {}).map(([k, v]) => [k, String(v)]))
  );
  const [saving, start] = useTransition();

  // Cards keep the user's order; unchecked ones are listed after, in default order.
  const ordered = [...cards, ...KPI_CARDS.filter((c) => !cards.includes(c))];
  const toggleCard = (card: KpiCard) => {
    touch('cards');
    setCards((cur) => (cur.includes(card) ? cur.filter((c) => c !== card) : [...cur, card]));
  };
  const move = (card: KpiCard, dir: -1 | 1) =>
    setCards((cur) => {
      const i = cur.indexOf(card);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      next[i] = cur[j]!;
      next[j] = cur[i]!;
      return next;
    });
  const toggleTile = (tile: string) => {
    touch('tiles');
    setTiles((cur) => (cur.includes(tile) ? cur.filter((x) => x !== tile) : [...cur, tile]));
  };
  /** Untouched usage-driven keys go out as null, so they keep adapting. */
  const choices = (next: DashboardConfigPatch): DashboardConfigPatch => {
    const out: DashboardConfigPatch = { ...next };
    for (const key of USAGE_DRIVEN_KEYS) if (!touched.has(key)) out[key] = null;
    return out;
  };

  const save = (next: DashboardConfigPatch) =>
    start(async () => {
      const result = await saveDashboardConfig(next);
      if (!result.ok) {
        toast({ text: t('customizeFailed', { reason: result.error }), tone: 'err' });
        return;
      }
      toast({ text: t('customizeSaved'), tone: 'ok' });
      onSaved(next);
      router.refresh();
    });

  const check = 'h-4 w-4 accent-primary';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('customize')}
      className="max-w-lg"
      footer={
        <>
          <button
            type="button"
            className={cn(buttonClass.ghost, 'mr-auto')}
            disabled={saving}
            onClick={() => {
              setCards(recommendation.cards.filter((c): c is KpiCard => (KPI_CARDS as readonly string[]).includes(c)));
              setTiles(recommendation.tiles);
              setSections({ showChart: true, showRecent: true, showTopCustomers: true, showDueSoon: true, showTaxDeadlines: true, showFxRates: recommendation.showFxRates });
              setFx(recommendation.fxCurrencies);
              setTouched(new Set());
              setTaxKinds(defaultTaxDeadlineKinds(profile.vatStatus));
            }}
          >
            {t('customizeReset')}
          </button>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className={buttonClass.primary} disabled={saving} onClick={() => save(choices({ cards, tiles, ...sections, taxDeadlines: sameKinds(taxKinds, defaultTaxDeadlineKinds(profile.vatStatus)) ? null : taxKinds, fxCurrencies: fx, taxAmounts: amountsOf(taxAmounts, taxKinds) }))}>
            {t('save')}
          </button>
        </>
      }
    >
      {usage && <UsageNote usage={usage} />}
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('customizeCards')}</h3>
      <ul className="mt-2 space-y-1">
        {ordered.map((card) => {
          const on = cards.includes(card);
          const i = cards.indexOf(card);
          return (
            <li key={card} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', on ? 'border-border' : 'border-dashed border-border opacity-70')}>
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <input type="checkbox" className={check} checked={on} onChange={() => toggleCard(card)} />
                {t(`cards.${card}.label`)}
              </label>
              {on && (
                <>
                  <button type="button" aria-label={t('moveUp')} disabled={i === 0} onClick={() => {
                      touch('cards');
                      move(card, -1);
                    }} className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('moveDown')}
                    disabled={i === cards.length - 1}
                    onClick={() => {
                      touch('cards');
                      move(card, 1);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('customizeTiles')}</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK_TILES.map((tile) => {
          const on = tiles.includes(tile);
          return (
            <button
              key={tile}
              type="button"
              aria-pressed={on}
              onClick={() => toggleTile(tile)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {t(`tiles.${tile}`)}
            </button>
          );
        })}
      </div>

      <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('customizeSections')}</h3>
      <div className="mt-2 space-y-2 text-sm">
        {(['showDueSoon', 'showTaxDeadlines', 'showFxRates', 'showChart', 'showTopCustomers', 'showRecent'] as const).map((key) => (
          <label key={key} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className={check}
              checked={sections[key]}
              onChange={(e) => {
                if (key === 'showFxRates') touch('showFxRates');
                setSections((s) => ({ ...s, [key]: e.target.checked }));
              }}
            />
            {t(`sections.${key}`)}
          </label>
        ))}
      </div>

      {sections.showFxRates && (
        <>
          <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <InfoHint hint={t('fxRates.customizeHint')}>{t('fxRates.customizeTitle')}</InfoHint>
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {fx.map((code) => (
              <span key={code} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1" title={fxNames[code]}>
                {code}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t('fxRates.remove', { code })}
                  onClick={() => {
                    touch('fxCurrencies');
                    setFx((prev) => prev.filter((c) => c !== code));
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {fx.length < FX_MAX ? (
              <select
                aria-label={t('fxRates.add')}
                className="rounded-lg border border-border bg-background px-2 py-1 text-sm"
                value=""
                onChange={(e) => {
                  const code = e.target.value;
                  if (!code) return;
                  touch('fxCurrencies');
                  setFx((prev) => (prev.includes(code) ? prev : [...prev, code]));
                }}
              >
                <option value="">{t('fxRates.add')}</option>
                {fxChoices
                  .filter((c) => !fx.includes(c.code))
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                      {c.label ? ` – ${c.label}` : ''}
                    </option>
                  ))}
              </select>
            ) : (
              <span className="text-xs text-muted-foreground">{t('fxRates.limit', { max: FX_MAX })}</span>
            )}
          </div>
        </>
      )}

      {sections.showTaxDeadlines && (
        <>
          <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <InfoHint hint={t('taxDeadlines.customizeHint')}>{t('taxDeadlines.customizeTitle')}</InfoHint>
          </h3>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            {relevantTaxDeadlineKinds(TAX_DEADLINE_KINDS, profile).map((kind) => (
              <label key={kind} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className={check}
                  checked={taxKinds.includes(kind)}
                  onChange={(e) =>
                    setTaxKinds((prev) => (e.target.checked ? TAX_DEADLINE_KINDS.filter((k) => k === kind || prev.includes(k)) : prev.filter((k) => k !== kind)))
                  }
                />
                {t(`taxDeadlines.kinds.${kind}`)}
              </label>
            ))}
          </div>
          {AMOUNT_KINDS.some((k) => taxKinds.includes(k)) && (
            <>
              <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <InfoHint hint={t('taxDeadlines.amountsHint')}>{t('taxDeadlines.amountsTitle')}</InfoHint>
              </h3>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                {AMOUNT_KINDS.filter((k) => taxKinds.includes(k)).map((kind) => (
                  <label key={kind} className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t(`taxDeadlines.kinds.${kind}`)}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="1"
                      className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                      value={taxAmounts[kind] ?? ''}
                      onChange={(e) => setTaxAmounts((prev) => ({ ...prev, [kind]: e.target.value }))}
                    />
                    {minimums?.values[kind as MinimumKind] != null && (
                      <span className="text-xs text-muted-foreground">
                        {t('taxDeadlines.minimum', { from: `${Number(minimums.from.slice(5))}/${minimums.from.slice(0, 4)}`, amount: formatMoney(minimums.values[kind as MinimumKind]!, country === 'SK' ? 'EUR' : 'CZK', locale) })}{' '}
                        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setTaxAmounts((prev) => ({ ...prev, [kind]: String(minimums.values[kind as MinimumKind]) }))}>
                          {t('taxDeadlines.useMinimum')}
                        </button>
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

/** "Recommended from what you use": a one-line summary of the facts the defaults came from. */
function UsageNote({ usage }: { usage: Usage }) {
  const t = useTranslations('dashboard.usage');
  const facts: string[] = [];
  if (usage.has.foreignCurrencies) facts.push(t('currencies', { list: usage.foreignCurrencies.slice(0, 6).join(', ') }));
  else if (usage.has.invoices) facts.push(t('onlyHome', { currency: usage.homeCurrency }));
  if (usage.has.invoices) facts.push(usage.has.expenses ? t('expenses') : t('noExpenses'));
  if (usage.has.paypal) facts.push(t('paypal'));
  if (usage.has.bank && (usage.bank.bankApi || !usage.has.paypal)) facts.push(t('bank'));
  if (usage.has.proformas) facts.push(t('proformas'));
  if (usage.has.quotes) facts.push(t('quotes'));
  return (
    <div className="mb-4 rounded-lg bg-secondary/60 px-3 py-2 text-xs">
      <p className="font-semibold">{t('title')}</p>
      <p className="mt-0.5 text-muted-foreground">{usage.has.invoices ? facts.join(' · ') : t('newAccount')}</p>
      <p className="mt-0.5 text-muted-foreground">{t('hint')}</p>
    </div>
  );
}

/** Kinds paid as a regular amount the member can type in (shown next to the deadline). */
const AMOUNT_KINDS: TaxDeadlineKind[] = ['health', 'social', 'flat_tax', 'payroll'];
/** Kinds an SK company books as a tax expense (odvody are deductible there, unlike CZ OSVČ advances). */
const SK_EXPENSE_KINDS: TaxDeadlineKind[] = ['health', 'social'];

function amountsOf(input: Record<string, string>, kinds: TaxDeadlineKind[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const kind of AMOUNT_KINDS) {
    const value = Number((input[kind] ?? '').replace(',', '.'));
    if (kinds.includes(kind) && value > 0) out[kind] = Math.round(value * 100) / 100;
  }
  return Object.keys(out).length ? out : null;
}

const sameKinds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k) => b.includes(k));

function taxKindsOf(config: DashboardConfig, vatStatus: VatStatus): TaxDeadlineKind[] {
  if (!config.taxDeadlines) return defaultTaxDeadlineKinds(vatStatus);
  return TAX_DEADLINE_KINDS.filter((k) => config.taxDeadlines!.includes(k));
}

/** Upcoming Czech tax & insurance due days (calendar only, weekends/holidays shifted). */
function TaxDeadlines({
  kinds,
  profile,
  amounts,
  country
}: {
  kinds: TaxDeadlineKind[];
  profile: TaxProfile;
  amounts: Record<string, number | undefined>;
  country: string;
}) {
  const t = useTranslations('dashboard.taxDeadlines');
  const locale = useLocale();
  const kindsKey = kinds.join(',');
  // Months with EU services / foreign purchases decide souhrnné hlášení and the identified person's return.
  const needsActivity = kinds.includes('ec_sales_list') || kinds.includes('vat_identified');
  const [activity, setActivity] = useState<TaxProfile['activity'] | null | undefined>(needsActivity ? undefined : null);
  useEffect(() => {
    if (!needsActivity) return;
    let alive = true;
    fetch('/api/dashboard/vat-activity')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: TaxProfile['activity'] | null) => alive && setActivity(json?.euSalesMonths ? json : null))
      .catch(() => alive && setActivity(null));
    return () => {
      alive = false;
    };
  }, [needsActivity]);
  // Official rows load on the client (the first fetch from Finanční správa can
  // take a few seconds); "today" is the browser's, so server and client agree.
  const [official, setOfficial] = useState<OfficialTaxEvent[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch('/api/dashboard/tax-calendar')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { events?: OfficialTaxEvent[] | null } | null) => alive && setOfficial(json?.events ?? null))
      .catch(() => alive && setOfficial(null));
    return () => {
      alive = false;
    };
  }, []);
  const { country: pCountry, vatStatus, legalEntity } = profile;
  const items = useMemo<TaxDeadline[] | null>(
    () =>
      official === undefined || activity === undefined
        ? null
        : taxDeadlinesFor(
            kindsKey ? (kindsKey.split(',') as TaxDeadlineKind[]) : [],
            { country: pCountry, vatStatus, legalEntity, activity: activity ?? undefined },
            official
          ).slice(0, 6),
    [official, activity, kindsKey, pCountry, vatStatus, legalEntity]
  );
  if (!items || items.length === 0) return null;
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const currency = country === 'SK' ? 'EUR' : 'CZK';
  const expenseHref = (kind: TaxDeadlineKind) => {
    const params = new URLSearchParams({ description: t(`kinds.${kind}`) });
    if (amounts[kind]) params.set('amount', String(amounts[kind]));
    return `/expenses/new?${params}`;
  };
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <InfoHint hint={t('hint')}>
        <h2 className="flex items-center gap-2 font-bold">
          <Landmark className="h-4 w-4 text-primary" />
          {t('title')}
        </h2>
      </InfoHint>
      <ul className="mt-3 divide-y divide-border">
        {items.map((item) => (
          <li key={`${item.kind}-${item.date.getTime()}`} className="flex items-center gap-3 py-2 text-sm">
            <span className="w-24 shrink-0 font-semibold tabular-nums">{fmt.format(item.date)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t(`kinds.${item.kind}`)}</span>
              {item.conditional && (
                <span className="block text-xs text-muted-foreground">{t(item.kind === 'ec_sales_list' ? 'onlyIfEuSales' : 'onlyIfForeignPurchase')}</span>
              )}
              {item.details && (
                <span className="block truncate text-xs text-muted-foreground" title={item.details.join('\n')}>
                  {item.details.join(' · ')}
                </span>
              )}
            </span>
            {amounts[item.kind] !== undefined ? (
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(amounts[item.kind]!, currency, locale)}</span>
            ) : (
              SETTINGS_ADVANCE_KINDS.includes(item.kind) && (
                <Link href="/settings/company#zalohy" className="shrink-0 text-xs font-semibold text-primary hover:underline">
                  {t('fillAmount')}
                </Link>
              )
            )}
            {country === 'SK' && SK_EXPENSE_KINDS.includes(item.kind) && (
              <Link href={expenseHref(item.kind)} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                {t('bookExpense')}
              </Link>
            )}
            {item.kind.startsWith('vat_') && (
              <Link href="/settings/exports#epo" className="hidden shrink-0 text-xs font-semibold text-primary hover:underline sm:inline">
                {t('prepareXml')}
              </Link>
            )}
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                item.daysLeft <= 3 ? 'bg-destructive/10 text-destructive' : item.daysLeft <= 7 ? 'bg-warning/15 text-warning' : 'bg-secondary text-muted-foreground'
              )}
            >
              {t('daysLeft', { count: item.daysLeft })}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {official ? (
          <>
            {t('sourceOfficial')}{' '}
            <a href="https://financnisprava.gov.cz/cs/danovy-kalendar" target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
              financnisprava.gov.cz
            </a>
          </>
        ) : (
          t('sourceLocal')
        )}
      </p>
    </section>
  );
}

interface FxRow {
  code: string;
  rate: number | null;
  weekAgo: number | null;
}

/** This week, unbilled work and the running timer; hidden until there's something to show. */
function TimeCard({ time }: { time: TimeSummary }) {
  const t = useTranslations('time.dashboard');
  const locale = useLocale();
  // Clock starts after mount so the server and client render the same text.
  const [now, setNow] = useState<number | null>(null);
  const running = time.running;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (!running && time.weekMinutes === 0 && time.unbilledMinutes === 0) return null;
  const unbilled = time.unbilled.filter((u) => u.amount > 0);
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">
          <Timer className="h-4 w-4 text-primary" />
          {t('title')}
        </h2>
        <Link href="/time" className="text-sm font-semibold text-primary hover:underline">
          {t('open')}
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-secondary/60 px-3 py-2">
          <div className="text-xs font-semibold text-muted-foreground">{t('week')}</div>
          <div className="font-mono text-lg font-bold tabular-nums">{formatMinutes(time.weekMinutes)} h</div>
        </div>
        <Link href="/time?period=all&state=unbilled" className="rounded-lg bg-secondary/60 px-3 py-2 hover:bg-secondary">
          <div className="text-xs font-semibold text-muted-foreground">{t('unbilled')}</div>
          <div className="text-lg font-bold tabular-nums text-warning">
            {unbilled.length ? unbilled.map((u) => formatMoney(u.amount, u.currency, locale)).join(' · ') : `${formatMinutes(time.unbilledMinutes)} h`}
          </div>
        </Link>
        {running && (
          <Link href="/time" className="col-span-2 rounded-lg bg-primary/10 px-3 py-2 hover:bg-primary/15 sm:col-span-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
              {t('running')}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold">{running.description || running.projectName || '–'}</span>
              <span className="shrink-0 font-mono text-lg font-bold tabular-nums">{now == null ? '–:––:––' : formatElapsed((now - new Date(running.startedAt).getTime()) / 1000)}</span>
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}

/** Local calendar day as YYYY-MM-DD. */
function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ČNB rates (CZK per unit) for a chosen day, the change against a week before and a small CZK converter. */
function FxRates({ currencies }: { currencies: string[] }) {
  const t = useTranslations('dashboard.fxRates');
  const locale = useLocale();
  const key = currencies.join(',');
  // Empty = today; set after mount so the server and client render the same.
  const [day, setDay] = useState('');
  const [today, setToday] = useState('');
  const [data, setData] = useState<{ rows: FxRow[]; publishedDate: string | null } | null | undefined>(undefined);
  const [amount, setAmount] = useState('100');
  const [from, setFrom] = useState('');
  useEffect(() => setToday(isoToday()), []);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const query = new URLSearchParams({ currencies: key });
    if (day) query.set('date', day);
    fetch(`/api/dashboard/fx-rates?${query}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { rates?: FxRow[]; publishedDate?: string | null } | null) =>
        alive && setData(json?.rates ? { rows: json.rates.filter((r) => r.rate != null), publishedDate: json.publishedDate ?? null } : null)
      )
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [key, day]);
  // Hide the widget only when today's rates can't be loaded at all; a bad past day shows a message instead.
  if (!key || (!day && (data === null || (data && data.rows.length === 0)))) return null;
  const num = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const pct = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const rows = data?.rows ?? [];
  const requested = day || today;
  const published = data?.publishedDate ?? null;
  const fromRow = rows.find((r) => r.code === from) ?? rows[0];
  const parsedAmount = Number(amount.replace(/\s/g, '').replace(',', '.'));
  const converted = fromRow?.rate != null && amount.trim() !== '' && Number.isFinite(parsedAmount) ? parsedAmount * fromRow.rate : null;
  const control = 'rounded-lg border border-border bg-background px-2 py-1 text-sm';
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InfoHint hint={t('hint')}>
          <h2 className="flex items-center gap-2 font-bold">
            <Landmark className="h-4 w-4 text-primary" />
            {t('title')}
          </h2>
        </InfoHint>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('date')}</span>
          <input
            type="date"
            className={control}
            value={requested}
            min="1991-01-01"
            max={today || undefined}
            onChange={(e) => setDay(e.target.value && e.target.value < today ? e.target.value : '')}
          />
        </label>
      </div>
      {data === null || (data && rows.length === 0) ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : (
        <>
          {published && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('publishedOn', { date: formatDate(published, locale) ?? published })}
              {requested && published !== requested && <> – {t('fallbackNote')}</>}
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(data ? rows : currencies.map((code) => ({ code, rate: null, weekAgo: null }))).map((row) => {
              const change = row.rate != null && row.weekAgo ? row.rate / row.weekAgo - 1 : null;
              return (
                <div key={row.code} className="rounded-lg bg-secondary/60 px-3 py-2">
                  <div className="text-xs font-semibold text-muted-foreground">1 {row.code}</div>
                  <div className="text-lg font-bold tabular-nums">{row.rate != null ? `${num.format(row.rate)} Kč` : '…'}</div>
                  {change != null && (
                    <div className={cn('text-xs font-semibold tabular-nums', change > 0 ? 'text-destructive' : change < 0 ? 'text-success' : 'text-muted-foreground')} title={t('weekChange')}>
                      {pct.format(change)} {t('weekShort')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {fromRow && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{t('converter')}</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label={t('amount')}
                className={cn(control, 'w-28 tabular-nums')}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <select aria-label={t('currency')} className={control} value={fromRow.code} onChange={(e) => setFrom(e.target.value)}>
                {rows.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.code}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">=</span>
              <span className="font-bold tabular-nums">{converted != null ? formatMoney(converted, 'CZK', locale) : '–'}</span>
            </div>
          )}
        </>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {t('source')}{' '}
        <a href="https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/" target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
          cnb.cz
        </a>
      </p>
    </section>
  );
}
