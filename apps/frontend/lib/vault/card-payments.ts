import { documentKeyWrap, unwrapDocumentKey, type PaymentAmounts, type VaultKey } from '@faktur/cz-compliance';
import { sealCardPayment, type CardPaymentToSeal } from './actions';
import { sealPayment } from './amounts';

/** What Stripe charged and kept, as the sealed payments panel counts it. */
export const cardPaymentAmounts = (item: CardPaymentToSeal): PaymentAmounts => ({
  amount: Number(item.amount),
  fee: item.fee == null ? 0 : Number(item.fee),
  receivedHome: null
});

/**
 * Seals waiting card payments (migration 0118) under their documents' keys,
 * so they join the other sealed payments and the server drops the plain
 * numbers. A payment that fails here simply waits for the next pass.
 */
export async function sealCardPayments(key: VaultKey, items: CardPaymentToSeal[]): Promise<{ sealed: number; failed: number }> {
  let sealed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const wrap = documentKeyWrap(item.encAmounts);
      if (!wrap) throw new Error('document_key_missing');
      const docKey = await unwrapDocumentKey(key, wrap);
      const result = await sealCardPayment(item.invoiceId, item.id, await sealPayment(docKey, cardPaymentAmounts(item)));
      if (result.ok) sealed++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { sealed, failed };
}
