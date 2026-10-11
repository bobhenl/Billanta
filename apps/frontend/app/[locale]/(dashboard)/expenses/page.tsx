import { Plus, ScanLine, Search } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { AmountRange, amountParam, FilterField, filterFieldClass as field, FilterPanel } from '@/components/filter-panel';
import { InfoHint } from '@/components/info-hint';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { formatMoney } from '@/lib/invoice-ui';
import { EXPENSE_CATEGORIES, expenseState, type Expense, type ExpensePage } from '@/lib/expense-ui';
import { cn } from '@/lib/utils';
import { ExpensesTable } from './expenses-table';

const STATE_FILTERS = ['unpaid', 'overdue', 'paid'] as const;
const DATE_FIELDS = ['expense', 'due', 'paid'] as const;
const YES_NO = ['yes', 'no'] as const;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

interface Filters {
  state?: string;
  category?: string;
  month?: string;
  q?: string;
  supplier?: string;
  currency?: string;
  vat?: string;
  receipt?: string;
  amount_min?: string;
  amount_max?: string;
  date_field?: string;
  from?: string;
  to?: string;
}

/** The "Filtry" panel's fields. */
const PANEL_KEYS = ['supplier', 'currency', 'vat', 'receipt', 'amount_min', 'amount_max', 'date_field', 'from', 'to'] as const;

function hrefWith(current: Filters, change: Filters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...change })) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `/expenses?${qs}` : '/expenses';
}

/** The backend pages by 100; a small business has a few hundred expenses a year at most. */
async function loadAll(): Promise<Expense[]> {
  const first = await apiFetch<ExpensePage>('/api/v1/expenses?limit=100&page=1');
  const rest = await Promise.all(
    Array.from({ length: Math.min(first.pagination.totalPages, 10) - 1 }, (_, i) =>
      apiFetch<ExpensePage>(`/api/v1/expenses?limit=100&page=${i + 2}`).then((p) => p.data)
    )
  );
  return [...first.data, ...rest.flat()];
}

