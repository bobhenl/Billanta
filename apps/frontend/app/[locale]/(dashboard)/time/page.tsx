import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { FilterField, filterFieldClass as field, FilterPanel } from '@/components/filter-panel';
import { InfoHint } from '@/components/info-hint';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { formatMoney } from '@/lib/invoice-ui';
import { fetchCanWrite, fetchHomeCurrency } from '@/lib/tenant';
import { formatMinutes, type Project, type TimeEntry, type TimeSummary } from '@/lib/time-ui';
import { cn } from '@/lib/utils';
import type { Contact } from '../invoices/new/types';
import { EntriesTable } from './entries-table';
import { ProjectsManager } from './projects-manager';
import { TimerBar } from './timer-bar';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('time');
  return { title: t('title') };
}

const PERIODS = ['week', 'month', 'lastMonth', 'all'] as const;
const STATES = ['unbilled', 'billed', 'nonbillable'] as const;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

interface Filters {
  period?: string;
  state?: string;
  project?: string;
  contact?: string;
  from?: string;
  to?: string;
  q?: string;
}

const PANEL_KEYS = ['project', 'contact', 'from', 'to'] as const;

function hrefWith(current: Filters, change: Filters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...change })) if (value) params.set(key, value);
  const qs = params.toString();
  return qs ? `/time?${qs}` : '/time';
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The date range a period chip stands for (custom from/to win). */
function range(f: Filters): { from?: string; to?: string } {
  if (f.from || f.to) return { from: f.from, to: f.to };
  const now = new Date();
  if (f.period === 'week') {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return { from: iso(monday) };
  }
  if (f.period === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  if (f.period === 'lastMonth')
    return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return {};
}

export default async function TimePage(props: { searchParams: Promise<Filters> }) {
  const searchParams = await props.searchParams;
  const t = await getTranslations('time');
  const tDoc = await getTranslations('doc');
  const locale = await getLocale();

  const filters: Filters = {
    period: PERIODS.includes(searchParams.period as never) ? searchParams.period : undefined,
    state: STATES.includes(searchParams.state as never) ? searchParams.state : undefined,
    project: UUID.test(searchParams.project ?? '') ? searchParams.project : undefined,
    contact: UUID.test(searchParams.contact ?? '') ? searchParams.contact : undefined,
    from: ISO_DAY.test(searchParams.from ?? '') ? searchParams.from : undefined,
    to: ISO_DAY.test(searchParams.to ?? '') ? searchParams.to : undefined,
    q: searchParams.q?.trim().slice(0, 100) || undefined
  };
  // Default view: this month.
  const period = filters.period ?? (filters.from || filters.to ? undefined : 'month');
  const { from, to } = range({ ...filters, period });
  const query = new URLSearchParams({ state: filters.state ?? 'all' });
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (filters.project) query.set('project_id', filters.project);
  if (filters.contact) query.set('contact_id', filters.contact);

  let summary: TimeSummary, projects: Project[], entries: TimeEntry[], contacts: Contact[];
  try {
    [summary, projects, entries, contacts] = await Promise.all([
      apiFetch<TimeSummary>('/api/v1/time-entries/summary'),
      apiFetch<Project[]>('/api/v1/projects'),
      apiFetch<TimeEntry[]>(`/api/v1/time-entries?${query}`),
      apiFetch<Contact[]>('/api/v1/contacts').catch(() => [] as Contact[])
    ]);
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

  const home = await fetchHomeCurrency();
  const q = filters.q?.toLowerCase();
  const rows = q ? entries.filter((e) => [e.description, e.projectName, e.contactName].some((v) => v?.toLowerCase().includes(q))) : entries;
  const panelActive = PANEL_KEYS.filter((k) => filters[k]).length;
  const contactOptions = contacts.map((c) => ({ id: c.id, name: c.legalName })).sort((a, b) => a.name.localeCompare(b.name, locale));

  const cards = [
    { key: 'week', label: t('kpi.week'), value: formatMinutes(summary.weekMinutes) + ' h', href: hrefWith({}, { period: 'week' }), tone: 'text-primary' },
    {
      key: 'unbilled',
      label: t('kpi.unbilled'),
      value: summary.unbilled.length ? summary.unbilled.map((u) => formatMoney(u.amount, u.currency, locale)).join(' · ') : formatMoney(0, home, locale),
      sub: t('kpi.unbilledHours', { hours: formatMinutes(summary.unbilledMinutes) }),
      href: hrefWith({}, { period: 'all', state: 'unbilled' }),
      tone: 'text-warning'
    },
    {
      key: 'projects',
      label: t('kpi.projects'),
      value: String(projects.filter((p) => !p.archived).length),
      href: '#projects',
      tone: 'text-foreground'
    }
  ];

  const chip = (active: boolean) =>
    cn(
      'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors',
      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-primary'
    );

  // Time entries and projects sit under the invoices permission on the API.
  const canEdit = await fetchCanWrite('invoices');

  return (
    <div className="mx-auto max-w-6xl">
      <InfoHint hint={t('description')}>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
      </InfoHint>

      {canEdit && <TimerBar running={summary.running} projects={projects.filter((p) => !p.archived)} />}

      {/* Phones: the two short figures share a row and the money one spans it (dense fills the gap). */}
      <div className="mt-4 grid grid-flow-row-dense grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className={cn(
              'min-w-0 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50 sm:p-4',
              card.key === 'unbilled' && 'col-span-2 sm:col-span-1'
            )}
          >
            <div className="truncate text-xs font-semibold text-muted-foreground">{card.label}</div>
            <div title={String(card.value)} className={cn('mt-1 truncate text-lg font-extrabold tabular-nums sm:text-2xl', card.tone)}>{card.value}</div>
            {card.sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{card.sub}</div>}
          </Link>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form action="" className="relative w-full max-w-xs">
          {Object.entries(filters).map(([key, value]) => (key !== 'q' && value ? <input key={key} type="hidden" name={key} value={value} /> : null))}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            name="q"
            data-page-search
            defaultValue={filters.q}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="h-9 w-full rounded-full border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </form>
        {/* One swipeable row per chip group on a phone instead of a lone chip wrapping. */}
        <div className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:px-0">
          {PERIODS.map((p) => (
            <Link key={p} href={hrefWith(filters, { period: p, from: undefined, to: undefined })} className={chip(period === p)}>
              {t(`period.${p}`)}
            </Link>
          ))}
        </div>
      </div>
      <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        <Link href={hrefWith(filters, { state: undefined })} className={chip(!filters.state)}>
          {t('allStates')}
        </Link>
        {STATES.map((s) => (
          <Link key={s} href={hrefWith(filters, { state: s })} className={chip(filters.state === s)}>
            {t(`state.${s}`)}
          </Link>
        ))}
      </div>

      <FilterPanel
        active={panelActive}
        keep={{ period: filters.period, state: filters.state, q: filters.q }}
        clearHref={hrefWith(filters, Object.fromEntries(PANEL_KEYS.map((k) => [k, undefined])))}
      >
        <FilterField label={t('columns.project')}>
          <select name="project" defaultValue={filters.project ?? ''} className={cn(field, 'max-w-[14rem]')}>
            <option value="">{tDoc('filters.any')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={t('columns.contact')}>
          <select name="contact" defaultValue={filters.contact ?? ''} className={cn(field, 'max-w-[14rem]')}>
            <option value="">{tDoc('filters.any')}</option>
            {contactOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FilterField>
        <div>
          <span className="text-xs font-semibold text-muted-foreground">{tDoc('filters.date')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="date" name="from" aria-label={tDoc('filters.from')} defaultValue={filters.from} className={field} />
            <span className="text-muted-foreground">–</span>
            <input type="date" name="to" aria-label={tDoc('filters.to')} defaultValue={filters.to} className={field} />
          </div>
        </div>
      </FilterPanel>

      <EntriesTable rows={rows} projects={projects} contacts={contactOptions} filtered={rows.length !== entries.length || !!filters.state || panelActive > 0} />

      <ProjectsManager projects={projects} contacts={contactOptions} home={home} />
    </div>
  );
}
