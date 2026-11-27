/** Shape stored in `recurring_invoice_templates.line_items_snapshot` (jsonb). */
export type LineItemSnapshot = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number | null;
};

/**
 * The draft's line items from a template's snapshot. Descriptions are copied
 * as stored: an encrypted one (`enc:v1:…`) stays the same envelope, so the
 * draft opens in the browser with the same vault key and the server never
 * needs, or gets, the text. The run only makes a draft; nothing is printed
 * or e-mailed until a member issues and sends it.
 */
export function lineItemsFromSnapshot(snapshot: LineItemSnapshot[] | null | undefined, tenantId: string, invoiceId: string) {
  return (snapshot ?? []).map((item, index) => ({
    tenantId,
    invoiceId,
    description: item.description,
    quantity: item.quantity.toString(),
    unitPrice: item.unitPrice.toString(),
    vatRate: item.vatRate != null ? item.vatRate.toString() : null,
    sortOrder: index,
  }));
}
