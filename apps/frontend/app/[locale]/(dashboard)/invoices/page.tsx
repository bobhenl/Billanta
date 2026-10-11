import { cookies } from 'next/headers';
import { CalendarRange, ChevronDown, LayoutTemplate, Plus, Search, Users, X } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { DOCUMENT_TYPES, type InvoiceRow } from '@/lib/invoice-ui';
import { cn } from '@/lib/utils';
import { CONTACT_COLORS, isContactColor } from '@/lib/contact-colors';
import { Banner } from '@/components/banner';
import { InfoHint } from '@/components/info-hint';
import { StatusLegend } from '@/components/status-legend';
import { AmountRange, amountParam, FilterField, filterFieldClass as field, FilterPanel, type FilterPill } from '@/components/filter-panel';
import { DismissableDetails } from '@/components/dismissable-details';
import { DATE_PRESETS, isDatePreset, parseQuickPrefs, presetFilters, QUICK_COOKIE } from '@/lib/invoice-list-prefs';
import { bankAccountLine, type BankAccount } from '@/lib/bank-account';
import { InvoiceViewBar } from './invoice-view-bar';
import { InvoicesTable } from './invoices-table';

const STATUS_FILTERS = ['draft', 'issued', 'overdue', 'paid', 'cancelled'] as const;
const PAYMENT_METHODS = ['bank_transfer', 'cash', 'card', 'cash_on_delivery', 'other'] as const;
const CURRENCIES = ['CZK', 'EUR', 'USD', 'GBP', 'PLN'] as const;
const DATE_FIELDS = ['issue', 'due', 'taxable', 'paid', 'sent', 'created'] as const;
const SENT = ['yes', 'no'] as const;
const SOURCES = ['manual', 'ai', 'api', 'recurring', 'import'] as const;
const LANGUAGES = ['cs', 'sk', 'en'] as const;
const VAT_RATES = ['0', '5', '10', '12', '15', '19', '20', '21', '23'] as const;
const PAID_STATES = ['unpaid', 'partial', 'full'] as const;
const CLIENT_RESPONSES = ['accepted', 'rejected', 'none'] as const;
const COUNTRIES = ['CZ', 'SK', 'foreign'] as const;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

interface Filters {
  type?: string;
  status?: string;
  q?: string;
  payment_method?: string;
  currency?: string;
  date_field?: string;
  from?: string;
  to?: string;
  sent?: string;
  viewed?: string;
  contact_id?: string;
  contact_color?: string;
  amount_min?: string;
  amount_max?: string;
  source?: string;
  language?: string;
  reverse_charge?: string;
  vat_rate?: string;
  paid_state?: string;
  overdue_days?: string;
  reminded?: string;
  attachments?: string;
  internal_note?: string;
  client_response?: string;
  bank_account_id?: string;
  item?: string;
  note?: string;
  symbol?: string;
  order_number?: string;
  custom_field?: string;
  has_custom_fields?: string;
  issued_by?: string;
  country?: string;
  needs_attention?: string;
  related?: string;
  net_min?: string;
  net_max?: string;
  due_min?: string;
}

const DATE_KEYS = ['date_field', 'from', 'to'] as const;
/** The "Filtry" dialog's fields — counted for the badge and kept as hidden inputs by the search box. */
const MODAL_KEYS = [
  'contact_id',
  'contact_color',
  'payment_method',
  'currency',
  'amount_min',
  'amount_max',
  'paid_state',
  'overdue_days',
  'sent',
  'viewed',
  'reminded',
  'vat_rate',
  'reverse_charge',
  'language',
  'source',
  'bank_account_id',
  'attachments',
  'internal_note',
  'client_response',
  'item',
  'note',
  'symbol',
  'order_number',
  'custom_field',
  'has_custom_fields',
  'issued_by',
  'country',
  'needs_attention',
  'related',
  'net_min',
  'net_max',
  'due_min'
] as const;
const PANEL_KEYS = [...MODAL_KEYS, ...DATE_KEYS] as const;
const UUID = /^[0-9a-f-]{36}$/i;
const pick = <T extends string>(allowed: readonly T[], value?: string) => (allowed.includes(value as T) ? value : undefined);

