'use client';

import { useTranslations } from 'next-intl';
import { convertInvoice, creditNoteSource, type ActionResult } from '@/app/[locale]/(dashboard)/invoices/actions';
import { sealedCreditNote } from '@/lib/vault/credit-note';
import { useVault } from './vault-provider';

/**
 * `convertInvoice` that also makes a credit note of an invoice with sealed
 * amounts: the server refuses it (409 amounts_sealed), so the envelopes are
 * negated here after unlock and sent along.
 */
export function useConvertDocument() {
  const t = useTranslations('vault.amounts');
  const { key, requestUnlock } = useVault();
  return async (id: string, to: 'invoice' | 'proforma' | 'credit_note'): Promise<ActionResult<{ id: string }>> => {
    const first = await convertInvoice(id, to);
    if (first.ok || first.error !== 'amounts_sealed' || to !== 'credit_note') return first;
    const k = key ?? (await requestUnlock());
    if (!k) return { ok: false, error: t('creditNoteLocked') };
    const source = await creditNoteSource(id);
    if (!source.ok) return source;
    let sealed;
    try {
      sealed = await sealedCreditNote(k, source.data);
    } catch {
      return { ok: false, error: t('creditNoteUnreadable') };
    }
    return convertInvoice(id, to, sealed);
  };
}
