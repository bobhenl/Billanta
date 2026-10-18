import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getClientPortal, type ClientPortalDocument } from '@/lib/client-portal';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { privateLinkMetadata } from '@/lib/seo';
import { cn } from '@/lib/utils';

// A customer's private portal link: never indexed, never followed.
// Generic, non-revealing preview card; see privateLinkMetadata.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return privateLinkMetadata(locale);
}
export const dynamic = 'force-dynamic';

const FILTERS = ['all', 'unpaid', 'paid', 'quotes'] as const;
type Filter = (typeof FILTERS)[number];

const matches = (d: ClientPortalDocument, f: Filter) =>
  f === 'all' ||
  (f === 'unpaid' && d.balance > 0) ||
  (f === 'paid' && d.status === 'paid') ||
  (f === 'quotes' && d.documentType === 'quote');

type DocState = 'overdue' | 'unpaid' | 'paid' | 'accepted' | 'rejected' | 'quote' | 'issued' | 'cancelled';

const STATE_CLASSES: Record<DocState, string> = {
  overdue: 'bg-destructive/10 text-destructive',
  unpaid: 'bg-warning/15 text-warning',
  paid: 'bg-success/15 text-success',
  accepted: 'bg-success/15 text-success',
  rejected: 'bg-destructive/10 text-destructive',
  quote: 'bg-accent text-accent-foreground',
  issued: 'bg-accent text-accent-foreground',
  cancelled: 'bg-muted text-muted-foreground'
};

function docState(d: ClientPortalDocument): DocState {
  if (d.status === 'cancelled') return 'cancelled';
  if (d.balance > 0) return d.overdue ? 'overdue' : 'unpaid';
  if (d.documentType === 'quote') return d.clientResponse ?? 'quote';
  return d.status === 'paid' ? 'paid' : 'issued';
}

/**
 * Per-customer client portal (Invoice Ninja's client portal): every issued
 * document for one customer behind `contacts.portal_token`, each linking to
 * its own `/i/:token` page with the payment QR. Same placement and chrome-free
 * layout as that page.
 */
export default async function ClientPortalPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { token } = await params;
  const portal = await getClientPortal(token);
  if (!portal) notFound();

  const { filter: rawFilter } = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(rawFilter ?? '') ? (rawFilter as Filter) : 'all';
  const t = await getTranslations('clientPortal');
  const tApp = await getTranslations('app');
  const locale = await getLocale();
  const docs = portal.documents.filter((d) => matches(d, filter));
  const counts = Object.fromEntries(FILTERS.map((f) => [f, portal.documents.filter((d) => matches(d, f)).length])) as Record<Filter, number>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <p className="text-center text-sm font-medium text-muted-foreground">{tApp('name')}</p>

      <header className="mt-6">
        <p className="text-sm font-semibold text-primary">{portal.companyName}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{t('title', { name: portal.customerName })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('lead', { company: portal.companyName })}</p>
      </header>

      <section className="mt-6 grid gap-2 sm:grid-cols-2">
        {portal.outstanding.length === 0 ? (
          <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success sm:col-span-2">{t('allPaid')}</div>
        ) : (
          portal.outstanding.map((o) => (
            <div key={o.currency} className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs font-semibold text-muted-foreground">{t('outstanding')}</div>
              <div className="mt-0.5 text-2xl font-extrabold tabular-nums">{formatMoney(o.amount, o.currency, locale)}</div>
              {o.overdue > 0 && (
                <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t('overdueOf', { amount: formatMoney(o.overdue, o.currency, locale) })}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <nav className="mt-6 flex gap-1.5 overflow-x-auto pb-1" aria-label={t('filterLabel')}>
        {FILTERS.filter((f) => f === 'all' || counts[f] > 0).map((f) => (
          <Link
            key={f}
            href={f === 'all' ? `/c/${token}` : `/c/${token}?filter=${f}`}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors',
              f === filter ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent hover:text-primary'
            )}
          >
            {t(`filters.${f}`)} <span className="opacity-70">{counts[f]}</span>
          </Link>
        ))}
      </nav>

      {docs.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {docs.map((d) => {
            const state = docState(d);
            const dueText =
              d.dueDate && d.documentType !== 'credit_note'
                ? ` · ${t(d.documentType === 'quote' ? 'validUntil' : 'due', { date: formatDate(d.dueDate, locale) ?? '' })}`
                : '';
            return (
              <li key={d.token}>
                <Link href={`/i/${d.token}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold">{d.number ?? t('unnumbered')}</span>
                      <span className="text-xs text-muted-foreground">{t(`types.${d.documentType}`)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(d.issueDate, locale)}
                      {dueText}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold tabular-nums">{formatMoney(d.balance > 0 ? d.balance : d.total, d.currency, locale)}</div>
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', STATE_CLASSES[state])}>{t(`state.${state}`)}</span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">{t('footer', { company: portal.companyName })}</p>
    </div>
  );
}
