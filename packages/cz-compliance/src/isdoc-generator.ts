/**
 * ISDOC 6.0.2 XML export.
 *
 * ISDOC ("Information System Document") is the standard structured
 * electronic-invoice XML format used by Czech accounting software (Pohoda,
 * Money S3, ABRA, etc.) for invoice interchange.
 *
 * STATUS: STUB. Full ISDOC 6.0.2 XML serialization requires building the
 * document against the official XSD schema, which is too large/detail-
 * sensitive to write correctly without the schema open side-by-side (namespace
 * URIs, exact element ordering, required vs. optional elements, VAT
 * recapitulation ("PriceSummaryVAT") structuring, digital-signature blocks,
 * etc.). Implementing this against a guess would produce XML accounting
 * software silently rejects or mis-imports — worse than an explicit stub.
 *
 * Reference material for the real implementation:
 *   - ISDOC 6.0.2 documentation: https://isdoc.cz/6.0.2/doc/isdoc.pdf
 *   - Official XSD schema:       https://github.com/isdoc/schema
 *   - Verification plan (blueprint §Verification Plan #3): generate a file
 *     with the real implementation, validate against the XSD, and if
 *     possible round-trip it through a real CZ accounting tool (e.g. Pohoda)
 *     to confirm real-world acceptance before considering this "done".
 *
 * The `IsdocInvoiceInput` type below is NOT a stub — it's a fully fleshed-out
 * shape mirroring the blueprint's `tenants` / `contacts` / `invoices` /
 * `invoice_line_items` schema (see docs/CZ-SK-Invoicing-SaaS-Blueprint.md §4),
 * so that implementing the actual XML serialization later is a matter of
 * mapping fields onto ISDOC elements, not re-deriving the shape from scratch.
 */

/** ISO 4217 currency code. The MVP scope is CZK/EUR but the type isn't restricted to those. */
export type IsdocCurrencyCode = string;

/** VAT rate category, per Czech VAT law (§47 zákona o DPH). Percentages current as of 2024/2025 CZ rates. */
export type VatRateType = 'base' | 'reduced' | 'reduced2' | 'zero';

/** A postal/registered address, shared by supplier and customer parties. */
export interface IsdocAddress {
  street: string;
  /** House/registration number, and orientation number if applicable (e.g. "525/15"). */
  houseNumber?: string;
  city: string;
  /** City district / part of municipality, if applicable. */
  cityPart?: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2 country code, e.g. "CZ", "SK". */
  countryCode: string;
}

/** Bank account payment details for the "how to pay this invoice" section. */
export interface IsdocBankAccount {
  /** Domestic account number in `[prefix-]number/bankCode` format. */
  accountNumber?: string;
  iban?: string;
  bic?: string;
  bankName?: string;
}

/**
 * A trading party (supplier or customer), mirroring the blueprint's `tenants`
 * (when acting as supplier) and `contacts` (when acting as customer) tables.
 */
export interface IsdocParty {
  /** Registered legal name ("obchodní jméno" / "název"). */
  legalName: string;
  /** IČO — organization identifier. Required for CZ/SK subjects; may be absent for some foreign customers. */
  ico?: string;
  /** DIČ — VAT identification number, e.g. "CZ00006947". */
  dic?: string;
  /** Whether this party is a registered VAT payer ("plátce DPH"). */
  isVatPayer?: boolean;
  address: IsdocAddress;
  /** Contact email, used for ISDOC's optional contact block. */
  email?: string;
  /** Contact phone, used for ISDOC's optional contact block. */
  phone?: string;
}

/**
 * A single invoice line item, mirroring the blueprint's
 * `invoice_line_items` table (tenant_id, invoice_id, description, quantity,
 * unit_price, vat_rate).
 */
export interface IsdocLineItem {
  /** Free-text description of the good/service ("popis položky"). */
  description: string;
  quantity: number;
  /** Unit of measure, e.g. "ks", "hod", "kg". Defaults to "ks" (pieces) if omitted. */
  unit?: string;
  /** Unit price, VAT excluded. */
  unitPriceWithoutVat: number;
  vatRate: VatRateType;
  /** VAT rate as an explicit percentage (e.g. 21, 12, 0), for cases where `vatRate` category alone is ambiguous (e.g. CZ vs SK reduced rates differ). */
  vatRatePercent: number;
}

/** Pre-computed invoice totals, split by VAT rate category (ISDOC's `PriceSummaryVAT` per rate). */
export interface IsdocVatRecapitulationEntry {
  vatRate: VatRateType;
  vatRatePercent: number;
  totalWithoutVat: number;
  vatAmount: number;
  totalWithVat: number;
}

export interface IsdocTotals {
  totalWithoutVat: number;
  totalVat: number;
  totalWithVat: number;
  /** Rounding correction applied to arrive at `totalWithVat` (ISDOC `RoundingAmount`), if any. */
  roundingAmount?: number;
  /** Breakdown by VAT rate, required by ISDOC's VAT recapitulation section. */
  vatRecapitulation: IsdocVatRecapitulationEntry[];
}

/**
 * Full invoice input, mirroring the blueprint's `invoices` table plus its
 * joined `contacts` (customer) and `tenants` (supplier) rows and
 * `invoice_line_items` rows. This is the shape the NestJS backend's finalize
 * step (§6 "Issue" action) should assemble before calling `generateIsdocXml`.
 */
export interface IsdocInvoiceInput {
  /** Sequential invoice number, allocated at issuance time (blueprint §6: "no invoice number is allocated until issue time"). */
  invoiceNumber: string;
  /** Variable symbol for payment matching ("variabilní symbol"); conventionally equal to the invoice number's digits. */
  variableSymbol?: string;
  /** ISO 8601 date the invoice was issued ("datum vystavení"). */
  issueDate: string;
  /** ISO 8601 date the invoice is due ("datum splatnosti"). */
  dueDate: string;
  /** ISO 8601 date of the taxable supply / VAT chargeable event ("datum uskutečnění zdanitelného plnění", DUZP). */
  taxableSupplyDate: string;
  currency: IsdocCurrencyCode;
  supplier: IsdocParty;
  customer: IsdocParty;
  lineItems: IsdocLineItem[];
  totals: IsdocTotals;
  bankAccount?: IsdocBankAccount;
  /** Free-text note printed on the invoice (e.g. "Vystaveno na základě hlasové zprávy"). */
  note?: string;
  /** Order/reference number the customer quoted ("číslo objednávky"), if any. */
  orderNumber?: string;
  /**
   * Provenance of the invoice data, mirroring `invoices.source` in the
   * blueprint schema. Not part of the ISDOC schema itself, but useful for
   * the caller to thread through (e.g. to decide whether to embed an
   * AI-draft disclaimer as a `Note`).
   */
  source?: 'manual' | 'ai_telegram' | 'ai_whatsapp' | 'api';
}

/**
 * Generates an ISDOC 6.0.2-compliant XML string for the given invoice.
 *
 * NOT YET IMPLEMENTED — see the module-level doc comment for why and what's
 * needed to implement it (the official XSD schema must be consulted).
 */
export function generateIsdocXml(_input: IsdocInvoiceInput): string {
  throw new Error(
    'TODO: implement against ISDOC 6.0.2 schema, see https://isdoc.cz/6.0.2/doc/isdoc.pdf and https://github.com/isdoc/schema',
  );
}
