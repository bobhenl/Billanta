import type { Metadata } from 'next';
import { ListFilter, Search } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { TwoFactorNotice } from '@/components/two-factor-notice';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { formatMoney, type InvoiceRow } from '@/lib/invoice-ui';
import {
  BANK_PERIODS,
  TRANSACTION_STATUSES,
  connectionLabel,
  filterTransactions,
  homeCurrencyTotals,
  isUnpairedPaypalCredit,
  paypalMovement,
  transactionSourceKey,
  type BankDirection,
  type BankPeriod,
  type BankListFilters,
  type BankTransaction,
  type TransactionStatus
} from '@/lib/bank-ui';
import { presetRange } from '@/lib/period-presets';
import { canManage, fetchCanWrite, fetchHomeCurrency, fetchMyRole } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { buttonClass } from '@/lib/ui-classes';
import type { BankRule } from '@/lib/bank-rules';
import type { BankConnection } from './actions';
import { BankConnections } from './bank-connections';
import { BankFilters } from './bank-filters';
import { BankImport } from './bank-import';
import { RematchButton } from './rematch-button';
import { BankTable, type BankRow } from './bank-reconciliation-panel';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bank');
  return { title: t('title') };
}

/**
 * `GET /bank` – imported statement lines, auto-matched against issued
 * invoices by the backend (`apps/backend/src/bank-reconciliation/`). Rows
 * open `/bank/{id}`, where the leftovers get matched by hand.
 */
