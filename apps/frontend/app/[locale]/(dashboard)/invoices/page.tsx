import { Fragment } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';

type InvoiceStatus = 'draft' | 'pending_review' | 'issued' | 'paid' | 'cancelled';

// Mirrors the `invoices.source` enum from blueprint §4 — 'ai_telegram' and
// 'ai_whatsapp' both need the AI-draft disclaimer treatment below.
type InvoiceSource = 'manual' | 'ai_telegram' | 'ai_whatsapp' | 'api';

interface InvoiceListItem {
  id: string;
  /** Sequential invoice number — null until issued. Per blueprint §6, a
   *  number is only ever allocated at issue time, never on draft creation. */
  number: string | null;
  contactName: string;
  contactIco: string;
  amountMinor: number;
  currency: 'CZK' | 'EUR';
  status: InvoiceStatus;
  dueDate: string;
  source: InvoiceSource;
}

/**
 * PLACEHOLDER DATA — TODO: replace this in-file array with a real fetch to
 * the backend's `GET /api/v1/invoices` REST endpoint (blueprint §2/§3)
 * once the NestJS backend, Auth.js session, and tenant context exist.
 * Field shapes follow the `invoices`/`contacts` tables in blueprint §4.
 * Company names and IČOs below are fictional, plausibly-shaped examples
 * only — not real businesses.
 */
const MOCK_INVOICES: InvoiceListItem[] = [
  {
    id: '1',
    number: '2026-0001',
    contactName: 'Novák Consulting s.r.o.',
    contactIco: '27604977',
    amountMinor: 2420000,
    currency: 'CZK',
    status: 'paid',
    dueDate: '2026-08-15',
    source: 'manual'
  },
  {
    id: '2',
    number: '2026-0002',
    contactName: 'Dvořák & Partners s.r.o.',
    contactIco: '25596641',
    amountMinor: 847000,
    currency: 'CZK',
    status: 'issued',
    dueDate: '2026-09-20',
    source: 'manual'
  },
  {
    id: '3',
    number: null,
    contactName: 'Horák Stavby s.r.o.',
    contactIco: '03476217',
    amountMinor: 1560000,
    currency: 'CZK',
    status: 'pending_review',
    dueDate: '2026-09-25',
    source: 'ai_telegram'
  },
  {
    id: '4',
    number: null,
    contactName: 'Veselá Grafika s.r.o.',
    contactIco: '08942315',
    amountMinor: 530000,
    currency: 'CZK',
    status: 'pending_review',
    dueDate: '2026-09-30',
    source: 'ai_whatsapp'
  },
  {
    id: '5',
    number: '2026-0003',
    contactName: 'Krejčí IT služby s.r.o.',
    contactIco: '29135790',
    amountMinor: 4200000,
    currency: 'CZK',
    status: 'draft',
    dueDate: '2026-10-05',
    source: 'manual'
  },
  {
    id: '6',
    number: '2025-0098',
    contactName: 'Malá Kancelář s.r.o.',
    contactIco: '24213658',
    amountMinor: 312000,
    currency: 'CZK',
    status: 'cancelled',
    dueDate: '2026-01-10',
    source: 'manual'
  }
];

const STATUS_BADGE_CLASSES: Record<InvoiceStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_review: 'bg-warning/15 text-warning',
  issued: 'bg-accent text-accent-foreground',
  paid: 'bg-success/15 text-success',
  cancelled: 'bg-destructive/10 text-destructive'
};

/** An AI-sourced draft still awaiting human review — the case that must
 *  surface the liability disclaimer from blueprint §9. */
function isAiPendingReview(invoice: InvoiceListItem): boolean {
  return invoice.source.startsWith('ai_') && invoice.status === 'pending_review';
}

export default async function InvoicesPage() {
  const t = await getTranslations('invoices');
  const tStatus = await getTranslations('invoices.status');
  const locale = await getLocale();

  const currencyFormatters = new Map<string, Intl.NumberFormat>();
  const formatAmount = (amountMinor: number, currency: string) => {
    let formatter = currencyFormatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
      currencyFormatters.set(currency, formatter);
    }
    return formatter.format(amountMinor / 100);
  };

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t('columns.number')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.contact')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.amount')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.status')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.dueDate')}</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_INVOICES.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            )}

            {MOCK_INVOICES.map((invoice) => (
              <Fragment key={invoice.id}>
                <tr className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {invoice.number ?? t('unnumbered')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{invoice.contactName}</div>
                    <div className="text-xs text-muted-foreground">IČO {invoice.contactIco}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatAmount(invoice.amountMinor, invoice.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        STATUS_BADGE_CLASSES[invoice.status]
                      )}
                    >
                      {tStatus(invoice.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {dateFormatter.format(new Date(invoice.dueDate))}
                  </td>
                </tr>

                {/* AI-draft liability disclaimer — blueprint §9: any invoice
                    with source ai_telegram|ai_whatsapp and
                    status = pending_review must show a persistent,
                    unmissable banner before the human reviews/issues it. */}
                {isAiPendingReview(invoice) && (
                  <tr className="border-b border-border last:border-b-0 bg-warning/10">
                    <td colSpan={5} className="px-4 py-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-warning">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>{t('aiDisclaimer')}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
