/**
 * Slovak mandatory e-invoicing (eFaktúra): which documents have to go out as
 * a structured e-invoice through a certified Peppol provider ("doručovacia
 * služba", § 76a ZoDPH).
 *
 * Law: zákon č. 222/2004 Z. z. o DPH as amended by zákon č. 385/2025 Z. z.
 * The transitional § 85o applies from 1.1.2027 to 30.6.2030. From 1.7.2030
 * the permanent § 71 replaces it, extending the duty to cross-border
 * supplies. The rules and their sources are in docs/sk-einvoicing-2027.md
 * (FR SR guidance 1/DPH/2026/I, FAQ eFaktúra 9/DPH/2025/IM).
 *
 * This module models the 2027–2030 domestic phase only. It answers "must
 * this document be an e-invoice?"; whether a supply is VAT-exempt, or was
 * already documented by an eKasa receipt, is the caller's input.
 */
import { buyerKind, type BuyerLike, type VatStatus } from './vat-status.js';

/** § 85o ZoDPH: supplies made from this day on must be e-invoiced. */
export const SK_EINVOICING_START = '2027-01-01';
/** § 71 ods. 1 b) ZoDPH (ViDA): e-invoicing becomes the default and covers intra-EU supplies too. */
export const SK_EINVOICING_VIDA_START = '2030-07-01';

/**
 * Days to issue the e-invoice after the supply: 15 under § 85o ods. 6 until
 * 30.6.2030, then 10 under the amended § 73 from 1.7.2030.
 */
export function skEInvoiceDeadlineDays(supplyDate: string): number {
  return supplyDate.slice(0, 10) >= SK_EINVOICING_VIDA_START ? 10 : 15;
}

export type SkEInvoiceScope = 'mandatory' | 'voluntary' | 'not_applicable';

export type SkEInvoiceReason =
  /** Domestic VAT payer → domestic business or legal person, supply from 1.1.2027 (§ 85o ods. 1–3). */
  | 'in_scope'
  /** The voluntary 2026 phase: allowed through the delivery service, not required (§ 85o ods. 21–22). */
  | 'before_start'
  /** The supplier isn't a Slovak VAT payer (§ 4, 4b, 4c): it may send e-invoices but doesn't have to. */
  | 'supplier_not_vat_payer'
  /** A supply exempt under § 28–43 or § 47, which § 85o leaves out. */
  | 'exempt_supply'
  /** The supply was documented by an eKasa receipt (up to €400) or a simplified invoice up to €100 (§ 85o ods. 1). */
  | 'simplified'
  /** The supplier isn't Slovak. */
  | 'supplier_not_sk'
  /** A private individual: B2C stays outside the mandate. */
  | 'buyer_person'
  /** The buyer is outside Slovakia: cross-border e-invoicing starts on 1.7.2030 (not modelled here). */
  | 'buyer_not_domestic'
  /** A proforma or a quote is not a tax document (FAQ example 34). */
  | 'not_tax_document';

export interface SkEInvoiceInput {
  supplierCountry: string | undefined;
  supplierVatStatus: VatStatus;
  customer: BuyerLike | undefined;
  documentType: 'invoice' | 'credit_note' | 'proforma' | 'quote';
  /** ISO date of the supply, or of the advance payment received for it (DUZP). */
  supplyDate: string;
  /** The supply is VAT-exempt (§ 28–43, § 47). */
  exempt?: boolean;
  /** Already documented by an eKasa receipt / simplified invoice. */
  simplified?: boolean;
}

export function skEInvoiceScope(input: SkEInvoiceInput): { scope: SkEInvoiceScope; reason: SkEInvoiceReason } {
  const result = (scope: SkEInvoiceScope, reason: SkEInvoiceReason) => ({ scope, reason });
  const own = input.supplierCountry?.trim().toUpperCase() || 'CZ';
  if (own !== 'SK') return result('not_applicable', 'supplier_not_sk');
  if (input.documentType === 'proforma' || input.documentType === 'quote') return result('not_applicable', 'not_tax_document');
  if (!input.customer) return result('not_applicable', 'buyer_person');
  const kind = buyerKind('SK', input.customer);
  if (kind === 'person') return result('not_applicable', 'buyer_person');
  if (kind !== 'domestic_business') return result('not_applicable', 'buyer_not_domestic');
  // From here on the buyer is a Slovak business, so it must be able to
  // receive e-invoices from 2027 whatever the supplier does. The remaining
  // cases are allowed through the delivery service but not required.
  if (input.supplierVatStatus !== 'payer') return result('voluntary', 'supplier_not_vat_payer');
  if (input.exempt) return result('voluntary', 'exempt_supply');
  if (input.simplified) return result('voluntary', 'simplified');
  if (input.supplyDate.slice(0, 10) < SK_EINVOICING_START) return result('voluntary', 'before_start');
  return result('mandatory', 'in_scope');
}
