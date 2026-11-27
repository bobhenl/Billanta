import {
  buildSealedInvoicesCsv,
  buildSealedVatFiling,
  sealedEnvelopesOf,
  type DocumentAmounts,
  type SealedCsvInputs,
  type SealedVatInputs,
  type VaultKey
} from '@faktur/cz-compliance';
import { openDocumentAmounts } from './amounts';

/*
 * The accountant CSV and the VAT filings when some documents have sealed
 * amounts. The server refuses the file (409 amounts_sealed) and hands out
 * its inputs instead; the envelopes are opened here and the file is built
 * with the server's own builders (cz-compliance). Nothing opened is sent.
 */

/** A refusal because some documents in the file have sealed amounts. */
export async function isAmountsSealedRefusal(res: Response): Promise<boolean> {
  if (res.status !== 409) return false;
  try {
    const body = (await res.clone().json()) as { message?: unknown };
    return body.message === 'amounts_sealed';
  } catch {
    return false;
  }
}

async function openAll(key: VaultKey, ciphers: string[]): Promise<Map<string, DocumentAmounts>> {
  const opened = new Map<string, DocumentAmounts>();
  await Promise.all(
    [...new Set(ciphers)].map((c) =>
      openDocumentAmounts(key, c).then(
        (v) => void opened.set(c, v),
        // Another key or a broken envelope: the builder counts it as missing.
        () => undefined
      )
    )
  );
  return opened;
}

/** The invoice CSV, or how many documents this key could not open (then no file). */
export async function sealedInvoicesCsv(key: VaultKey, inputs: SealedCsvInputs) {
  return buildSealedInvoicesCsv(inputs, await openAll(key, sealedEnvelopesOf(inputs)));
}

/** The VAT filing XML (null body: nothing to report), or how many documents could not be opened. */
export async function sealedVatFiling(key: VaultKey, inputs: SealedVatInputs) {
  return buildSealedVatFiling(inputs, await openAll(key, sealedEnvelopesOf(inputs)));
}

/** Saves a file; a Blob keeps its bytes (a CSV's BOM would not survive `res.text()`). */
export function saveText(filename: string, text: string | Blob, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
