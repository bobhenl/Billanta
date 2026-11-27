'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from '@/components/toaster';
import type { Shares, TaxPartner } from '@/lib/net-income';
import { SharesPicker } from '../../reports/net-income/shares-picker';
import { setInvoicePartnerShares } from '../../reports/net-income/actions';

/**
 * Who this invoice belongs to in "Po zdanění": the same M / R / D tags as the
 * report, saved through the same endpoint. Owners, admins and linked partners see it,
 * like the report; it changes only with the invoice permission (readOnly otherwise).
 */
export function PartnerSplit({
  id,
  number,
  partners,
  initial,
  readOnly = false
}: {
  id: string;
  number: string;
  partners: TaxPartner[];
  initial: Shares | null;
  readOnly?: boolean;
}) {
  const t = useTranslations('netIncome');
  const router = useRouter();
  const [value, setValue] = useState<Shares | null>(initial);
  const [pending, start] = useTransition();
  // Unnamed partners get the same fallback names as in the report.
  const named = partners.map((p, i) => ({ ...p, name: p.name || t('partnerFallback', { n: i + 1 }) }));

  const save = (shares: Shares | null) => {
    const before = value;
    setValue(shares);
    start(async () => {
      const res = await setInvoicePartnerShares(id, shares);
      if (!res.ok) {
        setValue(before);
        toast({ text: t('list.failed'), tone: 'err' });
        return;
      }
      toast({ text: t('list.saved'), tone: 'ok' });
      router.refresh();
    });
  };

  return (
    <div className="mt-1.5 flex items-center gap-1.5 sm:justify-end">
      <span className="text-xs text-muted-foreground">{t('split')}</span>
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
      <SharesPicker partners={named} value={value} onChange={save} disabled={pending || readOnly} label={t('list.splitLabel', { number })} />
    </div>
  );
}
