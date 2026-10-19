'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Info } from 'lucide-react';
import { SK_EINVOICING_START, skEInvoiceScope, type SkEInvoiceReason } from '@faktur/cz-compliance';
import { Segmented } from '@/components/public-tools/fields';

type Country = 'sk' | 'cz';
type YesNo = 'yes' | 'no';

/** Result text per reason the scope helper can return for these answers. */
const ISSUE_KEY: Partial<Record<SkEInvoiceReason, string>> = {
  in_scope: 'mandatory',
  supplier_not_vat_payer: 'nonPayer',
  exempt_supply: 'exempt',
  buyer_person: 'noB2b',
  supplier_not_sk: 'cz'
};

/**
 * Four questions, answered by skEInvoiceScope from cz-compliance (the rules
 * with their paragraphs) for a typical invoice on the first day of the
 * mandate, so the page and the library cannot drift apart. Receiving is
 * a separate line: every Slovak business must be able to receive from
 * 2027 whether or not it has to issue (FAQ 7).
 */
export function SkEinvoicingCheck() {
  const t = useTranslations('tools.guides.items.skEinvoicing.check');
  const [country, setCountry] = useState<Country>('sk');
  const [payer, setPayer] = useState<YesNo>('yes');
  const [b2b, setB2b] = useState<YesNo>('yes');
  const [exempt, setExempt] = useState<YesNo>('no');

  const sk = country === 'sk';
  const { scope, reason } = skEInvoiceScope({
    supplierCountry: country.toUpperCase(),
    supplierVatStatus: payer === 'yes' ? 'payer' : 'non_payer',
    customer: b2b === 'yes' ? { ico: '12345678', address: { countryCode: sk ? 'SK' : 'CZ' } } : { isPerson: true },
    documentType: 'invoice',
    supplyDate: SK_EINVOICING_START,
    exempt: exempt === 'yes'
  });
  const issueKey = ISSUE_KEY[reason] ?? 'noB2b';
  const yesNo = [
    { value: 'yes' as const, label: t('yes') },
    { value: 'no' as const, label: t('no') }
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Segmented
          label={t('country')}
          value={country}
          onChange={setCountry}
          options={[
            { value: 'sk', label: t('countrySk') },
            { value: 'cz', label: t('countryCz') }
          ]}
        />
        {sk && <Segmented label={t('payer')} value={payer} onChange={setPayer} options={yesNo} />}
        {sk && <Segmented label={t('b2b')} value={b2b} onChange={setB2b} options={yesNo} />}
        {sk && payer === 'yes' && b2b === 'yes' && <Segmented label={t('exempt')} value={exempt} onChange={setExempt} options={yesNo} />}
      </div>
      <div className="mt-5 space-y-3 border-t border-border pt-4" aria-live="polite">
        <p className="flex gap-2">
          {scope === 'mandatory' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span>
            <span className="font-semibold">{t('issueTitle')}: </span>
            {t(`result.${issueKey}`)}
          </span>
        </p>
        <p className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <span className="font-semibold">{t('receiveTitle')}: </span>
            {sk ? t('receiveSk') : t('receiveCz')}
          </span>
        </p>
      </div>
    </div>
  );
}