/** Builds `/invoices?…` keeping the other filters (the filter chips are plain links). */
function hrefWith(current: Filters, change: Filters): string {
  const next = { ...current, ...change };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `/invoices?${qs}` : '/invoices';
}

export default async function InvoicesPage(props: { searchParams: Promise<Filters> }) {
  const searchParams = await props.searchParams;
  const t = await getTranslations('invoices');
  const tDoc = await getTranslations('doc');
  const tColors = await getTranslations('contacts.colors');
  const locale = await getLocale();

  const filters: Filters = {
    type: pick(DOCUMENT_TYPES, searchParams.type),
    status: pick(STATUS_FILTERS, searchParams.status),
    q: searchParams.q?.trim().slice(0, 100) || undefined,
    payment_method: pick(PAYMENT_METHODS, searchParams.payment_method),
    currency: pick(CURRENCIES, searchParams.currency),
    date_field: pick(DATE_FIELDS, searchParams.date_field),
    from: ISO_DAY.test(searchParams.from ?? '') ? searchParams.from : undefined,
    to: ISO_DAY.test(searchParams.to ?? '') ? searchParams.to : undefined,
    sent: pick(SENT, searchParams.sent),
    viewed: pick(SENT, searchParams.viewed),
    contact_id: UUID.test(searchParams.contact_id ?? '') ? searchParams.contact_id : undefined,
    contact_color: isContactColor(searchParams.contact_color) ? searchParams.contact_color : undefined,
    amount_min: amountParam(searchParams.amount_min),
    amount_max: amountParam(searchParams.amount_max),
    source: pick(SOURCES, searchParams.source),
    language: pick(LANGUAGES, searchParams.language),
    reverse_charge: pick(SENT, searchParams.reverse_charge),
    vat_rate: pick(VAT_RATES, searchParams.vat_rate),
    paid_state: pick(PAID_STATES, searchParams.paid_state),
    overdue_days: /^\d{1,4}$/.test(searchParams.overdue_days ?? '') && Number(searchParams.overdue_days) > 0 ? String(Number(searchParams.overdue_days)) : undefined,
    reminded: pick(SENT, searchParams.reminded),
    attachments: pick(SENT, searchParams.attachments),
    internal_note: pick(SENT, searchParams.internal_note),
    client_response: pick(CLIENT_RESPONSES, searchParams.client_response),
    bank_account_id: UUID.test(searchParams.bank_account_id ?? '') ? searchParams.bank_account_id : undefined,
    item: searchParams.item?.trim().slice(0, 100) || undefined,
    note: searchParams.note?.trim().slice(0, 100) || undefined,
    symbol: /^\d{1,10}$/.test(searchParams.symbol?.trim() ?? '') ? searchParams.symbol!.trim() : undefined,
    order_number: searchParams.order_number?.trim().slice(0, 60) || undefined,
    custom_field: searchParams.custom_field?.trim().slice(0, 100) || undefined,
    has_custom_fields: pick(SENT, searchParams.has_custom_fields),
    issued_by: UUID.test(searchParams.issued_by ?? '') ? searchParams.issued_by : undefined,
    country: pick(COUNTRIES, searchParams.country),
    needs_attention: pick(SENT, searchParams.needs_attention),
    related: pick(SENT, searchParams.related),
    net_min: amountParam(searchParams.net_min),
    net_max: amountParam(searchParams.net_max),
    due_min: amountParam(searchParams.due_min)
  };
  const quick = parseQuickPrefs((await cookies()).get(QUICK_COOKIE)?.value);
  // A hidden chip stays visible while it is the active filter, so it can be switched off.
  const typeChips = DOCUMENT_TYPES.filter((type) => !quick.hiddenTypes.includes(type) || filters.type === type);
  const statusChips = STATUS_FILTERS.filter((status) => !quick.hiddenStatuses.includes(status) || filters.status === status);
  // A date column without a range filters nothing — don't count it as active.
  if (!filters.from && !filters.to) filters.date_field = undefined;
  const dateField = filters.date_field ?? 'issue';
  const now = new Date();
  const presetLink = (preset: (typeof quick.presets)[number]) => {
    const change = presetFilters(preset, now, dateField);
    const active = Object.entries(change).every(([k, v]) => (filters[k as keyof Filters] ?? (k === 'date_field' ? 'issue' : undefined)) === v);
    const off = Object.fromEntries(Object.keys(change).map((k) => [k, undefined])) as Filters;
    return { preset, active, href: hrefWith(filters, active ? off : (change as Filters)) };
  };
  const presets = quick.presets.map(presetLink);
  const datePresets = DATE_PRESETS.map(presetLink);
  const dateActive = Boolean(filters.from || filters.to);
  // A range that no visible chip describes gets its own removable chip.
  const customRange = dateActive && !presets.some((p) => p.active && isDatePreset(p.preset));
  const noDates = Object.fromEntries(DATE_KEYS.map((k) => [k, undefined])) as Filters;
  const fmtDay = (iso?: string) => (iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(`${iso}T00:00:00`)) : '…');
  const rangeLabel = `${tDoc(`filters.dateField.${dateField}`)}: ${filters.from === filters.to ? fmtDay(filters.from) : `${fmtDay(filters.from)} – ${fmtDay(filters.to)}`}`;

  const panelActive =
    MODAL_KEYS.filter((k) => filters[k] && k !== 'amount_max' && k !== 'net_max').length +
    (filters.amount_max && !filters.amount_min ? 1 : 0) +
    (filters.net_max && !filters.net_min ? 1 : 0);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();

  let invoices: InvoiceRow[];
  let customers: { id: string; legalName: string; color?: string | null }[];
  let bankAccounts: BankAccount[];
  let team: { members: { userId: string; name: string | null; email: string }[] };
  try {
    [invoices, customers, bankAccounts, team] = await Promise.all([
      apiFetch<InvoiceRow[]>(`/api/v1/invoices${query ? `?${query}` : ''}`),
      apiFetch<{ id: string; legalName: string; color?: string | null }[]>('/api/v1/contacts').catch(() => []),
      apiFetch<BankAccount[]>('/api/v1/tenants/me/bank-accounts').catch(() => []),
      apiFetch<{ members: { userId: string; name: string | null; email: string }[] }>('/api/v1/team').catch(() => ({ members: [] }))
    ]);
  } catch (err) {
    if (err instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (err instanceof NoTenantError) {
      return (
        <Banner tone="info" className="mt-6">
          {t('noTenant')}
        </Banner>
      );
    }
    const message = err instanceof ApiError ? err.message : String(err);
    return (
      <Banner tone="err" title={t('loadError')} className="mt-6">
        <span className="font-mono text-xs">{message}</span>
      </Banner>
    );
  }

  const chip = (active: boolean) =>
    cn(
      'rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-primary'
    );

  const yesNo = (v?: string) => (v === 'yes' ? tDoc('filters.yes') : tDoc('filters.no'));
  const f = (key: string) => tDoc(`filters.${key}`);
  const describe: Partial<Record<(typeof MODAL_KEYS)[number], () => string>> = {
    contact_id: () => `${f('customer')}: ${customers.find((c) => c.id === filters.contact_id)?.legalName ?? '?'}`,
    contact_color: () => `${f('customerColor')}: ${tColors(filters.contact_color!)}`,
    payment_method: () => `${tDoc('fields.paymentMethod')}: ${tDoc(`payment.${filters.payment_method}`)}`,
    currency: () => `${f('currency')}: ${filters.currency}`,
    amount_min: () => `${f('amount')}: ${filters.amount_min}${filters.amount_max ? ` – ${filters.amount_max}` : '+'}`,
    amount_max: () => `${f('amount')}: ≤ ${filters.amount_max}`,
    paid_state: () => f(`paidStates.${filters.paid_state}`),
    overdue_days: () => f('overduePill').replace('#', filters.overdue_days!),
    sent: () => `${f('sent')}: ${filters.sent === 'yes' ? f('sentYes') : f('sentNo')}`,
    viewed: () => `${f('viewed')}: ${yesNo(filters.viewed)}`,
    reminded: () => `${f('reminded')}: ${yesNo(filters.reminded)}`,
    vat_rate: () => `${f('vatRate')}: ${filters.vat_rate} %`,
    reverse_charge: () => `${f('reverseCharge')}: ${yesNo(filters.reverse_charge)}`,
    language: () => `${f('language')}: ${f(`languages.${filters.language}`)}`,
    source: () => `${f('source')}: ${f(`sources.${filters.source}`)}`,
    bank_account_id: () => `${f('bankAccount')}: ${bankAccounts.find((a) => a.id === filters.bank_account_id)?.label ?? '?'}`,
    attachments: () => `${f('attachments')}: ${yesNo(filters.attachments)}`,
    internal_note: () => `${f('internalNote')}: ${yesNo(filters.internal_note)}`,
    client_response: () => `${f('clientResponse')}: ${f(`clientResponses.${filters.client_response}`)}`,
    item: () => `${f('item')}: „${filters.item}“`,
    note: () => `${f('note')}: „${filters.note}“`,
    symbol: () => `${f('symbol')}: ${filters.symbol}`,
    order_number: () => `${tDoc('fields.orderNumber')}: ${filters.order_number}`,
    custom_field: () => `${f('customField')}: „${filters.custom_field}“`,
    has_custom_fields: () => `${f('hasCustomFields')}: ${yesNo(filters.has_custom_fields)}`,
    issued_by: () => {
      const m = team.members.find((x) => x.userId === filters.issued_by);
      return `${f('issuedBy')}: ${m?.name || m?.email || '?'}`;
    },
    country: () => `${f('country')}: ${f(`countries.${filters.country}`)}`,
    needs_attention: () => `${f('needsAttention')}: ${yesNo(filters.needs_attention)}`,
    related: () => `${f('related')}: ${yesNo(filters.related)}`,
    net_min: () => `${f('net')}: ${filters.net_min}${filters.net_max ? ` – ${filters.net_max}` : '+'}`,
    net_max: () => `${f('net')}: ≤ ${filters.net_max}`,
    due_min: () => `${f('dueMin')}: ≥ ${filters.due_min}`
  };
  const pills: FilterPill[] = MODAL_KEYS.filter((k) => filters[k] && !(k === 'amount_max' && filters.amount_min) && !(k === 'net_max' && filters.net_min)).map((k) => ({
    key: k,
    label: describe[k]!(),
    removeHref: hrefWith(
      filters,
      k === 'amount_min' ? { amount_min: undefined, amount_max: undefined } : k === 'net_min' ? { net_min: undefined, net_max: undefined } : { [k]: undefined }
    )
  }));
  const yesNoSelect = (name: keyof Filters, yes = tDoc('filters.yes'), no = tDoc('filters.no')) => (
    <select name={name} defaultValue={filters[name] ?? ''} className={field}>
      <option value="">{tDoc('filters.any')}</option>
      <option value="yes">{yes}</option>
      <option value="no">{no}</option>
    </select>
  );
  const dateChip = (active: boolean) =>
    cn(
      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
      active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent hover:text-primary'
    );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('description')}</p>
          <StatusLegend className="mt-2" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/invoices/templates"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary"
          >
            <LayoutTemplate className="h-4 w-4" />
            {tDoc('templatesLink')}
          </Link>
          <Link
            href="/invoices/bulk"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary"
          >
            <Users className="h-4 w-4" />
            {tDoc('bulkLink')}
          </Link>
          <Link
            href="/invoices/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {t('newInvoice')}
          </Link>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-2" aria-label={tDoc('filterType')}>
          <Link href={hrefWith(filters, { type: undefined })} className={chip(!filters.type)}>
            {tDoc('allTypes')}
          </Link>
          {typeChips.map((type) => (
            <Link key={type} href={hrefWith(filters, { type })} className={chip(filters.type === type)}>
              {tDoc(`typePlural.${type}`)}
            </Link>
          ))}
        </nav>
        <InvoiceViewBar query={query} quick={quick} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action="" className="relative w-full max-w-xs">
          {filters.type && <input type="hidden" name="type" value={filters.type} />}
          {filters.status && <input type="hidden" name="status" value={filters.status} />}
          {PANEL_KEYS.map((k) => filters[k] && <input key={k} type="hidden" name={k} value={filters[k]} />)}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            data-page-search
            defaultValue={filters.q}
            placeholder={tDoc('searchPlaceholder')}
            className="w-full rounded-full border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </form>
        <div className="flex flex-wrap gap-1.5">
          <Link href={hrefWith(filters, { status: undefined })} className={chip(!filters.status)}>
            {tDoc('allStatuses')}
          </Link>
          {statusChips.map((status) => (
            <Link key={status} href={hrefWith(filters, { status })} className={chip(filters.status === status)}>
              {status === 'overdue' ? tDoc('overdue') : t(`status.${status}`)}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden />
        {presets.map(({ preset, active, href }) => (
          <Link key={preset} href={href} className={dateChip(active)}>
            {active && isDatePreset(preset) && dateField !== 'issue' && `${tDoc(`filters.dateField.${dateField}`)}: `}
            {t(`view.presets.${preset}`)}
          </Link>
        ))}
        {customRange && (
          <Link href={hrefWith(filters, noDates)} title={tDoc('filters.remove')} className={dateChip(true)}>
            {rangeLabel}
            <X className="h-3 w-3" aria-hidden />
          </Link>
        )}
        <DismissableDetails className="relative">
          <summary className={cn(dateChip(false), 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
            {tDoc('filters.period')}
            <ChevronDown className="h-3 w-3" aria-hidden />
          </summary>
          <div className="fixed inset-x-4 top-28 z-40 rounded-xl border border-border bg-card p-3 shadow-lg sm:absolute sm:inset-x-auto sm:left-0 sm:top-auto sm:mt-1 sm:w-[30rem]">
            <form action="">
              {Object.entries(filters).map(([k, v]) => (v && !(DATE_KEYS as readonly string[]).includes(k) ? <input key={k} type="hidden" name={k} value={v} /> : null))}
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{tDoc('filters.customRange')}</p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <FilterField label={tDoc('filters.dateBy')}>
                  <select name="date_field" defaultValue={dateField} className={field}>
                    {DATE_FIELDS.map((d) => (
                      <option key={d} value={d}>
                        {tDoc(`filters.dateField.${d}`)}
                      </option>
                    ))}
                  </select>
                </FilterField>
                <FilterField label={tDoc('filters.from')}>
                  <input type="date" name="from" defaultValue={filters.from} className={field} />
                </FilterField>
                <FilterField label={tDoc('filters.to')}>
                  <input type="date" name="to" defaultValue={filters.to} className={field} />
                </FilterField>
                <button type="submit" className="h-9 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90">
                  {tDoc('filters.apply')}
                </button>
              </div>
            </form>
            <p className="mt-3 border-t border-border pt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {tDoc('filters.quickRanges', { field: tDoc(`filters.dateField.${dateField}`) })}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
              {datePresets.map(({ preset, active, href }) => (
                <Link key={preset} href={href} className={cn(dateChip(active), 'justify-center')}>
                  {t(`view.presets.${preset}`)}
                </Link>
              ))}
            </div>
            {dateActive && (
              <Link href={hrefWith(filters, noDates)} className="mt-3 inline-block text-xs font-semibold text-muted-foreground hover:text-primary">
                {tDoc('filters.anyDate')}
              </Link>
            )}
          </div>
        </DismissableDetails>
      </div>

      <FilterPanel
        modal
        active={panelActive}
        pills={pills}
        keep={{ type: filters.type, status: filters.status, q: filters.q, date_field: filters.date_field, from: filters.from, to: filters.to }}
        clearHref={hrefWith(filters, Object.fromEntries(MODAL_KEYS.map((k) => [k, undefined])))}
      >
        <FilterField label={tDoc('filters.customer')}>
          <select name="contact_id" defaultValue={filters.contact_id ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {[...customers]
              .sort((a, b) => a.legalName.localeCompare(b.legalName, locale))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
          </select>
        </FilterField>
        {customers.some((c) => c.color) && (
          <FilterField label={tDoc('filters.customerColor')}>
            <select name="contact_color" defaultValue={filters.contact_color ?? ''} className={field}>
              <option value="">{tDoc('filters.any')}</option>
              {CONTACT_COLORS.filter((c) => customers.some((x) => x.color === c)).map((c) => (
                <option key={c} value={c}>
                  {tColors(c)}
                </option>
              ))}
            </select>
          </FilterField>
        )}
        <FilterField label={tDoc('filters.item')}>
          <input name="item" defaultValue={filters.item} placeholder={tDoc('filters.itemPlaceholder')} className={cn(field, 'w-full')} />
        </FilterField>
        <AmountRange label={tDoc('filters.amount')} min={filters.amount_min} max={filters.amount_max} minLabel={tDoc('filters.min')} maxLabel={tDoc('filters.max')} />
        <FilterField label={tDoc('filters.currency')}>
          <select name="currency" defaultValue={filters.currency ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tDoc('fields.paymentMethod')}>
          <select name="payment_method" defaultValue={filters.payment_method ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {tDoc(`payment.${m}`)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tDoc('filters.paidState')}>
          <select name="paid_state" defaultValue={filters.paid_state ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {PAID_STATES.map((p) => (
              <option key={p} value={p}>
                {tDoc(`filters.paidStates.${p}`)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.overdueDaysHint')}>
              <span>{tDoc('filters.overdueDays')}</span>
            </InfoHint>
          }
        >
          <select name="overdue_days" defaultValue={filters.overdue_days ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {['1', '7', '14', '30', '60', '90'].concat(filters.overdue_days && !['1', '7', '14', '30', '60', '90'].includes(filters.overdue_days) ? [filters.overdue_days] : []).map((d) => (
              <option key={d} value={d}>
                {tDoc('filters.overduePill').replace('#', d)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tDoc('filters.sent')}>{yesNoSelect('sent', tDoc('filters.sentYes'), tDoc('filters.sentNo'))}</FilterField>
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.viewedHint')}>
              <span>{tDoc('filters.viewed')}</span>
            </InfoHint>
          }
        >
          {yesNoSelect('viewed')}
        </FilterField>
        <FilterField label={tDoc('filters.reminded')}>{yesNoSelect('reminded')}</FilterField>
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.vatRateHint')}>
              <span>{tDoc('filters.vatRate')}</span>
            </InfoHint>
          }
        >
          <select name="vat_rate" defaultValue={filters.vat_rate ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {VAT_RATES.map((r) => (
              <option key={r} value={r}>
                {r} %
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tDoc('filters.reverseCharge')}>{yesNoSelect('reverse_charge')}</FilterField>
        <FilterField label={tDoc('filters.language')}>
          <select name="language" defaultValue={filters.language ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {tDoc(`filters.languages.${l}`)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tDoc('filters.source')}>
          <select name="source" defaultValue={filters.source ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {SOURCES.map((src) => (
              <option key={src} value={src}>
                {tDoc(`filters.sources.${src}`)}
              </option>
            ))}
          </select>
        </FilterField>
        {bankAccounts.length > 0 && (
          <FilterField label={tDoc('filters.bankAccount')}>
            <select name="bank_account_id" defaultValue={filters.bank_account_id ?? ''} className={field}>
              <option value="">{tDoc('filters.any')}</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({bankAccountLine(a)})
                </option>
              ))}
            </select>
          </FilterField>
        )}
        <FilterField label={tDoc('filters.attachments')}>{yesNoSelect('attachments')}</FilterField>
        <FilterField label={tDoc('filters.internalNote')}>{yesNoSelect('internal_note')}</FilterField>
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.clientResponseHint')}>
              <span>{tDoc('filters.clientResponse')}</span>
            </InfoHint>
          }
        >
          <select name="client_response" defaultValue={filters.client_response ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {CLIENT_RESPONSES.map((r) => (
              <option key={r} value={r}>
                {tDoc(`filters.clientResponses.${r}`)}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.noteHint')}>
              <span>{tDoc('filters.note')}</span>
            </InfoHint>
          }
        >
          <input name="note" defaultValue={filters.note} placeholder={tDoc('filters.notePlaceholder')} className={cn(field, 'w-full')} />
        </FilterField>
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.symbolHint')}>
              <span>{tDoc('filters.symbol')}</span>
            </InfoHint>
          }
        >
          <input name="symbol" inputMode="numeric" pattern="[0-9]{1,10}" defaultValue={filters.symbol} className={cn(field, 'w-full')} />
        </FilterField>
        <FilterField label={tDoc('fields.orderNumber')}>
          <input name="order_number" defaultValue={filters.order_number} className={cn(field, 'w-full')} />
        </FilterField>
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.customFieldHint')}>
              <span>{tDoc('filters.customField')}</span>
            </InfoHint>
          }
        >
          <input name="custom_field" defaultValue={filters.custom_field} placeholder={tDoc('filters.customFieldPlaceholder')} className={cn(field, 'w-full')} />
        </FilterField>
        <FilterField label={tDoc('filters.hasCustomFields')}>{yesNoSelect('has_custom_fields')}</FilterField>
        <AmountRange
          label={
            <InfoHint hint={tDoc('filters.netHint')}>
              <span>{tDoc('filters.net')}</span>
            </InfoHint>
          }
          names={['net_min', 'net_max']}
          min={filters.net_min}
          max={filters.net_max}
          minLabel={tDoc('filters.min')}
          maxLabel={tDoc('filters.max')}
        />
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.dueMinHint')}>
              <span>{tDoc('filters.dueMin')}</span>
            </InfoHint>
          }
        >
          <input type="number" name="due_min" min={0} step="any" inputMode="decimal" defaultValue={filters.due_min} className={cn(field, 'w-full')} />
        </FilterField>
        <FilterField label={tDoc('filters.country')}>
          <select name="country" defaultValue={filters.country ?? ''} className={field}>
            <option value="">{tDoc('filters.any')}</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {tDoc(`filters.countries.${c}`)}
              </option>
            ))}
          </select>
        </FilterField>
        {team.members.length > 1 && (
          <FilterField label={tDoc('filters.issuedBy')}>
            <select name="issued_by" defaultValue={filters.issued_by ?? ''} className={field}>
              <option value="">{tDoc('filters.any')}</option>
              {team.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </FilterField>
        )}
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.relatedHint')}>
              <span>{tDoc('filters.related')}</span>
            </InfoHint>
          }
        >
          {yesNoSelect('related')}
        </FilterField>
        <FilterField
          label={
            <InfoHint hint={tDoc('filters.needsAttentionHint')}>
              <span>{tDoc('filters.needsAttention')}</span>
            </InfoHint>
          }
        >
          {yesNoSelect('needs_attention')}
        </FilterField>
      </FilterPanel>

      <InvoicesTable rows={invoices} filtered={Boolean(query)} />
    </div>
  );
}
