import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Lock, Building2, CheckCircle2, ChevronDown, Eye, FileText, History, Link2, Wallet, XCircle } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { AuditLogList } from '@/components/audit-log-list';
import { Banner } from '@/components/banner';
import { fetchAuditLog, type AuditPage } from '@/lib/audit';
import { NetEstimate } from '@/components/net-estimate';
import { displayCustomField, documentVars } from '@/lib/custom-fields';
import { fetchCanWrite, fetchTenant, type BuyerDetailsField } from '@/lib/tenant';
import { apiFetch, ApiError, NotSignedInError } from '@/lib/api-client';
import {
  buyerDetailsState,
  displayStatus,
  formatDate,
  fxLabelOf,
  formatMoney,
  rateQuote,
  STATUS_BADGE_CLASSES,
  TYPE_BADGE_CLASSES,
  type InvoiceDetail
} from '@/lib/invoice-ui';
import { cn } from '@/lib/utils';
import { homeCurrencyOf, lawUrl } from '@faktur/cz-compliance';
import { AttachmentsPanel, type Attachment } from './attachments-panel';
import { InvoiceActions } from './invoice-actions';
import { BuyerDetailsRequest } from './buyer-details-request';
import { PublicLinkPanel } from './public-link-panel';

/** A rule reference such as "§29/1c ZDPH", linked to the law text when lawUrl knows it. */
function LawRef({ rule }: { rule?: string }) {
  if (!rule) return null;
  const href = lawUrl(rule);
  const cls = 'font-mono text-xs opacity-70';
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cn(cls, 'underline underline-offset-2 hover:opacity-100')}>
      {rule}
    </a>
  ) : (
    <span className={cls}>{rule}</span>
  );
}

type CheckIssue = { scheme: 'law' | 'peppol'; rule?: string; field: string; code: string; severity: 'error' | 'warning' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('doc');
  return { title: t('detailTitle') };
}

