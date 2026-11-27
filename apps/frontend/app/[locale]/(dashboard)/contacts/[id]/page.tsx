import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ColorDot } from '@/components/color-dot';
import { ArrowLeft, BadgeCheck, Lock, Mail, MapPin, Phone, Star, UserRound } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { VatStatusBadge } from '@/components/vat-status-badge';
import { isSealed } from '@faktur/cz-compliance';
import { ConfidentialJoin, ConfidentialLink } from '@/components/vault/confidential-join';
import { ConfidentialText } from '@/components/vault/confidential-text';
import { MoneySum } from '@/components/vault/sealed-amounts';
import { apiFetch, ApiError, NotSignedInError } from '@/lib/api-client';
import { formatDate, formatMoney, type InvoiceRow } from '@/lib/invoice-ui';
import { EXPENSE_STATE_CLASSES, expenseState, type ExpensePage } from '@/lib/expense-ui';
import { cn } from '@/lib/utils';
import { fetchMyRole, fetchUsage } from '@/lib/tenant';
import { auth } from '@/auth';
import { lockOf } from '@/lib/usage';
import type { Contact } from '../../invoices/new/types';
import { InvoicesTable } from '../../invoices/invoices-table';
import { ClientPortalCard } from './client-portal-card';
import { ContactActions } from './contact-actions';
import { ContactVisibilityCard, type TeamMemberOption } from './contact-visibility-card';
import { SealButton } from '@/components/vault/seal-button';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ContactDetail = Contact & { aresVerifiedAt: string | null; createdAt?: string; portalLink?: string | null; portalLinkDefault?: string | null; portalSlug?: string | null };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts.detail');
  return { title: t('title') };
}

