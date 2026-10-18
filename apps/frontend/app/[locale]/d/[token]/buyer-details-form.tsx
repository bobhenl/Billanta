'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { submitBuyerDetails } from '@/lib/public-buyer-details-actions';
import { BuyerFields, buyerForSubmit, emptyBuyer, type BuyerFieldsValue } from '@/components/buyer-fields';

interface Props {
  token: string;
  supplierName: string;
  prefill: { name: string | null; email: string | null; country: string | null; isPerson: boolean };
}

/** The customer's billing details form, with company lookup by IČO (ARES/RPO) or EU VAT ID (VIES). */
export function BuyerDetailsForm({ token, supplierName, prefill }: Props) {
  const t = useTranslations('buyerDetails.form');
  const router = useRouter();
  const [form, setForm] = useState<BuyerFieldsValue>(() => emptyBuyer(prefill));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    startTransition(async () => {
      const r = await submitBuyerDetails(token, buyerForSubmit(form));
      if (r.ok) {
        router.refresh();
        return;
      }
      if (r.fields) setFields(r.fields);
      setError(t(`errors.${r.error}`));
    });
  };

  return (
    <form onSubmit={submit} className="mt-8 rounded-lg border border-primary/30 bg-primary/5 p-5">
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('hint', { supplier: supplierName })}</p>

      <BuyerFields value={form} onChange={setForm} fields={fields} lookupUrl={`/api/public/buyer-details/${encodeURIComponent(token)}/lookup`} />

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('submit')}
      </button>
    </form>
  );
}