export default async function InvoiceDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID.test(params.id)) notFound();
  const locale = await getLocale();
  const t = await getTranslations('doc');
  const tStatus = await getTranslations('invoices.status');
  const tBuyer = await getTranslations('invoices.buyerDetails');
  const tProfileOrder = await getTranslations('invoices.profileOrder');
  const tGloss = await getTranslations('glossary');

  let detail: InvoiceDetail;
  let attachments: Attachment[] | null = null;
  let history: AuditPage | null = null;
  let lastEdit: AuditPage | null = null;
  let companyVars: { key: string; value: string }[] = [];
  let homeCountry: string | undefined;
  let defaultRequired: BuyerDetailsField[] = ['email', 'ico'];
  try {
    let tenant;
    [detail, attachments, tenant, history, lastEdit] = await Promise.all([
      apiFetch<InvoiceDetail>(`/api/v1/invoices/${params.id}/detail`),
      apiFetch<Attachment[]>(`/api/v1/invoices/${params.id}/attachments`).catch(() => null),
      fetchTenant().catch(() => null),
      fetchAuditLog({ entityType: 'invoice', entityId: params.id, limit: 10 }),
      fetchAuditLog({ entityType: 'invoice', entityId: params.id, action: 'edited_issued', limit: 1 })
    ]);
    companyVars = (tenant?.templateVars ?? []).map((v) => ({ key: v.key, value: v.value }));
    homeCountry = tenant?.addressCountry;
    if (tenant?.buyerDetailsRequired) defaultRequired = tenant.buyerDetailsRequired;
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <Banner tone="err" title={t('loadError')} className="mt-6">
        <span className="font-mono text-xs">{String(error instanceof Error ? error.message : error)}</span>
      </Banner>
    );
  }

  const { invoice, contact, items, totals, parent, children } = detail;
  // Asking the customer for their details changes the draft, so a read-only member doesn't get the box.
  const canEdit = await fetchCanWrite('invoices');
  // The buyer as printed on the document (issue-date snapshot); older backends send only `contact`.
  const buyer = detail.buyer ?? contact;
  // Mandatory-content check (CZ/SK law; Peppol for an issued invoice to a foreign buyer).
  const checkIssues =
    invoice.status !== 'cancelled'
      ? await apiFetch<{ issues: CheckIssue[] }>(`/api/v1/invoices/${params.id}/check`)
          .then((r) => r.issues)
          .catch(() => [])
      : [];
  const lawIssues = checkIssues.filter((i) => i.scheme === 'law');
  // A draft without a customer: the "fill in" box offers sending the link or picking a contact right there.
  const customerMissing =
    (invoice.status === 'draft' || invoice.status === 'pending_review') &&
    invoice.documentType !== 'credit_note' &&
    !invoice.buyerDetailsToken &&
    lawIssues.some((i) => i.code === 'customerMissing');
  const peppolIssues = checkIssues.filter((i) => i.scheme === 'peppol');
  const money = (n: number) => formatMoney(n, invoice.currency, locale);
  // The customer has an older copy: edited in place after the last send.
  const editedAt = lastEdit?.items[0]?.createdAt;
  const editedAfterSend = Boolean(invoice.sentAt && editedAt && invoice.status !== 'cancelled' && Date.parse(editedAt) > Date.parse(invoice.sentAt));
  const status = displayStatus(invoice);
  const statusLabel = status === 'overdue' ? t('overdue') : tStatus(status);
  const title = invoice.invoiceNumber
    ? `${t(`type.${invoice.documentType}`)} ${invoice.invoiceNumber}`
    : t('draftOf', { type: t(`type.${invoice.documentType}`) });

  // Same maths as the PDF (lib/custom-fields mirrors the backend).
  const docVars = documentVars(invoice.customFields, totals, invoice.amountPaid, companyVars, money);
  const amountVars: Record<string, string> = { ...Object.fromEntries(companyVars.map((v) => [v.key, v.value])), ...docVars.formatted };
  const customFieldText = (f: NonNullable<typeof invoice.customFields>[number]) =>
    displayCustomField(f, docVars.numbers, money, (v) => v.replace(/\{([a-z0-9_]+)\}/g, (m, k: string) => amountVars[k] ?? m));

  // Net proceeds after provider fees and conversion, in the home currency at the invoice's rate.
  const home = homeCurrencyOf(homeCountry);
  const rate = invoice.currency === home ? 1 : Number(invoice.exchangeRate) || 0;
  const quote = rate > 0 && invoice.currency !== home ? rateQuote(rate, invoice.currency, home) : null;
  const fx = fxLabelOf(invoice);
  const received = invoice.status === 'paid' ? totals.totalWithVat : Number(invoice.amountPaid ?? 0);
  const fees = Number(invoice.paymentFees ?? 0);
  const receivedCzk = invoice.receivedCzk == null ? null : Number(invoice.receivedCzk);
  const showNet = received > 0 && rate > 0 && (fees > 0 || receivedCzk != null || invoice.currency !== home);
  const czk = (n: number) => formatMoney(n, home, locale);
  const grossCzk = received * rate;
  const expectedCzk = (received - fees) * rate;
  const netCzk = receivedCzk ?? expectedCzk;
  const fxDiff = receivedCzk == null ? null : receivedCzk - expectedCzk;

  const facts: [string, string | null][] = [
    [t('fields.issueDate'), formatDate(invoice.issueDate, locale)],
    [t('fields.taxableSupplyDate'), formatDate(invoice.taxableSupplyDate ?? invoice.issueDate, locale)],
    [t('fields.dueDate'), formatDate(invoice.dueDate, locale)],
    [t('fields.paymentMethod'), invoice.paymentMethodLabel || t(`payment.${invoice.paymentMethod}`)],
    [t('fields.variableSymbol'), invoice.variableSymbol],
    [t('fields.constantSymbol'), invoice.constantSymbol],
    [t('fields.specificSymbol'), invoice.specificSymbol],
    [t('fields.orderNumber'), invoice.orderNumber],
    [t('fields.paidAt'), formatDate(invoice.paidAt, locale)],
    [t('fields.sentAt'), formatDate(invoice.sentAt, locale)]
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/invoices" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span title={tGloss(`type.${invoice.documentType}`)} className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', TYPE_BADGE_CLASSES[invoice.documentType])}>
              {t(`type.${invoice.documentType}`)}
            </span>
            <span title={tGloss(`status.${status}`)} className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_BADGE_CLASSES[status])}>{statusLabel}</span>
            {invoice.source === 'profile_order' && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{tProfileOrder('badge')}</span>
            )}
            {buyerDetailsState(invoice) && (
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', buyerDetailsState(invoice) === 'waiting' ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success')}>
                {tBuyer(`badge.${buyerDetailsState(invoice)}`)}
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{title}</h1>
          {contact && <p className="mt-1 text-muted-foreground">{contact.legalName}</p>}
        </div>
        <div className="sm:text-right">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('totalDue')}</div>
          <div className="text-3xl font-extrabold tabular-nums">{money(totals.totalWithVat)}</div>
          {invoice.status === 'issued' && Number(invoice.amountPaid ?? 0) > 0 && (
            <div className="mt-1 text-sm">
              <span className="font-semibold text-success">{t('partial.paid', { amount: money(Number(invoice.amountPaid)) })}</span>
              <span className="text-muted-foreground"> · {t('partial.remaining', { amount: money(Math.max(0, totals.totalWithVat - Number(invoice.amountPaid))) })}</span>
            </div>
          )}
          {home === 'CZK' && invoice.documentType !== 'credit_note' && totals.totalWithoutVat > 0 && <NetEstimate base={totals.totalWithoutVat} currency={invoice.currency} czkRate={rate} />}
        </div>
      </div>

      <div className="mt-5">
        <InvoiceActions
          id={invoice.id}
          documentType={invoice.documentType}
          status={invoice.status}
          numbered={Boolean(invoice.invoiceNumber)}
          hasEmail={Boolean(contact?.email)}
          publicLink={detail.links?.public ?? invoice.publicToken}
          defaultTemplateName={contact ? `${contact.legalName}` : title}
          overdue={invoice.isOverdue}
          reminderCount={invoice.reminderCount}
          total={totals.totalWithVat}
          amountPaid={Number(invoice.amountPaid ?? 0)}
          currency={invoice.currency}
          home={home}
          sentAt={invoice.sentAt}
          editedAfterSend={editedAfterSend}
        />
        {invoice.invoiceNumber && detail.links?.public && (
          <PublicLinkPanel
            id={invoice.id}
            link={detail.links.public}
            defaultLink={detail.links.publicDefault ?? detail.links.public}
            slug={invoice.publicSlug ?? null}
          />
        )}
        {canEdit && (invoice.status === 'draft' || invoice.status === 'pending_review') && invoice.documentType !== 'credit_note' && (
          <BuyerDetailsRequest
            id={invoice.id}
            token={invoice.buyerDetailsToken ? (detail.links?.buyerDetails ?? invoice.buyerDetailsToken) : null}
            submittedAt={invoice.buyerDetailsSubmittedAt ?? null}
            submittedLabel={formatDate(invoice.buyerDetailsSubmittedAt, locale)}
            email={invoice.buyerDetailsEmail ?? null}
            autoIssue={Boolean(invoice.buyerDetailsAutoIssue)}
            outcome={invoice.buyerDetailsOutcome ?? null}
            contactEmail={contact?.email ?? null}
            required={invoice.buyerDetailsRequired ?? defaultRequired}
            defaultRequired={defaultRequired}
            hideStart={customerMissing}
          />
        )}
      </div>

      {invoice.source === 'profile_order' && invoice.status === 'pending_review' && (
        <Banner tone="info" className="mt-4">
          {tProfileOrder('banner')}
        </Banner>
      )}
      {invoice.source.startsWith('ai_') && invoice.status === 'pending_review' && (
        <Banner tone="warn" className="mt-4">
          {t('aiDisclaimer')}
        </Banner>
      )}
      {lawIssues.length > 0 && (
        <Banner
          tone={lawIssues.some((i) => i.severity === 'error') ? 'warn' : 'info'}
          title={t(invoice.invoiceNumber ? 'requirements.titleIssued' : 'requirements.title')}
          className="mt-4"
        >
          <ul className="list-disc space-y-0.5 pl-5">
            {lawIssues.map((i) => (
              <li key={`${i.rule}-${i.field}-${i.code}`}>
                {t(`peppol.field.${i.field}`)}: {t(`requirements.code.${i.code}`)} <LawRef rule={i.rule} />
              </li>
            ))}
          </ul>
          {canEdit && customerMissing && (
            <BuyerDetailsRequest
              variant="inline"
              id={invoice.id}
              token={null}
              submittedAt={null}
              submittedLabel={null}
              email={null}
              autoIssue={false}
              outcome={null}
              contactEmail={null}
              required={defaultRequired}
              defaultRequired={defaultRequired}
            />
          )}
        </Banner>
      )}
      {peppolIssues.length > 0 && (
        <Banner tone={peppolIssues.some((i) => i.severity === 'error') ? 'warn' : 'info'} title={t('peppol.title')} className="mt-4">
          <p>{t('peppol.intro')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {peppolIssues.map((i) => (
              <li key={`${i.rule}-${i.field}-${i.code}`}>
                {t(`peppol.field.${i.field}`)}: {t(`peppol.code.${i.code}`)} <span className="font-mono text-xs opacity-70">{i.rule}</span>
              </li>
            ))}
          </ul>
        </Banner>
      )}
      {invoice.isOverdue && (
        <Banner tone="err" className="mt-4">
          {t('overdueBanner', { date: formatDate(invoice.dueDate, locale) ?? '' })}
          {invoice.reminderCount > 0 && (
            <span className="block text-xs opacity-80">
              {t('remindersSent', { count: invoice.reminderCount, date: formatDate(invoice.lastReminderSentAt, locale) ?? '' })}
            </span>
          )}
        </Banner>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="min-w-0 rounded-xl border border-border bg-card p-4 lg:col-span-2">
          {invoice.noteAbove && <p className="mb-4 whitespace-pre-line text-sm text-muted-foreground">{invoice.noteAbove}</p>}
          {/* Phones: one block per item instead of a table that scrolls sideways. */}
          <ul className="divide-y divide-border/60 text-sm sm:hidden">
            {items.map((item) => (
              <li key={item.id} className="py-2.5 first:pt-0">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">{item.description}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{money(item.lineTotalWithoutVat)}</span>
                </div>
                <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {Number(item.quantity).toLocaleString(locale)} {item.unit ?? ''} × {money(Number(item.unitPrice))}
                  {Number(item.discountPercent) ? ` · ${t('items.discount')} ${Number(item.discountPercent)} %` : ''}
                  {item.vatRate === null ? '' : ` · ${t('items.vat')} ${Number(item.vatRate)} %`}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">{t('items.description')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('items.quantity')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('items.unitPrice')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('items.discount')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('items.vat')}</th>
                  <th className="py-2 pl-2 text-right font-medium">{t('items.total')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-border/60 last:border-b-0">
                    <td className="py-2.5 pr-2">{item.description}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {Number(item.quantity).toLocaleString(locale)} {item.unit ?? ''}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{money(Number(item.unitPrice))}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                      {Number(item.discountPercent) ? `${Number(item.discountPercent)} %` : '–'}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                      {item.vatRate === null ? '–' : `${Number(item.vatRate)} %`}
                    </td>
                    <td className="py-2.5 pl-2 text-right font-semibold tabular-nums">{money(item.lineTotalWithoutVat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-xs space-y-1 text-sm">
              {totals.byRate.map((r) => (
                <div key={r.vatRatePercent} className="flex justify-between text-muted-foreground">
                  <dt>{t('vatAt', { rate: r.vatRatePercent })}</dt>
                  <dd className="tabular-nums">
                    {money(r.totalWithoutVat)} + {money(r.vatAmount)}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-1">
                <dt>{t('withoutVat')}</dt>
                <dd className="tabular-nums">{money(totals.totalWithoutVat)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('vatTotal')}</dt>
                <dd className="tabular-nums">{money(totals.totalVat)}</dd>
              </div>
              <div className="flex justify-between text-base font-extrabold">
                <dt>{t('totalDue')}</dt>
                <dd className="tabular-nums">{money(totals.totalWithVat)}</dd>
              </div>
            </dl>
          </div>
          {quote && (
            <p className="mt-3 text-right text-xs text-muted-foreground">
              {fx.kind === 'hidden'
                ? t('fxHidden', {
                    rate: quote.value.toLocaleString(locale, { maximumFractionDigits: 4 }),
                    pair: quote.pair,
                    home
                  })
                : t('fxLine', {
                    label:
                      fx.kind === 'on'
                        ? t('fxLabelOn', { date: formatDate(fx.date, locale) ?? fx.date })
                        : fx.kind === 'ecb'
                          ? t('fxLabelEcbOn', { date: formatDate(fx.date, locale) ?? fx.date })
                          : fx.kind === 'annual'
                          ? t('fxLabelAnnual', { year: fx.year })
                          : fx.kind === 'manual'
                            ? t('fxLabelManual')
                            : t('fxLabel'),
                    rate: quote.value.toLocaleString(locale, { maximumFractionDigits: 4 }),
                    pair: quote.pair,
                    vat: formatMoney(totals.totalVat * rate, home, locale),
                    total: formatMoney(totals.totalWithVat * rate, home, locale)
                  })}
            </p>
          )}
          {invoice.reverseCharge && <p className="mt-3 text-xs text-muted-foreground">{t('reverseChargeNote')}</p>}
          {invoice.noteBelow && <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{invoice.noteBelow}</p>}
        </section>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Building2 className="h-4 w-4 text-primary" />
              {t('customer')}
            </h2>
            {contact && buyer ? (
              <div className="mt-2 text-sm">
                <Link href={`/contacts/${contact.id}`} className="font-semibold text-primary hover:underline">
                  {buyer.legalName}
                </Link>
                <div className="mt-1 text-muted-foreground">
                  {[buyer.addressStreet, [buyer.addressPostalCode, buyer.addressCity].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', ')}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {buyer.ico && <>IČO {buyer.ico}</>} {buyer.dic && <>· DIČ {buyer.dic}</>}
                </div>
                {buyer.email && <div className="mt-1 text-xs text-muted-foreground">{buyer.email}</div>}
                {detail.snapshot?.buyerDiffers && <p className="mt-2 text-xs text-muted-foreground">{t('buyerSnapshotNote')}</p>}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t('noCustomer')}</p>
            )}
            {detail.snapshot?.sellerDiffers && <p className="mt-2 text-xs text-muted-foreground">{t('sellerSnapshotNote')}</p>}
          </section>

          {showNet && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Wallet className="h-4 w-4 text-primary" />
                {t('net.title')}
              </h2>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t('net.gross')}</dt>
                  <dd className="tabular-nums">{czk(grossCzk)}</dd>
                </div>
                {fees > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('net.fees')}</dt>
                    <dd className="text-right tabular-nums text-destructive">
                      −{czk(fees * rate)}
                      {invoice.currency !== home && <span className="block text-xs text-muted-foreground">{money(fees)}</span>}
                    </dd>
                  </div>
                )}
                {fxDiff != null && Math.abs(fxDiff) >= 0.01 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('net.fx')}</dt>
                    <dd className={cn('tabular-nums', fxDiff < 0 ? 'text-destructive' : 'text-success')}>
                      {fxDiff > 0 ? '+' : '−'}
                      {czk(Math.abs(fxDiff))}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-bold">
                  <dt>{t('net.net')}</dt>
                  <dd className="tabular-nums">
                    {czk(netCzk)}
                    {grossCzk > 0 && (
                      <span className="ml-1 text-xs font-medium text-muted-foreground">
                        ({((netCzk / grossCzk) * 100).toLocaleString(locale, { maximumFractionDigits: 1 })} %)
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              {receivedCzk == null && invoice.currency !== home && <p className="mt-2 text-xs text-muted-foreground">{t('net.noReceived', { home })}</p>}
            </section>
          )}

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <FileText className="h-4 w-4 text-primary" />
              {t('details')}
            </h2>
            <dl className="mt-2 space-y-1.5 text-sm">
              {facts
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              {(invoice.customFields ?? []).map((f, i) => (
                <div key={`cf-${i}`} className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    {f.internal && <Lock className="h-3 w-3 text-warning" aria-label={t('internalField')} />}
                    {f.label}
                  </dt>
                  <dd className="text-right font-medium tabular-nums">{customFieldText(f)}</dd>
                </div>
              ))}
            </dl>
          </section>

          {attachments && (
            <AttachmentsPanel
              invoiceId={invoice.id}
              initial={attachments}
              portal={Boolean(invoice.publicToken) && invoice.status !== 'draft' && invoice.status !== 'pending_review'}
            />
          )}

          {invoice.documentType === 'quote' && invoice.status !== 'draft' && invoice.status !== 'pending_review' && (
            <section
              className={cn(
                'rounded-xl border p-4',
                invoice.clientResponse === 'accepted'
                  ? 'border-success/40 bg-success/5'
                  : invoice.clientResponse === 'rejected'
                    ? 'border-destructive/30 bg-destructive/5'
                    : 'border-border bg-card'
              )}
            >
              <h2 className="flex items-center gap-2 text-sm font-bold">
                {invoice.clientResponse === 'rejected' ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle2 className={cn('h-4 w-4', invoice.clientResponse ? 'text-success' : 'text-muted-foreground')} />
                )}
                {t('quoteResponse.title')}
              </h2>
              {invoice.clientResponse ? (
                <div className="mt-2 space-y-1 text-sm">
                  <p className="font-medium">
                    {t(invoice.clientResponse === 'accepted' ? 'quoteResponse.accepted' : 'quoteResponse.rejected')}
                  </p>
                  <p className="text-muted-foreground">
                    {invoice.clientResponseName ?? '–'}
                    {invoice.clientRespondedAt
                      ? ` · ${new Date(invoice.clientRespondedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}`
                      : ''}
                  </p>
                  {invoice.clientResponseNote && (
                    <p className="whitespace-pre-line rounded-md bg-background/60 p-2">{invoice.clientResponseNote}</p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{t('quoteResponse.waiting')}</p>
              )}
            </section>
          )}

          {invoice.status !== 'draft' && invoice.status !== 'pending_review' && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Eye className="h-4 w-4 text-primary" />
                {t('views.title')}
              </h2>
              {invoice.publicViewCount > 0 ? (
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('views.count')}</dt>
                    <dd className="font-medium tabular-nums">{t('views.times', { count: invoice.publicViewCount })}</dd>
                  </div>
                  {[
                    [t('views.first'), invoice.publicFirstViewedAt],
                    [t('views.last'), invoice.publicLastViewedAt]
                  ].map(([label, at]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="text-right font-medium tabular-nums">
                        {at ? new Date(at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '–'}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{t('views.none')}</p>
              )}
            </section>
          )}

          {(parent || children.length > 0) && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Link2 className="h-4 w-4 text-primary" />
                {t('related')}
              </h2>
              <ul className="mt-2 space-y-1.5 text-sm">
                {[...(parent ? [parent] : []), ...children].map((doc) => (
                  <li key={doc.id}>
                    <Link href={`/invoices/${doc.id}`} className="flex justify-between gap-2 hover:text-primary">
                      <span>
                        {t(`type.${doc.documentType}`)} {doc.invoiceNumber ?? t('unnumbered')}
                      </span>
                      <span className="text-muted-foreground">{tStatus(doc.status)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {invoice.internalNote && (
            <section className="rounded-xl border border-warning/40 bg-warning/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <AlertTriangle className="h-4 w-4 text-warning" />
                {t('fields.internalNote')}
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm">{invoice.internalNote}</p>
            </section>
          )}
        </aside>
      </div>

      {/* Historie změn of this document: who issued, edited (with the reason), sent, paid it. */}
      {history && history.items.length > 0 && (
        // Collapsed by default: there when you look for it, not in the way.
        <details className="group mt-6 rounded-xl border border-border bg-card p-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
            <History className="h-4 w-4 text-primary" />
            {t('history')}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {history.hasMore ? `${history.items.length}+` : history.items.length}
            </span>
            <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3">
            <AuditLogList initial={history} entityType="invoice" entityId={invoice.id} compact />
          </div>
        </details>
      )}
    </div>
  );
}
