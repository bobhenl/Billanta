import type { InvoicePdfModel, SealedPdfQrPlan } from './invoice-pdf.js';
import { amountTotals, formatPdfAmount, formatPdfNumber, itemBase, type DocumentAmounts, type ItemAmounts } from './vault-amounts.js';

/**
 * Writes the real numbers into a model whose amounts are sealed, the same
 * way the server formats a plain one (InvoicePdfService.table / totals).
 * `items` are the opened envelopes of `model.sealedAmounts.items`, in order;
 * `qrPng` turns the payment plan plus the amount into a `data:` PNG (the
 * browser owns the QR library). The result has no `sealedAmounts`, so it
 * renders.
 */
export async function fillSealedPdfAmounts(
  model: InvoicePdfModel,
  items: ItemAmounts[],
  qrPng: (plan: SealedPdfQrPlan, amount: number) => Promise<string | null>,
): Promise<{ model: InvoicePdfModel; totals: DocumentAmounts }> {
  const sealed = model.sealedAmounts;
  if (!sealed) return { model, totals: amountTotals([]) };
  if (items.length !== sealed.items.length || items.length !== model.table.items.length) throw new Error('amounts_mismatch');
  const { currency } = sealed;
  const totals = amountTotals(items, { reverseCharge: sealed.reverseCharge });
  const showVat = sealed.vatPayer || totals.byRate.some((r) => r.vatAmount !== 0);
  const asksForPayment = sealed.mayAskForPayment && totals.totalWithVat > 0;
  const paid = sealed.quote ? 0 : sealed.paid ? totals.totalWithVat : 0;
  const label = sealed.quote ? sealed.labels.totalQuote : paid > 0 || !asksForPayment ? sealed.labels.total : sealed.labels.totalToPay;

  const fx = sealed.fx
    ? [
        sealed.fx.rateLine,
        `${sealed.fx.vatInHome} ${formatPdfAmount(totals.totalVat * sealed.fx.rate, sealed.fx.home)}`,
        `${sealed.fx.totalInHome} ${formatPdfAmount(totals.totalWithVat * sealed.fx.rate, sealed.fx.home)}`,
      ]
    : null;

  const due = sealed.paid ? 0 : totals.totalWithVat;
  const png = sealed.qr && asksForPayment && due > 0 ? await qrPng(sealed.qr, due) : null;
  const { sealedAmounts: _, ...rest } = model;
  void _;
  return {
    totals,
    model: {
      ...rest,
      table: {
        ...model.table,
        showVat,
        // A lump-sum table (each line once, no unit, no discount) only for a non-payer, as on the server.
        lumpSum: model.table.lumpSum && !showVat && items.every((i, n) => i.quantity === 1 && !sealed.units[n] && !i.discountPercent),
        hasDiscount: items.some((i) => i.discountPercent !== 0),
        items: model.table.items.map((row, n) => {
          const i = items[n]!;
          const unit = sealed.units[n];
          return {
            ...row,
            quantity: `${formatPdfNumber(i.quantity)}${unit ? ` ${unit}` : ''}`,
            unitPrice: formatPdfAmount(i.unitPrice, currency),
            discount: i.discountPercent ? `${formatPdfNumber(i.discountPercent)}%` : '',
            vatRate: `${sealed.reverseCharge ? 0 : (i.vatRate ?? 0)}%`,
            total: formatPdfAmount(itemBase(i), currency),
          };
        }),
      },
      totals: {
        showVat,
        byRate: showVat
          ? totals.byRate.map((r) => ({
              base: `${sealed.labels.base} ${r.vatRatePercent}%`,
              amount: formatPdfAmount(r.totalWithoutVat, currency),
              vat: `${sealed.labels.vat} ${formatPdfAmount(r.vatAmount, currency)}`,
            }))
          : [],
        label,
        amount: formatPdfAmount(totals.totalWithVat, currency),
        paid: paid > 0 ? { amount: `−${formatPdfAmount(paid, currency)}`, remaining: formatPdfAmount(0, currency) } : null,
        fx,
      },
      payment: { ...model.payment, qr: png && sealed.qr ? { label: sealed.qr.label, png } : model.payment.qr },
    },
  };
}
