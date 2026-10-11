import { CheckCircle2, FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Purely decorative, static invoice mockup for the marketing homepage hero.
 * Not real user data — a fixed, plausibly-shaped Czech B2B invoice example
 * (company names/IČOs echo the ones already used as placeholder data in
 * `(dashboard)/invoices/page.tsx` and the signup form, for continuity) that
 * mirrors the real dashboard's visual language (rounded card, `border`,
 * status-badge pill, `tabular-nums` amounts) so the hero actually looks
 * like the product instead of a generic illustration.
 *
 * The chrome labels (status/field names) are translated since they're
 * short and easy to localize; the invoice content itself (names, line
 * items, amounts) is intentionally a single fixed Czech example across all
 * locales, the same way a product screenshot would be.
 */
export async function MarketingInvoiceMockup() {
  const t = await getTranslations('marketing.invoiceMockup');

  const lineItems = [
    { description: 'Konzultace – implementace fakturačního procesu', amount: '8 000 Kč' },
    { description: 'Export ISDOC a napojení na ARES', amount: '4 000 Kč' }
  ];

  return (
    <div className="relative">
      {/* Second card peeking out behind the main one, for a little depth —
          hidden on narrow screens where there's no room for the offset. */}
      <div
        aria-hidden="true"
        className="absolute -bottom-4 -right-4 hidden h-full w-full rounded-2xl border border-border bg-card/60 sm:block"
      />

      <div className="relative rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="font-display text-lg font-semibold text-card-foreground">Novák Consulting s.r.o.</p>
            <p className="text-xs text-muted-foreground">IČO 27604977 · DIČ CZ27604977</p>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
            {t('status')}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('issuedTo')}</p>
            <p className="mt-0.5 font-medium text-card-foreground">Dvořák &amp; Partners s.r.o.</p>
            <p className="text-xs text-muted-foreground">IČO 25596641</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{t('dueDate')}</p>
            <p className="mt-0.5 font-medium tabular-nums text-card-foreground">24. 9. 2026</p>
            <p className="font-mono text-xs text-muted-foreground">2026-0004</p>
          </div>
        </div>

        <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
          {lineItems.map((item) => (
            <div key={item.description} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{item.description}</span>
              <span className="shrink-0 tabular-nums text-card-foreground">{item.amount}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-1 border-t border-border pt-4 text-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{t('subtotal')}</span>
            <span className="tabular-nums">12 000 Kč</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{t('vat')}</span>
            <span className="tabular-nums">2 520 Kč</span>
          </div>
          <div className="flex items-center justify-between pt-1 text-base font-semibold text-card-foreground">
            <span>{t('total')}</span>
            <span className="tabular-nums">14 520 Kč</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            {t('isdocTag')}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('aresTag')}
          </span>
        </div>
      </div>
    </div>
  );
}