export default async function ContactDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID.test(params.id)) notFound();
  const locale = await getLocale();
  const t = await getTranslations('contacts.detail');
  const tExp = await getTranslations('expenses.state');

  let contact: ContactDetail | undefined;
  try {
    contact = (await apiFetch<ContactDetail[]>(`/api/v1/contacts/${params.id}`))[0];
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (!(error instanceof ApiError && error.status === 404)) {
      return (
        <Banner tone="err" title={t('loadError')} className="mt-6">
          <span className="font-mono text-xs">{String(error instanceof Error ? error.message : error)}</span>
        </Banner>
      );
    }
  }
  if (!contact) notFound();

  const [invoices, expensePage, usage, role, session, team] = await Promise.all([
    apiFetch<InvoiceRow[]>(`/api/v1/invoices?contact_id=${contact.id}`).catch(() => [] as InvoiceRow[]),
    apiFetch<ExpensePage>('/api/v1/expenses?limit=100&page=1').catch(() => null),
    fetchUsage(),
    fetchMyRole().catch(() => null),
    auth(),
    apiFetch<{ members: { userId: string; name: string | null; email: string }[] }>('/api/v1/team').catch(() => null)
  ]);
  const members: TeamMemberOption[] = (team?.members ?? []).map((m) => ({ userId: m.userId, name: m.name || m.email }));
  // Same rule as the API (mayChangeContactVisibility): the company owner, or the member the client belongs to.
  const canChangeVisibility = role === 'owner' || (!!contact.ownerUserId && contact.ownerUserId === session?.user?.id);
  const expenses = (expensePage?.data ?? []).filter((e) => e.supplierContactId === contact.id);

  // Per-currency stats over real (non-cancelled, non-quote) documents.
  const billable = invoices.filter((i) => i.status !== 'cancelled' && i.status !== 'draft' && i.documentType !== 'quote' && i.documentType !== 'proforma');
  // Sealed amounts (Důvěrný režim) have no server total: the browser adds them after unlock.
  const byCurrency = new Map<string, { total: number; open: number; sealed: string[]; sealedOpen: string[] }>();
  for (const inv of billable) {
    const s = byCurrency.get(inv.currency) ?? { total: 0, open: 0, sealed: [], sealedOpen: [] };
    if (inv.total == null || inv.encAmounts) {
      s.sealed.push(inv.encAmounts ?? '');
      if (!inv.paidAt) s.sealedOpen.push(inv.encAmounts ?? '');
    } else {
      s.total += inv.total;
      if (!inv.paidAt) s.open += inv.total;
    }
    byCurrency.set(inv.currency, s);
  }
  const overdue = invoices.filter((i) => i.isOverdue).length;
  const paid = billable.filter((i) => i.paidAt && i.dueDate);
  const avgDelay = paid.length
    ? Math.round(paid.reduce((acc, i) => acc + (Date.parse(i.paidAt!) - Date.parse(i.dueDate!)) / 86_400_000, 0) / paid.length)
    : null;
  const lastInvoice = invoices.map((i) => i.issueDate).filter(Boolean).sort().at(-1) ?? null;

  // Encrypted contacts (Důvěrný režim) are opened in the browser, part by part.
  const sealedAddress = [contact.addressStreet, contact.addressPostalCode, contact.addressCity].some(isSealed);
  const address = [contact.addressStreet, [contact.addressPostalCode, contact.addressCity].filter(Boolean).join(' '), contact.addressCountry]
    .filter(Boolean)
    .join(', ');
  const stats = [
    ...[...byCurrency.entries()].flatMap(([currency, s]) => [
      {
        label: t('stats.invoiced', { currency }),
        value: s.sealed.length ? <MoneySum plain={s.total} sealed={s.sealed} currency={currency} /> : formatMoney(s.total, currency, locale),
        tone: 'text-primary'
      },
      {
        label: t('stats.open', { currency }),
        value: s.sealedOpen.length ? <MoneySum plain={s.open} sealed={s.sealedOpen} currency={currency} /> : formatMoney(s.open, currency, locale),
        tone: s.open > 0 || s.sealedOpen.length > 0 ? 'text-warning' : ''
      }
    ]),
    // A customer with nothing invoiced yet gets no row of zeros and dashes.
    ...(billable.length ? [{ label: t('stats.overdue'), value: String(overdue), tone: overdue > 0 ? 'text-destructive' : '', count: true }] : []),
    ...(avgDelay === null
      ? []
      : [
          {
            label: t('stats.avgDelay'),
            value: avgDelay <= 0 ? t('stats.onTime') : t('stats.days', { count: avgDelay }),
            tone: avgDelay > 0 ? 'text-warning' : ''
          }
        ])
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/contacts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            {contact.isStarred && <Star className="h-5 w-5 shrink-0 fill-warning text-warning" />}
            <ColorDot color={contact.color} className="h-3 w-3" />
            <ConfidentialText value={contact.legalName} className="truncate" />
            {contact.isPrivate && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={t('visibility.private')} />}
            {contact.aresVerifiedAt && <BadgeCheck className="h-5 w-5 shrink-0 text-primary" aria-label={t('aresVerified')} />}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[contact.ico && `IČO ${contact.ico}`, contact.dic && `DIČ ${contact.dic}`].filter(Boolean).join(' · ') || (contact.isPerson ? t('person') : t('noIco'))}
          </p>
          {contact.dic && !contact.isPerson && <VatStatusBadge dic={contact.dic} className="mt-2" />}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <ContactActions contact={contact} />
          {/* "Zašifrovat" every document of this customer; shown only with Důvěrný režim on. */}
          <SealButton scope={{ kind: 'contact', contactId: contact.id }} compact />
        </div>
      </div>

      {stats.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
              <div title={s.label} className="truncate text-xs text-muted-foreground">{s.label}</div>
              <div title={typeof s.value === 'string' ? s.value : undefined} className={cn('mt-1 truncate text-lg font-extrabold tabular-nums sm:text-2xl', s.tone, !('count' in s) && 'amount')}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">{t('invoices')}</h2>
            {invoices.length > 0 && (
              <Link href={`/invoices?contact_id=${contact.id}`} className="text-sm font-semibold text-primary hover:underline">
                {t('invoicesFilter')}
              </Link>
            )}
          </div>
          <InvoicesTable rows={invoices} filtered={false} omit={['customer']} />

          {/* Most contacts are only customers; an empty expenses block would just be noise. */}
          {expenses.length > 0 && (
            <>
            <h2 className="mt-8 text-lg font-bold">{t('expenses')}</h2>
            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {expenses.map((e) => {
                const state = expenseState(e);
                return (
                  <li key={e.id}>
                    <Link href={`/expenses/${e.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/60">
                      <span className="hidden w-24 shrink-0 tabular-nums text-muted-foreground sm:block">{formatDate(e.expenseDate, locale)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{e.description}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground sm:hidden">{formatDate(e.expenseDate, locale)}</span>
                      </span>
                      <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', EXPENSE_STATE_CLASSES[state])}>{tExp(state)}</span>
                      <span className="shrink-0 text-right font-semibold tabular-nums sm:w-28"><span className="amount">{formatMoney(Number(e.amount), e.currency, locale)}</span></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            </>
          )}
        </div>

        <aside className="space-y-4">
          {contact.internalNote && (
            <section className="rounded-xl border border-warning/40 bg-warning/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Lock className="h-4 w-4 text-warning" />
                {t('internalNote')}
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm">
                <ConfidentialText value={contact.internalNote} />
              </p>
            </section>
          )}
          <section className="rounded-xl border border-border bg-card p-4 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('info')}</h2>
            <dl className="mt-3 space-y-2.5">
              {contact.contactPerson && (
                <div className="flex gap-2">
                  <dt className="sr-only">{t('contactPerson')}</dt>
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <dd>
                    <ConfidentialText value={contact.contactPerson} />
                  </dd>
                </div>
              )}
              {address && (
                <div className="flex gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <dd>{sealedAddress ? <ConfidentialJoin parts={[contact.addressStreet, contact.addressPostalCode, contact.addressCity, contact.addressCountry]} /> : address}</dd>
                </div>
              )}
              {contact.email && (
                <div className="flex gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <dd>
                    <ConfidentialLink value={contact.email} kind="mailto" className="text-primary hover:underline" />
                  </dd>
                </div>
              )}
              {contact.phone && (
                <div className="flex gap-2">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <dd>
                    <ConfidentialLink value={contact.phone} kind="tel" className="text-primary hover:underline" />
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('vatPayer')}</dt>
                <dd className="font-semibold">{contact.isVatPayer === null ? '–' : contact.isVatPayer ? t('yes') : t('no')}</dd>
              </div>
              {contact.aresVerifiedAt && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('aresCheck')}</dt>
                  <dd className="font-semibold">{formatDate(contact.aresVerifiedAt, locale)}</dd>
                </div>
              )}
              {lastInvoice && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('lastInvoice')}</dt>
                  <dd className="font-semibold">{formatDate(lastInvoice, locale)}</dd>
                </div>
              )}
            </dl>
          </section>
          <ContactVisibilityCard
            contactId={contact.id}
            ownerUserId={contact.ownerUserId ?? null}
            isPrivate={!!contact.isPrivate}
            members={members}
            canChange={canChangeVisibility}
          />
          <ClientPortalCard contactId={contact.id} link={contact.portalLink ?? null} defaultLink={contact.portalLinkDefault ?? null} slug={contact.portalSlug ?? null} lock={lockOf(usage, 'client_portal')} />
          {/* ARES only knows Czech companies. */}
          {contact.ico && (contact.addressCountry || 'CZ') === 'CZ' && (
            <a
              href={`https://ares.gov.cz/ekonomicke-subjekty?ico=${contact.ico}`}
              target="_blank"
              rel="noreferrer"
              className="block text-center text-xs text-muted-foreground hover:text-primary"
            >
              {t('openAres')}
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
