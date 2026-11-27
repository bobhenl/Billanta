import {
  creditNoteAmounts,
  documentKeyWrap,
  encodeDocumentAmounts,
  encodeItemAmounts,
  sealWithDocumentKey,
  unwrapDocumentKey,
  type VaultKey
} from '@faktur/cz-compliance';
import { openItemAmounts } from './amounts';

/*
 * A credit note of an invoice with sealed amounts. The server copies a plain
 * invoice's items with negated quantities; inside an envelope it cannot, so
 * this browser opens the items, negates them and seals them again under the
 * invoice's own document key (the server checks that key).
 */
export async function sealedCreditNote(
  key: VaultKey,
  source: { reverseCharge: boolean; encAmounts: string | null; items: { encAmounts: string | null }[] }
): Promise<{ enc_amounts: string; item_enc_amounts: string[] }> {
  const wrap = documentKeyWrap(source.encAmounts);
  if (!wrap || source.items.some((i) => !i.encAmounts)) throw new Error('amounts_mismatch');
  const docKey = await unwrapDocumentKey(key, wrap);
  const opened = await Promise.all(source.items.map((i) => openItemAmounts(key, i.encAmounts!)));
  const { items, totals } = creditNoteAmounts(opened, { reverseCharge: source.reverseCharge });
  return {
    enc_amounts: await sealWithDocumentKey(docKey, encodeDocumentAmounts(totals)),
    item_enc_amounts: await Promise.all(items.map((i) => sealWithDocumentKey(docKey, encodeItemAmounts(i))))
  };
}