export default async function BankReconciliationPage(props: {
  searchParams: Promise<{ status?: string; q?: string; source?: string; period?: string; from?: string; to?: string; dir?: string }>;
}) {
  const searchParams = await props.searchParams;
  const t = await getTranslations('bank');
  const locale = await getLocale();
  const status = TRANSACTION_STATUSES.includes(searchParams.status as TransactionStatus) ? (searchParams.status as TransactionStatus) : undefined;
  const q = searchParams.q?.trim().toLowerCase().slice(0, 100) || undefined;
  const source = searchParams.source?.slice(0, 64) || undefined;
  const direction: BankDirection | undefined = searchParams.dir === 'in' || searchParams.dir === 'out' ? searchParams.dir : undefined;
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const preset = BANK_PERIODS.includes(searchParams.period as BankPeriod) ? (searchParams.period as BankPeriod) : undefined;
  const range = preset ? presetRange(preset) : { from: day(searchParams.from), to: day(searchParams.to) };
  const period: BankPeriod | 'custom' | '' = preset ?? (range.from || range.to ? 'custom' : '');
  // Status chips and cards keep the other filters in the link.
  const kept = { q, source, period: preset, from: preset ? undefined : range.from, to: preset ? undefined : range.to, dir: direction };
  const href = (s?: string) => {
    const p = new URLSearchParams();
    if (s) p.set('status', s);
    for (const [key, value] of Object.entries(kept)) if (value) p.set(key, value);
    const qs = p.toString();
    return qs ? `/bank?${qs}` : '/bank';
  };

  let transactions: BankTransaction[];
  let invoices: InvoiceRow[];
  let connections: BankConnection[];
  let psd2: { available: boolean; countries: string[] };
  let ruleNames: Pick<BankRule, 'id' | 'name' | 'action' | 'enabled' | 'conditions' | 'connectionId'>[];
  const [home, canEdit, role] = await Promise.all([fetchHomeCurrency(), fetchCanWrite('bank'), fetchMyRole().catch(() => null)]);
  try {
    [transactions, invoices, connections, psd2, ruleNames] = await Promise.all([
      apiFetch<BankTransaction[]>('/api/v1/bank-reconciliation/transactions'),
      apiFetch<InvoiceRow[]>('/api/v1/invoices').catch(() => [] as InvoiceRow[]),
      apiFetch<BankConnection[]>('/api/v1/bank-reconciliation/connections').catch(() => [] as BankConnection[]),
      apiFetch<{ available: boolean; countries: string[] }>('/api/v1/bank-reconciliation/connections/psd2').catch(() => ({
        available: false,
        countries: []
      })),
      // Only for the "ignored by rule X" labels and the accounts' "only …" tags; the list works without it.
      apiFetch<BankRule[]>('/api/v1/bank-reconciliation/rules').catch(() => [] as BankRule[])
    ]);
  } catch (err) {
    if (err instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (err instanceof NoTenantError) return <Banner tone="info" className="mt-6">{t('noTenant')}</Banner>;
    return (
      <Banner tone="err" title={t('loadError')} className="mt-6">
        <span className="font-mono text-xs">{err instanceof ApiError ? err.message : String(err)}</span>
      </Banner>
    );
  }

  const byId = new Map(invoices.map((i) => [i.id, i]));
  const ruleName = new Map(ruleNames.map((r) => [r.id, r.name]));
  const rows: BankRow[] = transactions.map((tx) => {
    const inv = tx.matchedInvoiceId ? byId.get(tx.matchedInvoiceId) : undefined;
    return {
      ...tx,
      invoiceNumber: inv?.invoiceNumber ?? null,
      invoiceContact: inv?.contactName ?? null,
      ruleName: tx.appliedRuleId ? (ruleName.get(tx.appliedRuleId) ?? null) : null
    };
  });
  const filters: BankListFilters = { status, q, source, from: range.from, to: range.to, direction };
  const visible = filterTransactions(rows, filters, connections);
  // The cards follow every filter but the status chip they themselves set.
  const scoped = filterTransactions(rows, filters, connections, ['status']);

  // One option per connected account, plus uploads and orphaned syncs that actually have rows.
  const present = new Set(rows.map((r) => transactionSourceKey(r, connections)));
  const fallbacks: [string, string][] = [
    ['upload', t('filters.upload')],
    ['paypal', 'PayPal'],
    ['stripe', 'Stripe'],
    ['fio', 'Fio'],
    ['psd2', t('filters.psd2')]
  ];
  const sourceOptions = [
    ...connections.filter((c) => c.status !== 'pending').map((c) => ({ value: `c:${c.id}`, label: connectionLabel(c) })),
    ...fallbacks.filter(([key]) => present.has(key)).map(([value, label]) => ({ value, label }))
  ];

  // PayPal money that reached the bank without its withdrawal, or a withdrawal the bank never showed.
  const unpairedCredits = transactions.filter(isUnpairedPaypalCredit).length;
  const lastBankDay = transactions.reduce((max, tx) => (tx.externalId ? max : tx.transactionDate > max ? tx.transactionDate : max), '');
  const weekBefore = lastBankDay ? new Date(new Date(lastBankDay).getTime() - 7 * 86_400_000).toISOString().slice(0, 10) : '';
  const lostWithdrawals = transactions.filter(
    (tx) => paypalMovement(tx) === 'withdrawal' && !tx.transferPairId && weekBefore && tx.transactionDate.slice(0, 10) < weekBefore
  ).length;
  const unmatchedTotal = transactions.filter((tx) => tx.status === 'unmatched').length;
  const { incoming, outgoing } = homeCurrencyTotals(scoped, home);
  const unmatched = scoped.filter((tx) => tx.status === 'unmatched');
  const matchedCount = scoped.filter((tx) => tx.status === 'matched').length;
  const cards = [
    { key: 'unmatched', label: t('kpi.toReview'), value: String(unmatched.length), href: href('unmatched'), tone: unmatched.length ? 'text-warning' : '' },
    { key: 'matched', label: t('kpi.matched'), value: String(matchedCount), href: href('matched'), tone: 'text-success' },
    { key: 'in', label: t('kpi.incoming', { currency: home }), value: formatMoney(incoming, home, locale), href: null, tone: 'text-primary' },
    { key: 'out', label: t('kpi.outgoing', { currency: home }), value: formatMoney(outgoing, home, locale), href: null, tone: '' }
  ];

  const chip = (active: boolean) =>
    cn(
      'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors',
      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-primary'
    );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
        <div className="flex flex-wrap items-start gap-2">
          <Link href="/bank/rules" className={buttonClass.secondary}>
            <ListFilter className="h-4 w-4" />
            {t('rulesLink')}
          </Link>
          {canEdit && unmatchedTotal > 0 && <RematchButton />}
          {canEdit && <BankImport />}
        </div>
      </div>

      {/* Two compact rows on a phone; full-size cards filled the first screen. */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:mt-6 sm:grid-cols-4 sm:gap-3">
        {cards.map((card) => {
          const body = (
            <>
              <div className="truncate text-[11px] font-semibold text-muted-foreground sm:text-xs">{card.label}</div>
              <div title={String(card.value)} className={cn('mt-1 truncate text-base font-extrabold tabular-nums sm:text-2xl', card.tone, card.href === null && 'amount')}>{card.value}</div>
            </>
          );
          const box = 'min-w-0 rounded-xl border border-border bg-card p-2.5 sm:p-4';
          // Only the counts filter the list; the sums are plain figures.
          return card.href ? (
            <Link key={card.key} href={card.href} className={cn(box, 'transition-colors hover:border-primary/50')}>
              {body}
            </Link>
          ) : (
            <div key={card.key} className={box}>
              {body}
            </div>
          );
        })}
      </div>

      {(unpairedCredits > 0 || lostWithdrawals > 0) && (
        <Banner tone="warn" title={t('transfer.warnTitle')} className="mt-6">
          {[unpairedCredits > 0 ? t('transfer.unpairedCredits', { n: unpairedCredits }) : null, lostWithdrawals > 0 ? t('transfer.lostWithdrawals', { n: lostWithdrawals }) : null]
            .filter(Boolean)
            .join(' ')}
        </Banner>
      )}
      <TwoFactorNotice className="mt-6" />
      <BankConnections connections={connections} psd2={psd2} canManage={canManage(role)} importRules={ruleNames} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form action="" className="relative w-full sm:max-w-xs">
          {status && <input type="hidden" name="status" value={status} />}
          {Object.entries(kept).map(([key, value]) => key !== 'q' && value && <input key={key} type="hidden" name={key} value={value} />)}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            name="q"
            data-page-search
            defaultValue={q}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="h-10 w-full rounded-full border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </form>
        {/* One swipeable row on phones instead of chips stacking into several lines. */}
        <div className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:px-0">
          <Link href={href()} className={chip(!status)}>
            {t('filterAll')}
          </Link>
          {TRANSACTION_STATUSES.map((s) => (
            <Link key={s} href={href(s)} className={chip(status === s)}>
              {t(`status.${s}`)}
            </Link>
          ))}
        </div>
        <div className="w-full sm:w-auto">
          <BankFilters sources={sourceOptions} period={period} from={range.from ?? ''} to={range.to ?? ''} />
        </div>
      </div>

      <BankTable rows={visible} empty={transactions.length === 0} />
    </div>
  );
}
