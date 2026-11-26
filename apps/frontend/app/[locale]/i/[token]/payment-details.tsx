'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/utils';

export interface PaymentDetailRow {
  label: string;
  /** What the payer reads. */
  value: string;
  /** What goes to the clipboard when it differs from `value` (an amount without the currency); omit to copy `value`, null for no copy button. */
  copy?: string | null;
  strong?: boolean;
}

/**
 * Account, IBAN, variable symbol and amount, one per row with a copy
 * button: payers on a phone type these into their bank app by hand when the
 * QR code is on the same screen they would have to scan it with.
 */
export function PaymentDetails({ rows, className }: { rows: PaymentDetailRow[]; className?: string }) {
  const t = useTranslations('publicInvoice.pay');
  const [copied, setCopied] = useState<number | null>(null);

  return (
    <dl className={cn('divide-y divide-border rounded-lg border border-border bg-background text-sm', className)}>
      {rows.map((row, i) => {
        const text = row.copy === undefined ? row.value : row.copy;
        return (
          <div key={row.label} className="flex items-center gap-3 py-1 pl-3 pr-1">
            <div className="min-w-0 flex-1">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className={cn('break-all tabular-nums', row.strong && 'font-semibold')}>{row.value}</dd>
            </div>
            {text != null && (
              <button
                type="button"
                onClick={() =>
                  copyText(text).then(
                    () => {
                      setCopied(i);
                      setTimeout(() => setCopied((c) => (c === i ? null : c)), 2000);
                    },
                    () => setCopied(null)
                  )
                }
                className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-primary print:hidden"
                aria-label={t('copyLabel', { label: row.label })}
              >
                {copied === i ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                <span aria-live="polite">{copied === i ? t('copied') : t('copy')}</span>
              </button>
            )}
          </div>
        );
      })}
    </dl>
  );
}