export default async function ExpensesPage(props: { searchParams: Promise<Filters> }) {
  const searchParams = await props.searchParams;
  const t = await getTranslations('expenses');
  const tDoc = await getTranslations('doc');
  const locale = await getLocale();

  const filters: Filters = {
    state: STATE_FILTERS.includes(searchParams.state as never) ? searchParams.state : undefined,
    category: EXPENSE_CATEGORIES.includes(searchParams.category as never) ? searchParams.category : undefined,
    month: /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? searchParams.month : undefined,
    q: searchParams.q?.trim().slice(0, 100) || undefined,
    supplier: searchParams.supplier?.trim().slice(0, 200) || undefined,
    currency: /^[A-Z]{3}$/.test(searchParams.currency ?? '') ? searchParams.currency : undefined,
    vat: /^\d{1,2}(\.\d+)?$/.test(searchParams.vat ?? '') ? searchParams.vat : undefined,
    receipt: YES_NO.includes(searchParams.receipt as never) ? searchParams.receipt : undefined,
    amount_min: amountParam(searchParams.amount_min),
    amount_max: amountParam(searchParams.amount_max),
    date_field: DATE_FIELDS.includes(searchParams.date_field as never) ? searchParams.date_field : undefined,
    from: ISO_DAY.test(searchParams.from ?? '') ? searchParams.from : undefined,
    to: ISO_DAY.test(searchParams.to ?? '') ? searchParams.to : undefined
  };
  // A date column without a range filters nothing.
  if (!filters.from && !filters.to) filters.date_field = undefined;
  const panelActive = PANEL_KEYS.filter((k) => k !== 'date_field' && filters[k]).length;

  let all: Expense[];
  try {
    all = await loadAll();
  } catch (err) {
    if (err instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (err instanceof NoTenantError)
      return (
        <Banner tone="info" className="mt-6">
          {t('noTenant')}
        </Banner>
      );
    return (
      <Banner tone="err" title={t('loadError')} className="mt-6">
        <span className="font-mono text-xs">{err instanceof ApiError ? err.message : String(err)}</span>
      </Banner>
    );
  }

  const q = filters.q?.toLowerCase();
  const rows = all.filter((e) => {
    const state = expenseState(e);
    if (filters.state === 'unpaid' && state === 'paid') return false;
    if (filters.state && filters.state !== 'unpaid' && state !== filters.state) return false;
    if (filters.category && e.category !== filters.category) return false;
    if (filters.month && !e.expenseDate.startsWith(filters.month)) return false;
    if (filters.supplier && (e.supplierNameRaw ?? '') !== filters.supplier) return false;
    if (filters.currency && e.currency !== filters.currency) return false;
    if (filters.vat && Number(e.vatRate) !== Number(filters.vat)) return false;
    if (filters.receipt && Boolean(e.receiptFileUrl) !== (filters.receipt === 'yes')) return false;
    if (filters.amount_min && Number(e.amount) < Number(filters.amount_min)) return false;
    if (filters.amount_max && Number(e.amount) > Number(filters.amount_max)) return false;
    if (filters.from || filters.to) {
      const day = { expense: e.expenseDate, due: e.dueDate, paid: e.paidAt }[filters.date_field ?? 'expense']?.slice(0, 10);
      if (!day || (filters.from && day < filters.from) || (filters.to && day > filters.to)) return false;
    }
    if (q && ![e.supplierNameRaw, e.description, e.documentNumber, e.variableSymbol, e.supplierIco].some((v) => v?.toLowerCase().includes(q))) return false;
    return true;
  });

  const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, locale));
  const suppliers = distinct(all.map((e) => e.supplierNameRaw));
  const currencies = distinct(all.map((e) => e.currency));
  const vatRates = [...new Set(all.map((e) => Number(e.vatRate)))].sort((a, b) => b - a);

  // KPI cards (CZK only — the dashboard does the per-currency split).
  const thisMonth = new Date().toISOString().slice(0, 7);
  const czk = all.filter((e) => e.currency === 'CZK');
  const sum = (list: Expense[]) => list.reduce((acc, e) => acc + Number(e.amount), 0);
  const unpaid = czk.filter((e) => expenseState(e) !== 'paid');
  const overdue = czk.filter((e) => expenseState(e) === 'overdue');
  const monthRows = czk.filter((e) => e.expenseDate.startsWith(thisMonth));
  const cards = [
    {
      key: 'month',
      label: t('kpi.month'),
      value: sum(monthRows),
      sub: t('kpi.count', { count: monthRows.length }),
      href: hrefWith({}, { month: thisMonth }),
      tone: 'text-primary'
    },
    {
      key: 'unpaid',
      label: t('kpi.unpaid'),
      value: sum(unpaid),
      sub: t('kpi.count', { count: unpaid.length }),
      href: hrefWith({}, { state: 'unpaid' }),
      tone: 'text-warning'
    },
    {
      key: 'overdue',
      label: t('kpi.overdue'),
      value: sum(overdue),
      sub: t('kpi.count', { count: overdue.length }),
      href: hrefWith({}, { state: 'overdue' }),
      tone: 'text-destructive'
    }
  ];

  const chip = (active: boolean) =>
    cn(
      'rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-primary'
    );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/expenses/new"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary"
          >
            <ScanLine className="h-4 w-4" />
            {t('fromPhoto')}
          </Link>
          <Link
            href="/expenses/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {t('newExpense')}
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{card.label}</div>
            <div className={cn('mt-1 text-2xl font-extrabold tabular-nums', card.tone)}>{formatMoney(card.value, 'CZK', locale)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{card.sub}</div>
          </Link>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form action="" className="relative w-full max-w-xs">
          {Object.entries(filters).map(([key, value]) => (key !== 'q' && value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            data-page-search
            defaultValue={filters.q}
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-full border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </form>
        <div className="flex flex-wrap gap-1.5">
          <Link href={hrefWith(filters, { state: undefined })} className={chip(!filters.state)}>
            {t('allStates')}
          </Link>
          {STATE_FILTERS.map((state) => (
            <Link key={state} href={hrefWith(filters, { state })} className={chip(filters.state === state)}>
              {t(`state.${state}`)}
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Link href={hrefWith(filters, { category: undefined })} className={chip(!filters.category)}>
          {t('allCategories')}
        </Link>
        {EXPENSE_CATEGORIES.map((c) => (
          <Link key={c} href={hrefWith(filters, { category: c })} className={chip(filters.category === c)}>
            {t(`category.${c}`)}
          </Link>
        ))}
        {filters.month && (
          <Link href={hrefWith(filters, { month: undefined })} className={chip(true)}>
            {filters.month} ✕
          </Link>
        )}
      </div>

      <FilterPanel
        active={panelActive}
        keep={{
          state: filters.state,
          category: filters.category,
          month: filters.month,
          q: filters.q
        }}
        clearHref={hrefWith(filters, Object.fromEntries(PANEL_KEYS.map((k) => [k, undefined])))}
      >
        <FilterField label={t('columns.supplier')}>
          <select name="supplier" defaultValue={filters.supplier ?? ''} className={cn(field, 'max-w-[14rem]')}>
            <option value="">{tDoc('filters.any')}</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tDoc('filters.currency')}>
          <select name="currency" defaultValue={filters.currency ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={t('columns.vatRate')}>
          <select name="vat" defaultValue={filters.vat ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {vatRates.map((r) => (
              <option key={r} value={String(r)}>
                {r} %
              </option>
            ))}
          </select>
        </FilterField>
        <AmountRange
          label={t('columns.amount')}
          min={filters.amount_min}
          max={filters.amount_max}
          minLabel={tDoc('filters.min')}
          maxLabel={tDoc('filters.max')}
        />
        <FilterField label={t('filters.receipt')}>
          <select name="receipt" defaultValue={filters.receipt ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            <option value="yes">{t('filters.receiptYes')}</option>
            <option value="no">{t('filters.receiptNo')}</option>
          </select>
        </FilterField>
        <div>
          <InfoHint hint={t('filters.dateHint')} className="text-xs font-semibold text-muted-foreground">
            <span>{tDoc('filters.date')}</span>
          </InfoHint>
          <div className="flex flex-wrap items-center gap-1.5">
            <select name="date_field" aria-label={tDoc('filters.date')} defaultValue={filters.date_field ?? 'expense'} className={field}>
              {DATE_FIELDS.map((d) => (
                <option key={d} value={d}>
                  {t(`filters.dateField.${d}`)}
                </option>
              ))}
            </select>
            <input type="date" name="from" aria-label={tDoc('filters.from')} defaultValue={filters.from} className={field} />
            <span className="text-muted-foreground">–</span>
            <input type="date" name="to" aria-label={tDoc('filters.to')} defaultValue={filters.to} className={field} />
          </div>
        </div>
      </FilterPanel>

      <ExpensesTable rows={rows} filtered={rows.length !== all.length} />
    </div>
  );
}
