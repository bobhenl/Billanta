import { CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getBuyerDetailsView } from '@/lib/public-buyer-details';
import { NOINDEX } from '@/lib/seo';
import { BuyerDetailsForm } from './buyer-details-form';

// A private link for one customer: never indexed, never followed, no referrer.
export const metadata: Metadata = { robots: NOINDEX, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

/**
 * "Odběratel si doplní údaje sám": the customer opens the link from the
 * supplier, checks the draft (supplier, items, amount; read-only) and fills
 * in their own billing details. No session; the backend only answers while
 * the document is a draft with an open request.
 */
export default async function BuyerDetailsPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).pop() ?? h.get('x-real-ip') ?? '';
  const view = await getBuyerDetailsView(token, ip);
  if (!view) notFound();

  const t = await getTranslations('buyerDetails');
  const tApp = await getTranslations('app');
  const locale = await getLocale();
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: view.currency });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' });
  const s = view.supplier;
  const docKey = view.documentType === 'quote' ? 'quote' : view.documentType === 'proforma' ? 'proforma' : 'invoice';

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <p className="mb-8 text-center text-sm font-medium text-muted-foreground">{tApp('name')}</p>
      <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('intro', { supplier: s.name, document: t(`documentType.${docKey}`) })}</p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('supplier')}</h2>
            <p className="mt-2 text-sm font-medium">{s.name}</p>
            <p className="text-sm text-muted-foreground">
              {[s.street, [s.postalCode, s.city].filter(Boolean).join(' '), s.country].filter(Boolean).join(', ')}
            </p>
            {(s.ico || s.dic) && (
              <p className="text-sm text-muted-foreground">{[s.ico && `${t('ico')} ${s.ico}`, s.dic && `${t('dic')} ${s.dic}`].filter(Boolean).join(' · ')}</p>
            )}
          </section>
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('amount')}</h2>
            <p className="mt-2 text-2xl font-semibold">{money.format(view.totals.total)}</p>
            {view.totals.vat > 0 && (
              <p className="text-sm text-muted-foreground">{t('withoutVat', { amount: money.format(view.totals.withoutVat) })}</p>
            )}
            {view.dueDate && <p className="text-sm text-muted-foreground">{t('dueDate', { date: date.format(new Date(view.dueDate)) })}</p>}
          </section>
        </div>

        {view.items.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t('item')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('quantity')}</th>
                  <th className="py-2 text-right font-medium">{t('total')}</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((item, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">{item.description}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-muted-foreground">
                      {item.quantity} {item.unit ?? ''}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right">{money.format(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view.submitted ? (
          <div className="mt-8 flex items-start gap-3 rounded-lg border border-success/40 bg-success/5 p-5">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div className="text-sm">
              <p className="font-semibold">{t('doneTitle')}</p>
              <p className="mt-1 text-muted-foreground">{t('doneText', { supplier: s.name })}</p>
            </div>
          </div>
        ) : (
          <BuyerDetailsForm token={token} supplierName={s.name} prefill={view.prefill} />
        )}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">{t('privacy', { supplier: s.name })}</p>
    </div>
  );
}
