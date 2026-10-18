import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { TwoFactorNotice } from '@/components/two-factor-notice';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { formatMoney, type InvoiceRow } from '@/lib/invoice-ui';
import { TRANSACTION_STATUSES, type BankTransaction, type TransactionStatus } from '@/lib/bank-ui';
import { fetchHomeCurrency } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import type { BankConnection } from './actions';
import { BankConnections } from './bank-connections';
import { BankImport } from './bank-import';
import { BankTable, type BankRow } from './bank-reconciliation-panel';

/**
 * `GET /bank` — imported statement lines, auto-matched against issued
 * invoices by the backend (`apps/backend/src/bank-reconciliation/`). Rows
 * open `/bank/{id}`, where the leftovers get matched by hand.
 */
export default async function BankReconciliationPage(props: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const searchParams = await props.searchParams;
  const t = await getTranslations('bank');
  const locale = await getLocale();
  const status = TRANSACTION_STATUSES.includes(searchParams.status as TransactionStatus) ? (searchParams.status as TransactionStatus) : undefined;
  const q = searchParams.q?.trim().toLowerCase().slice(0, 100) || undefined;

  let transactions: BankTransaction[];
  let invoices: InvoiceRow[];
  let connections: BankConnection[];
  let psd2: { available: boolean; countries: string[] };
  const home = await fetchHomeCurrency();
  try {
    [transactions, invoices, connections, psd2] = await Promise.all([
      apiFetch<BankTransaction[]>('/api/v1/bank-reconciliation/transactions'),
      apiFetch<InvoiceRow[]>('/api/v1/invoices').catch(() => [] as InvoiceRow[]),
      apiFetch<BankConnection[]>('/api/v1/bank-reconciliation/connections').catch(() => [] as BankConnection[]),
      apiFetch<{ available: boolean; countries: string[] }>('/api/v1/bank-reconciliation/connections/psd2').catch(() => ({
        available: false,
        countries: []
      }))
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
  const rows: BankRow[] = transactions.map((tx) => {
    const inv = tx.matchedInvoiceId ? byId.get(tx.matchedInvoiceId) : undefined;
    return { ...tx, invoiceNumber: inv?.invoiceNumber ?? null, invoiceContact: inv?.contactName ?? null };
  });
  const visible = rows.filter(
    (r) =>
      (!status || r.status === status) &&
      (!q || [r.counterpartyName, r.variableSymbol, r.counterpartyAccount, r.invoiceNumber].some((v) => v?.toLowerCase().includes(q)))
  );

  const atHome = transactions.filter((tx) => tx.currency === home);
  const incoming = atHome.filter((tx) => Number(tx.amount) > 0).reduce((s, tx) => s + Number(tx.amount), 0);
  const outgoing = atHome.filter((tx) => Number(tx.amount) < 0).reduce((s, tx) => s + Number(tx.amount), 0);
  const unmatched = transactions.filter((tx) => tx.status === 'unmatched');
  const matchedCount = transactions.filter((tx) => tx.status === 'matched').length;
  const cards = [
    { key: 'unmatched', label: t('kpi.toReview'), value: String(unmatched.length), href: '/bank?status=unmatched', tone: unmatched.length ? 'text-warning' : '' },
    { key: 'matched', label: t('kpi.matched'), value: String(matchedCount), href: '/bank?status=matched', tone: 'text-success' },
    { key: 'in', label: t('kpi.incoming', { currency: home }), value: formatMoney(incoming, home, locale), href: '/bank', tone: 'text-primary' },
    { key: 'out', label: t('kpi.outgoing', { currency: home }), value: formatMoney(outgoing, home, locale), href: '/bank', tone: '' }
  ];

  const chip = (active: boolean) =>
    cn(
      'rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-primary'
    );
  const href = (s?: string) => {
    const p = new URLSearchParams();
    if (s) p.set('status', s);
    if (q) p.set('q', q);
    const qs = p.toString();
    return qs ? `/bank?${qs}` : '/bank';
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('description')}</p>
        </div>
        <BankImport />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{card.label}</div>
            <div className={cn('mt-1 text-2xl font-extrabold tabular-nums', card.tone)}>{card.value}</div>
          </Link>
        ))}
      </div>

      <TwoFactorNotice className="mt-6" />
      <BankConnections connections={connections} psd2={psd2} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form action="" className="w-full max-w-xs">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            name="q"
            data-page-search
            defaultValue={q}
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-full border border-input bg-background px-4 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </form>
        <Link href={href()} className={chip(!status)}>
          {t('filterAll')}
        </Link>
        {TRANSACTION_STATUSES.map((s) => (
          <Link key={s} href={href(s)} className={chip(status === s)}>
            {t(`status.${s}`)}
          </Link>
        ))}
      </div>

      <BankTable rows={visible} empty={transactions.length === 0} />
    </div>
  );
}
