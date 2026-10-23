import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft, Building2, ExternalLink, Receipt } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { apiFetch, ApiError, NotSignedInError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { EXPENSE_STATE_CLASSES, expenseState, isKnownCategory, vatOfGross, type Expense } from '@/lib/expense-ui';
import { cn } from '@/lib/utils';
import { isReverseChargeCode } from '@faktur/cz-compliance';
import { ExpenseActions } from './expense-actions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ContactRow {
  id: string;
  legalName: string;
  ico: string | null;
  dic: string | null;
  email: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('expenses.detail');
  return { title: t('title') };
}

export default async function ExpenseDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID.test(params.id)) notFound();
  const locale = await getLocale();
  const t = await getTranslations('expenses.detail');
  const tForm = await getTranslations('expenses.form');
  const tCat = await getTranslations('expenses.category');
  const tState = await getTranslations('expenses.state');
  // Code names are shared with the invoice form.
  const tRc = await getTranslations('invoiceForm.settings');

  let expense: Expense;
  try {
    expense = await apiFetch<Expense>(`/api/v1/expenses/${params.id}`);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <Banner tone="err" title={t('loadError')} className="mt-6">
        <span className="font-mono text-xs">{String(error instanceof Error ? error.message : error)}</span>
      </Banner>
    );
  }

  const contact = expense.supplierContactId
    ? ((await apiFetch<ContactRow[]>(`/api/v1/contacts/${expense.supplierContactId}`).catch(() => []))[0] ?? null)
    : null;

  const amount = Number(expense.amount);
  const rate = Number(expense.vatRate);
  // Reverse charge: the amount is the net and the self-assessed VAT comes on top (as in the form).
  const reverseCharge = expense.reverseCharge && rate > 0;
  const vat = reverseCharge ? Math.round(amount * rate) / 100 : vatOfGross(amount, rate);
  const base = reverseCharge ? amount : amount - vat;
  const money = (n: number) => formatMoney(n, expense.currency, locale);
  const state = expenseState(expense);
  const supplierName = contact?.legalName ?? expense.supplierNameRaw ?? t('unknownSupplier');

  const facts: [string, string | null][] = [
    [tForm('expenseDateLabel'), formatDate(expense.expenseDate, locale)],
    [tForm('dueDateLabel'), formatDate(expense.dueDate, locale)],
    [t('paidAt'), formatDate(expense.paidAt, locale)],
    [tForm('documentNumberLabel'), expense.documentNumber],
    [tForm('variableSymbolLabel'), expense.variableSymbol],
    [tForm('categoryLabel'), expense.category ? (isKnownCategory(expense.category) ? tCat(expense.category) : expense.category) : null],
    [
      tRc('reverseChargeCode'),
      reverseCharge && isReverseChargeCode(expense.reverseChargeCode)
        ? `${expense.reverseChargeCode} – ${tRc(`reverseChargeCodes.${expense.reverseChargeCode}`)}`
        : null
    ],
    [t('createdAt'), formatDate(expense.createdAt, locale)]
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/expenses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        {t('backToList')}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {/* The badge plus the red due date is the single overdue signal;
              a banner repeated it, and "mark paid" sits right below anyway. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', EXPENSE_STATE_CLASSES[state])}>{tState(state)}</span>
            {state === 'overdue' && expense.dueDate && (
              <span className="text-xs font-semibold text-destructive">
                {tForm('dueDateLabel')} {formatDate(expense.dueDate, locale)}
              </span>
            )}
          </div>
          <h1 className="mt-2 break-words text-2xl font-extrabold tracking-tight">{expense.description}</h1>
          <p className="mt-1 text-muted-foreground">
            {supplierName}
            {expense.documentNumber && <> · {expense.documentNumber}</>}
          </p>
        </div>
        <div className="sm:text-right">
          <div className="text-xs text-muted-foreground">{reverseCharge ? tForm('amountLabelReverseCharge') : t('total')}</div>
          <div className="text-3xl font-extrabold tabular-nums">{money(amount)}</div>
        </div>
      </div>

      <div className="mt-5">
        <ExpenseActions id={expense.id} paid={Boolean(expense.paidAt)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          {/* Without VAT the header total says it all. */}
          {rate > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Receipt className="h-4 w-4 text-primary" />
                {t('amounts')}
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <div className="min-w-0 rounded-lg bg-muted/60 p-3">
                  <dt className="text-xs text-muted-foreground">{t('base')}</dt>
                  <dd className="mt-1 truncate text-lg font-bold tabular-nums">{money(base)}</dd>
                </div>
                <div className="min-w-0 rounded-lg bg-muted/60 p-3">
                  <dt className="text-xs text-muted-foreground">{t('vat', { rate })}</dt>
                  <dd className="mt-1 truncate text-lg font-bold tabular-nums">{money(vat)}</dd>
                </div>
              </dl>
              {reverseCharge && <p className="mt-2 text-xs text-muted-foreground">{tForm('reverseChargeLabel')}</p>}
            </div>
          )}

          {expense.note && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-bold">{tForm('noteLabel')}</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{expense.note}</p>
            </div>
          )}

          {expense.receiptFileUrl && (
            <a
              // Free text from a teammate: only http(s) links, never `javascript:` etc.
              href={/^https?:\/\//i.test(expense.receiptFileUrl) ? expense.receiptFileUrl : `https://${expense.receiptFileUrl}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm font-semibold text-primary hover:bg-accent"
            >
              <ExternalLink className="h-4 w-4" />
              {t('openReceipt')}
            </a>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Building2 className="h-4 w-4 text-primary" />
              {t('supplier')}
            </h2>
            <div className="mt-2 text-sm">
              {contact ? (
                <Link href={`/contacts/${contact.id}`} className="font-semibold text-primary hover:underline">
                  {contact.legalName}
                </Link>
              ) : (
                <span className="font-semibold">{supplierName}</span>
              )}
              {contact && (
                <div className="mt-1 text-muted-foreground">
                  {[contact.addressStreet, [contact.addressPostalCode, contact.addressCity].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', ')}
                </div>
              )}
              {(expense.supplierIco ?? contact?.ico ?? expense.supplierDic ?? contact?.dic) && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {[
                    (expense.supplierIco ?? contact?.ico) && `IČO ${expense.supplierIco ?? contact?.ico}`,
                    (expense.supplierDic ?? contact?.dic) && `DIČ ${expense.supplierDic ?? contact?.dic}`
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-bold">{t('details')}</h2>
            <dl className="mt-2 space-y-1.5 text-sm">
              {facts
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
                  </div>
                ))}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
