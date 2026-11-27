import {
  buildSealedAccountingXml,
  buildSealedFilingLines,
  buildSealedInvoicesCsv,
  buildSealedNetIncome,
  buildSealedTaxReturn,
  buildSealedVatFiling,
  buildSealedYearIncome,
  open,
  openPaymentAuditInputs,
  paymentAuditEnvelopes,
  paymentAuditOf,
  sealedAccountingEnvelopes,
  sealedEnvelopesOf,
  sealedIncomeEnvelopes,
  sealedNetIncomeEnvelopes,
  type AnnualFilingsInputs,
  type DocumentAmounts,
  type ItemAmounts,
  type NetIncomeInputs,
  type PaymentAmounts,
  type PaymentAuditInputs,
  type SealedAccountingInputs,
  type SealedCsvInputs,
  type SealedVatInputs,
  type TaxReturnInputs,
  type VaultKey,
  type YearIncomeInputs
} from '@faktur/cz-compliance';
import { openDocumentAmounts, openItemAmounts, openPaymentWith } from './amounts';

/*
 * The accountant's files, the VAT filings and the year's reports when some documents have sealed
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

function openAll(key: VaultKey, ciphers: string[]): Promise<Map<string, DocumentAmounts>> {
  return openEach(key, ciphers, openDocumentAmounts);
}

async function openEach<T>(key: VaultKey, ciphers: string[], open: (key: VaultKey, cipher: string) => Promise<T>): Promise<Map<string, T>> {
  const opened = new Map<string, T>();
  await Promise.all(
    [...new Set(ciphers)].map((c) =>
      open(key, c).then(
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

/** The Pohoda or Money S3 XML, or how many documents could not be opened. */
export async function sealedAccountingXml(key: VaultKey, inputs: SealedAccountingInputs) {
  const { documents, items } = sealedAccountingEnvelopes(inputs);
  const [docs, lines] = await Promise.all([openAll(key, documents), openEach<ItemAmounts>(key, items, openItemAmounts)]);
  return buildSealedAccountingXml(inputs, docs, lines);
}

/** The tax-return basis with the sealed income, or how many documents could not be opened. */
export async function sealedTaxReturn(key: VaultKey, inputs: TaxReturnInputs) {
  return buildSealedTaxReturn(inputs, await openAll(key, sealedIncomeEnvelopes(inputs)));
}

/** The roční přehled income with the sealed documents, or how many could not be opened. */
export async function sealedYearIncome(key: VaultKey, inputs: YearIncomeInputs) {
  return buildSealedYearIncome(inputs, await openAll(key, sealedIncomeEnvelopes(inputs)));
}

/** The DPFO / ČSSZ / ZP lines with the sealed income, or how many documents could not be opened. */
export async function sealedFilingLines(key: VaultKey, inputs: AnnualFilingsInputs) {
  return buildSealedFilingLines(inputs, await openAll(key, sealedIncomeEnvelopes(inputs)));
}

/** The net income report with the sealed documents, or how many could not be opened. */
export async function sealedNetIncome(key: VaultKey, inputs: NetIncomeInputs) {
  return buildSealedNetIncome(inputs, await openAll(key, sealedNetIncomeEnvelopes(inputs)));
}

/** The payment audit with the sealed totals and card payments opened, and how many invoices stayed shut. */
export async function sealedPaymentAudit(key: VaultKey, inputs: PaymentAuditInputs) {
  const { documents, payments } = paymentAuditEnvelopes(inputs);
  const [docs, pays] = await Promise.all([
    openAll(key, documents),
    openEach<PaymentAmounts>(key, payments, (k, c) => openPaymentWith((x) => open(k, x), c))
  ]);
  const opened = openPaymentAuditInputs(inputs, docs, pays);
  return { report: paymentAuditOf(opened.inputs), missing: opened.missing };
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
