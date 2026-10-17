'use client';

import { useState } from 'react';
import { ChevronDown, Copy, FileClock, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Typeahead, type TypeaheadGroup } from '@/components/typeahead';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { searchInvoicesToCopy, type InvoiceToCopy } from './actions';

/**
 * "Předvyplnit podle faktury": start the new invoice from the latest one or
 * from any other. Both go through the "Duplikovat" flow
 * (`?from=<id>&similar=1`, see page.tsx): customer, items, currency,
 * payment, account, language, notes and custom fields are copied; number,
 * dates, status and payments never are, and the due date follows the
 * company's default term.
 */
export function CopyFromInvoice() {
  const t = useTranslations('invoiceForm.copy');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  const start = (from: string) => router.push(`/invoices/new?from=${from}&similar=1`);
  const fetchGroups = async (q: string): Promise<TypeaheadGroup<InvoiceToCopy>[]> => [{ items: await searchInvoicesToCopy(q) }];
  const money = (row: InvoiceToCopy) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: row.currency }).format(Number(row.total));
    } catch {
      return `${row.total} ${row.currency}`;
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left" aria-expanded={open}>
        <Copy className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-bold">{t('title')}</h2>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <p className="mt-1 text-xs text-muted-foreground">{t('hint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => start('latest')}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary"
            >
              <FileClock className="h-4 w-4" aria-hidden="true" />
              {t('latest')}
            </button>
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              aria-expanded={picking}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-secondary"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              {t('other')}
            </button>
          </div>
          {picking && (
            <Typeahead<InvoiceToCopy>
              className="mt-3"
              value={query}
              onChange={setQuery}
              onPick={(row) => start(row.id)}
              fetchGroups={fetchGroups}
              getKey={(row) => row.id}
              ariaLabel={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
              emptyHint={t('searchEmpty')}
              renderItem={(row) => (
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{row.invoiceNumber ?? t('draft')}</span>
                    {row.contactName && <span className="text-muted-foreground"> · {row.contactName}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {row.issueDate ? new Date(row.issueDate).toLocaleDateString(locale) : ''} {money(row)}
                  </span>
                </span>
              )}
            />
          )}
        </>
      )}
    </section>
  );
}
