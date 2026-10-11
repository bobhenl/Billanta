/**
 * ISDOC 6.0.2 XML export.
 *
 * ISDOC ("Information System Document") is the standard structured
 * electronic-invoice XML format used by Czech accounting software (Pohoda,
 * Money S3, ABRA, etc.) for invoice interchange.
 *
 * This implementation was written against the REAL, authoritative ISDOC 6.0.2
 * XSD schema, fetched directly from https://isdoc.github.io/xsd/isdoc-invoice-6.0.2.xsd
 * (the canonical schema also documented at https://isdoc.cz/6.0.2/doc/isdoc.pdf).
 * Every element name, nesting level, and minOccurs/maxOccurs cardinality
 * referenced below (namespace, `Invoice` root sequence, `PartyType`,
 * `InvoiceLineType`, `TaxTotalType`/`TaxSubTotalType`, `LegalMonetaryTotalType`,
 * `PaymentMeansType`/`BankAccount` group) was read verbatim from that XSD, not
 * guessed. See the per-section comments below for exactly which parts are
 * schema-VERIFIED vs. best-effort/unconfirmed design decisions made where the
 * schema is silent or where `IsdocInvoiceInput` doesn't carry enough
 * information to fill a schema-required field.
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

// ---------------------------------------------------------------------------
// Schema-verified constants
// ---------------------------------------------------------------------------

/** VERIFIED against isdoc-invoice-6.0.2.xsd `targetNamespace`. */
const ISDOC_NAMESPACE = 'http://isdoc.cz/namespace/2013';

/** VERIFIED: `Invoice/@version` is a required `VersionType` attribute; the schema itself is versioned 6.0.2. */
const ISDOC_VERSION = '6.0.2';

/**
 * VERIFIED: `DocumentTypeType` enumeration value `1` = "Faktura - daňový doklad" / "invoice".
 * `IsdocInvoiceInput` has no document-type field (credit note / proforma /
 * advance invoice etc. are out of scope), so this generator only ever
 * produces ordinary tax invoices (document type 1). This is a scope
 * limitation of the current input type, not a schema ambiguity.
 */
const DOCUMENT_TYPE_INVOICE = 1;

/**
 * VERIFIED: `VATCalculationMethodType` enumeration: `0` = "Zdola" / "from the
 * bottom" (net price known, VAT computed and added on top), `1` = "Shora" /
 * "from the top" (gross price known, VAT extracted backwards). Since
 * `IsdocLineItem.unitPriceWithoutVat` is always a net (VAT-excluded) price,
 * every line in this generator uses method 0.
 */
const VAT_CALCULATION_METHOD_FROM_NET = 0;

/**
 * VERIFIED: `PaymentMeansCodeType` enumeration includes `42` = "Převod na
 * účet" / "Money transfer to an account". Chosen because this generator only
 * ever emits bank-transfer payment instructions (see `buildPaymentMeansXml`).
 */
const PAYMENT_MEANS_CODE_BANK_TRANSFER = 42;

/**
 * BEST-EFFORT / not verified beyond the ISO 3166-1 codes themselves: the
 * schema's `CountryType` requires both `IdentificationCode` (verified: "Kód
 * země podle ISO 3166" / "ISO 3166 country code") AND a human-readable
 * `Name`. `IsdocAddress` only carries the code, so a code -> localized name
 * table is needed to satisfy the schema. This table only covers the
 * countries relevant to a CZ/SK invoicing product (CZ/SK plus close trading
 * partners); it is not an exhaustive ISO 3166 name list. Unknown codes fall
 * back to using the code itself as the name, which is schema-valid (any
 * non-empty string) but not a real country name.
 */
const COUNTRY_NAMES: Record<string, string> = {
  CZ: 'Česká republika',
  SK: 'Slovenská republika',
  DE: 'Německo',
  AT: 'Rakousko',
  PL: 'Polsko',
  HU: 'Maďarsko',
  GB: 'Velká Británie',
  US: 'Spojené státy americké',
};

// ---------------------------------------------------------------------------
// Small formatting / escaping helpers
// ---------------------------------------------------------------------------

/**
 * Escapes the five XML-reserved characters in a string so it's safe to embed
 * as XML text content or attribute value. `&` must be escaped first to avoid
 * double-escaping the entities produced for the other characters.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Rounds to 2 decimal places using a small epsilon to counter binary float error (e.g. 1.005). */
function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Formats a monetary `AmountType` (xs:decimal) value with exactly 2 decimal places. */
function formatAmount(amount: number): string {
  return roundMoney(amount).toFixed(2);
}

/** Formats a plain decimal (`PercentType`/`CurrRateType`, both xs:decimal) without forcing decimal places. */
function formatDecimal(value: number): string {
  return String(value);
}

/**
 * `IssueDateType`/`TaxPointDateType`/`PaymentDueDateType` are all `xs:date`
 * (VERIFIED: `<xs:restriction base="xs:date"/>`), whose lexical form is plain
 * `YYYY-MM-DD` (optionally with a timezone suffix) — NOT `xs:dateTime`.
 * `IsdocInvoiceInput`'s date fields are documented as "ISO 8601 date" but a
 * caller could plausibly pass a full ISO datetime (e.g. from
 * `Date#toISOString()`); this strips any time-of-day component so the
 * output stays schema-valid either way.
 */
function toIsdocDate(value: string): string {
  return value.slice(0, 10);
}

/** True if `a` and `b` differ by more than half a cent (accounts for float/rounding noise). */
function approximatelyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

function xmlElement(tag: string, content: string): string {
  return `<${tag}>${content}</${tag}>`;
}

function xmlElementIfDefined(tag: string, value: string | undefined): string {
  return value !== undefined && value !== '' ? xmlElement(tag, escapeXml(value)) : '';
}

// ---------------------------------------------------------------------------
// Address / Party (AccountingSupplierParty / AccountingCustomerParty)
// ---------------------------------------------------------------------------

/**
 * VERIFIED against `PostalAddressType`: required, ordered sequence
 * `StreetName`, `BuildingNumber`, `CityName`, `PostalZone`, `Country`
 * (`Country` itself requires `IdentificationCode` + `Name`, both verified).
 *
 * BEST-EFFORT: `BuildingNumber` has no `minOccurs="0"` in the schema (it's
 * required), but `IsdocAddress.houseNumber` is optional. When absent we emit
 * an empty element rather than omitting it, since an empty string is
 * schema-valid (unrestricted `xs:string`) while a missing element is not.
 */
function buildPostalAddressXml(address: IsdocAddress): string {
  const countryName = COUNTRY_NAMES[address.countryCode.toUpperCase()] ?? address.countryCode;
  return [
    xmlElement('StreetName', escapeXml(address.street)),
    xmlElement('BuildingNumber', escapeXml(address.houseNumber ?? '')),
    xmlElement('CityName', escapeXml(address.cityPart ? `${address.city} - ${address.cityPart}` : address.city)),
    xmlElement('PostalZone', escapeXml(address.postalCode)),
    `<Country>${xmlElement('IdentificationCode', escapeXml(address.countryCode))}${xmlElement(
      'Name',
      escapeXml(countryName),
    )}</Country>`,
  ].join('');
}

/**
 * VERIFIED against `PartyType`: ordered sequence `PartyIdentification`
 * (required), `PartyName` (required), `PostalAddress` (required),
 * `PartyTaxScheme` (optional, 0..unbounded), `RegisterIdentification`
 * (optional, skipped here — no source data in `IsdocParty`), `Contact`
 * (optional).
 *
 * VERIFIED: `PartyIdentificationType.ID` ("IČ" / "Company identification
 * number") is required, no `minOccurs="0"`.
 *
 * BEST-EFFORT: `IsdocParty.ico` is optional ("may be absent for some foreign
 * customers" per its doc comment), but the schema requires an ID. There is no
 * spec-documented convention for what to put here for a foreign party without
 * an IČO equivalent, so this falls back to the DIČ, and failing that to the
 * literal string `"N/A"` (schema-valid since `IDType` is an unrestricted
 * string) — an explicit, greppable placeholder rather than a fabricated
 * number.
 *
 * VERIFIED: `PartyTaxSchemeType` requires `CompanyID` (DIČ) + `TaxScheme`.
 * BEST-EFFORT: `TaxScheme` is always emitted as the literal `"VAT"`. The
 * schema doc says CZ DIČ conventionally uses the `VAT` scheme and SK DIČ
 * conventionally uses `TIN` for the *domestic* tax number (SK IČ DPH still
 * uses `VAT`) — `IsdocParty` doesn't carry a country/scheme distinction, so
 * this is a simplification that is correct for CZ suppliers/customers but
 * unconfirmed for SK entities using a non-VAT-scheme DIČ.
 */
function buildPartyXml(party: IsdocParty): string {
  const id = party.ico ?? party.dic ?? 'N/A';

  const partyIdentification = `<PartyIdentification>${xmlElement('ID', escapeXml(id))}</PartyIdentification>`;
  const partyName = `<PartyName>${xmlElement('Name', escapeXml(party.legalName))}</PartyName>`;
  const postalAddress = `<PostalAddress>${buildPostalAddressXml(party.address)}</PostalAddress>`;

  const partyTaxScheme = party.dic
    ? `<PartyTaxScheme>${xmlElement('CompanyID', escapeXml(party.dic))}${xmlElement('TaxScheme', 'VAT')}</PartyTaxScheme>`
    : '';

  const contactFields = [xmlElementIfDefined('Telephone', party.phone), xmlElementIfDefined('ElectronicMail', party.email)]
    .filter(Boolean)
    .join('');
  const contact = contactFields ? `<Contact>${contactFields}</Contact>` : '';

  return `<Party>${partyIdentification}${partyName}${postalAddress}${partyTaxScheme}${contact}</Party>`;
}

// ---------------------------------------------------------------------------
// Invoice lines
// ---------------------------------------------------------------------------

/**
 * VERIFIED against `InvoiceLineType`: this generator emits, in schema order,
 * `ID` (required), `LineExtensionAmount` (required), `LineExtensionAmountTaxInclusive`
 * (required), `LineExtensionTaxAmount` (required), `UnitPrice` (required),
 * `UnitPriceTaxInclusive` (required), `ClassifiedTaxCategory` (required),
 * `Item` (optional, carries the description). All other `InvoiceLineType`
 * children (`OrderReference`, `DeliveryNoteReference`, `Note`, etc.) are
 * optional in the schema and are omitted since `IsdocLineItem` carries no
 * corresponding data.
 *
 * VERIFIED against `ClassifiedTaxCategoryType`: required `Percent` +
 * `VATCalculationMethod`; `VATApplicable`/`LocalReverseCharge` are optional
 * and omitted (no source data).
 *
 * BEST-EFFORT arithmetic convention (documented since this is the
 * error-prone part): the per-line tax amount is computed as
 * `round(lineNet * percent / 100, 2)` independently per line. The
 * *recapitulation* totals (see `computeVatRecapitulation`) are computed by
 * summing line nets per rate bracket and then applying the rate ONCE to the
 * summed base, not by summing these per-line rounded tax amounts — this
 * avoids compounding rounding error across many lines and matches how Czech
 * accounting software (e.g. Pohoda) computes the VAT recapitulation table.
 * A small discrepancy between "sum of per-line taxes" and "tax on summed
 * base" is normal and is exactly what ISDOC's `RoundingAmount` field exists
 * to absorb.
 */
function buildInvoiceLineXml(item: IsdocLineItem, index: number): string {
  const lineNet = roundMoney(item.quantity * item.unitPriceWithoutVat);
  const lineTax = roundMoney((lineNet * item.vatRatePercent) / 100);
  const lineGross = roundMoney(lineNet + lineTax);
  const unitPriceTaxInclusive = roundMoney(item.unitPriceWithoutVat * (1 + item.vatRatePercent / 100));

  const classifiedTaxCategory = `<ClassifiedTaxCategory>${xmlElement(
    'Percent',
    formatDecimal(item.vatRatePercent),
  )}${xmlElement('VATCalculationMethod', String(VAT_CALCULATION_METHOD_FROM_NET))}</ClassifiedTaxCategory>`;

  const itemXml = `<Item>${xmlElement('Description', escapeXml(item.description))}</Item>`;

  // InvoicedQuantity is a simple-content element carrying a `unitCode`
  // attribute (VERIFIED against `QuantityType`: `xs:decimal` extension with
  // an optional `unitCode` attribute), so it's built directly rather than
  // via the plain-text `xmlElement` helper.
  const invoicedQuantity = `<InvoicedQuantity unitCode="${escapeXml(item.unit ?? 'ks')}">${formatDecimal(
    item.quantity,
  )}</InvoicedQuantity>`;

  return [
    '<InvoiceLine>',
    xmlElement('ID', String(index + 1)),
    invoicedQuantity,
    xmlElement('LineExtensionAmount', formatAmount(lineNet)),
    xmlElement('LineExtensionAmountTaxInclusive', formatAmount(lineGross)),
    xmlElement('LineExtensionTaxAmount', formatAmount(lineTax)),
    xmlElement('UnitPrice', formatAmount(item.unitPriceWithoutVat)),
    xmlElement('UnitPriceTaxInclusive', formatAmount(unitPriceTaxInclusive)),
    classifiedTaxCategory,
    itemXml,
    '</InvoiceLine>',
  ].join('');
}

// ---------------------------------------------------------------------------
// VAT recapitulation (TaxTotal / TaxSubTotal)
// ---------------------------------------------------------------------------

interface ComputedVatGroup {
  vatRate: VatRateType;
  vatRatePercent: number;
  taxableAmount: number;
  taxAmount: number;
}

/**
 * Groups line items by VAT rate percentage and sums the (rounded) line net
 * amounts per group, then computes that group's VAT by applying the rate
 * once to the summed base (see the arithmetic-convention note on
 * `buildInvoiceLineXml`). Grouping is keyed on `vatRatePercent` (the number
 * that actually matters for tax purposes), not the `vatRate` category label,
 * since two lines can plausibly share a category with different explicit
 * percentages only in malformed input — using the percent as the key means
 * that case still groups correctly by actual tax rate.
 *
 * Sorted descending by percent purely for deterministic, human-friendly
 * output — the schema does not mandate an order for `TaxSubTotal` entries
 * (`maxOccurs="unbounded"` with no `<xs:unique>`/ordering constraint).
 */
function computeVatRecapitulation(lineItems: IsdocLineItem[]): ComputedVatGroup[] {
  const groups = new Map<number, ComputedVatGroup>();

  for (const item of lineItems) {
    const lineNet = roundMoney(item.quantity * item.unitPriceWithoutVat);
    const existing = groups.get(item.vatRatePercent);
    if (existing) {
      existing.taxableAmount = roundMoney(existing.taxableAmount + lineNet);
    } else {
      groups.set(item.vatRatePercent, {
        vatRate: item.vatRate,
        vatRatePercent: item.vatRatePercent,
        taxableAmount: lineNet,
        taxAmount: 0,
      });
    }
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.taxAmount = roundMoney((group.taxableAmount * group.vatRatePercent) / 100);
  }

  return result.sort((a, b) => b.vatRatePercent - a.vatRatePercent);
}

/**
 * Cross-validates the freshly-computed (from `lineItems`) VAT recapitulation
 * against the caller-supplied `IsdocTotals.vatRecapitulation` and grand
 * totals. `generateIsdocXml` always emits the *computed* figures (so the XML
 * is guaranteed internally consistent with the line items it contains), but
 * throws a descriptive error if the caller's pre-computed totals disagree
 * beyond rounding noise — this catches upstream bugs (e.g. a stale totals
 * cache) before they produce a legally-significant tax document with wrong
 * numbers.
 */
function validateTotalsConsistency(computed: ComputedVatGroup[], totals: IsdocTotals): void {
  for (const group of computed) {
    const match = totals.vatRecapitulation.find((entry) => entry.vatRatePercent === group.vatRatePercent);
    if (!match) {
      throw new Error(
        `generateIsdocXml: totals.vatRecapitulation has no entry for the ${group.vatRatePercent}% VAT rate present in lineItems`,
      );
    }
    if (!approximatelyEqual(match.totalWithoutVat, group.taxableAmount)) {
      throw new Error(
        `generateIsdocXml: totals.vatRecapitulation base for ${group.vatRatePercent}% VAT is ${match.totalWithoutVat}, but summing lineItems gives ${group.taxableAmount}`,
      );
    }
    if (!approximatelyEqual(match.vatAmount, group.taxAmount)) {
      throw new Error(
        `generateIsdocXml: totals.vatRecapitulation VAT amount for ${group.vatRatePercent}% is ${match.vatAmount}, but computing it from lineItems gives ${group.taxAmount}`,
      );
    }
  }

  for (const entry of totals.vatRecapitulation) {
    if (!computed.some((group) => group.vatRatePercent === entry.vatRatePercent)) {
      throw new Error(
        `generateIsdocXml: totals.vatRecapitulation has an entry for ${entry.vatRatePercent}% VAT, but no lineItems use that rate`,
      );
    }
  }

  const computedTaxableTotal = roundMoney(computed.reduce((sum, group) => sum + group.taxableAmount, 0));
  const computedTaxTotal = roundMoney(computed.reduce((sum, group) => sum + group.taxAmount, 0));

  if (!approximatelyEqual(computedTaxableTotal, totals.totalWithoutVat)) {
    throw new Error(
      `generateIsdocXml: totals.totalWithoutVat is ${totals.totalWithoutVat}, but summing lineItems gives ${computedTaxableTotal}`,
    );
  }
  if (!approximatelyEqual(computedTaxTotal, totals.totalVat)) {
    throw new Error(
      `generateIsdocXml: totals.totalVat is ${totals.totalVat}, but computing it from lineItems gives ${computedTaxTotal}`,
    );
  }

  const expectedTotalWithVat = roundMoney(totals.totalWithoutVat + totals.totalVat + (totals.roundingAmount ?? 0));
  if (!approximatelyEqual(expectedTotalWithVat, totals.totalWithVat)) {
    throw new Error(
      `generateIsdocXml: totals.totalWithVat (${totals.totalWithVat}) does not equal totalWithoutVat + totalVat + roundingAmount (${expectedTotalWithVat})`,
    );
  }
}

/**
 * VERIFIED against `TaxTotalType` (required `TaxSubTotal` 1..unbounded, then
 * required `TaxAmount`) and `TaxSubTotalType`. Re-reading the raw XSD closely:
 * `TaxableAmount`, `TaxAmount`, `TaxInclusiveAmount`, `AlreadyClaimedTaxableAmount`,
 * `AlreadyClaimedTaxAmount`, `AlreadyClaimedTaxInclusiveAmount`,
 * `DifferenceTaxableAmount`, `DifferenceTaxAmount`, `DifferenceTaxInclusiveAmount`,
 * and `TaxCategory` are ALL required (no `minOccurs="0"`) — only the `*Curr`
 * foreign-currency siblings of each are optional. This is easy to miss (the
 * `AlreadyClaimed*`/`Difference*` fields only make semantic sense for advance
 * invoices) but confirmed directly from the schema.
 *
 * BEST-EFFORT: same "nothing already claimed" inference as
 * `buildLegalMonetaryTotalXml` — `AlreadyClaimed*Amount` is `0` and
 * `Difference*Amount` therefore equals the plain taxable/tax/inclusive amount
 * for this rate bracket.
 *
 * VERIFIED against `TaxCategoryType`: required `Percent`; `TaxScheme` is
 * optional and emitted as `"VAT"` for consistency with the party-level tax
 * scheme (same best-effort caveat as `buildPartyXml`).
 */
function buildTaxTotalXml(groups: ComputedVatGroup[]): string {
  const zero = formatAmount(0);

  const taxSubTotals = groups
    .map((group) => {
      const taxInclusive = formatAmount(roundMoney(group.taxableAmount + group.taxAmount));
      const taxableAmount = formatAmount(group.taxableAmount);
      const taxAmount = formatAmount(group.taxAmount);
      return [
        '<TaxSubTotal>',
        xmlElement('TaxableAmount', taxableAmount),
        xmlElement('TaxAmount', taxAmount),
        xmlElement('TaxInclusiveAmount', taxInclusive),
        xmlElement('AlreadyClaimedTaxableAmount', zero),
        xmlElement('AlreadyClaimedTaxAmount', zero),
        xmlElement('AlreadyClaimedTaxInclusiveAmount', zero),
        xmlElement('DifferenceTaxableAmount', taxableAmount),
        xmlElement('DifferenceTaxAmount', taxAmount),
        xmlElement('DifferenceTaxInclusiveAmount', taxInclusive),
        `<TaxCategory>${xmlElement('Percent', formatDecimal(group.vatRatePercent))}${xmlElement(
          'TaxScheme',
          'VAT',
        )}</TaxCategory>`,
        '</TaxSubTotal>',
      ].join('');
    })
    .join('');

  const totalTax = roundMoney(groups.reduce((sum, group) => sum + group.taxAmount, 0));

  return `<TaxTotal>${taxSubTotals}${xmlElement('TaxAmount', formatAmount(totalTax))}</TaxTotal>`;
}

// ---------------------------------------------------------------------------
// LegalMonetaryTotal
// ---------------------------------------------------------------------------

/**
 * VERIFIED against `LegalMonetaryTotalType`: `TaxExclusiveAmount`,
 * `TaxInclusiveAmount`, `AlreadyClaimedTaxExclusiveAmount`,
 * `AlreadyClaimedTaxInclusiveAmount`, `DifferenceTaxExclusiveAmount`,
 * `DifferenceTaxInclusiveAmount`, `PaidDepositsAmount` and `PayableAmount`
 * are ALL required (no `minOccurs="0"`) — confirmed by reading the raw XSD,
 * this is easy to miss since these fields only make sense for advance-payment
 * scenarios.
 *
 * BEST-EFFORT: `IsdocInvoiceInput` has no concept of advance payments/deposits
 * already claimed on this invoice, so `AlreadyClaimedTax*Amount` and
 * `PaidDepositsAmount` are emitted as `0`, and `DifferenceTax*Amount` (defined
 * by the schema doc as "difference between precept and already claimed") is
 * therefore equal to `TaxExclusiveAmount`/`TaxInclusiveAmount` respectively.
 * This is a logical inference from the field semantics (nothing already
 * claimed => the difference is the full amount), not a directly-documented
 * rule, so it's flagged as best-effort even though it's the only value that
 * makes arithmetic sense for a non-advance invoice.
 */
function buildLegalMonetaryTotalXml(totals: IsdocTotals): string {
  const taxExclusive = formatAmount(totals.totalWithoutVat);
  const taxInclusive = formatAmount(roundMoney(totals.totalWithoutVat + totals.totalVat));
  const zero = formatAmount(0);

  return [
    '<LegalMonetaryTotal>',
    xmlElement('TaxExclusiveAmount', taxExclusive),
    xmlElement('TaxInclusiveAmount', taxInclusive),
    xmlElement('AlreadyClaimedTaxExclusiveAmount', zero),
    xmlElement('AlreadyClaimedTaxInclusiveAmount', zero),
    xmlElement('DifferenceTaxExclusiveAmount', taxExclusive),
    xmlElement('DifferenceTaxInclusiveAmount', taxInclusive),
    ...(totals.roundingAmount !== undefined
      ? [xmlElement('PayableRoundingAmount', formatAmount(totals.roundingAmount))]
      : []),
    xmlElement('PaidDepositsAmount', zero),
    xmlElement('PayableAmount', formatAmount(totals.totalWithVat)),
    '</LegalMonetaryTotal>',
  ].join('');
}

// ---------------------------------------------------------------------------
// PaymentMeans
// ---------------------------------------------------------------------------

/**
 * Minimal, dependency-free re-implementation of the domestic CZ account
 * number parser (`[prefix-]number/bankCode`) so this module doesn't need a
 * cross-file dependency for one regex. Kept intentionally identical in shape
 * to `parseCzechBankAccount` in `bank-account-validator.ts`.
 */
function parseDomesticAccountNumber(accountNumber: string): { localId: string; bankCode: string } | null {
  const match = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(accountNumber.trim());
  if (!match) {
    return null;
  }
  const [, prefix, number, bankCode] = match;
  return { localId: prefix ? `${prefix}-${number}` : number!, bankCode: bankCode! };
}

/**
 * VERIFIED against `PaymentMeansType` (required `Payment`, 1..unbounded) and
 * `PaymentType` (required `PaidAmount` + `PaymentMeansCode`, optional
 * `Details`). VERIFIED against `DetailsType`'s money-transfer branch: the
 * `<xs:choice>` alternative for bank transfer requires (in order)
 * `PaymentDueDate`, the `BankAccount` group (`ID`, `BankCode`, `Name`,
 * `IBAN`, `BIC` — ALL required, confirmed from the raw XSD group
 * definition), then optional `VariableSymbol`/`ConstantSymbol`/`SpecificSymbol`.
 *
 * Notably, `PaymentDueDate` — i.e. the invoice's due date — ONLY exists
 * inside this money-transfer `Details` branch. There is no other place in
 * the whole `Invoice` schema to record a due date (confirmed by grepping the
 * full XSD for "DueDate"). That means: if we can't fully populate the
 * `BankAccount` group (all 5 fields), the due date cannot be represented in
 * ISDOC at all for this payment — this is a real, confirmed constraint of
 * the format, not an oversight in this implementation.
 *
 * BEST-EFFORT scope decision: this generator only builds the full
 * bank-transfer `Details` block when `bankAccount.accountNumber` is a
 * parseable domestic (`[prefix-]number/bankCode`) account AND both `iban`
 * and `bic` are supplied (bank `Name` falls back to an empty string if
 * `bankName` is missing, which is schema-valid). If any of those are
 * missing/unparseable — e.g. a foreign-only account with just an IBAN/BIC
 * and no domestic account number — `PaymentMeans` is omitted entirely
 * (it's optional at the `Invoice` level) rather than fabricating a bank
 * code or IBAN. Callers that need the due date represented in ISDOC for a
 * foreign-only account will need a future enhancement (e.g. deriving the
 * domestic-format fields from IBAN) that's out of scope here.
 */
function buildPaymentMeansXml(input: IsdocInvoiceInput): string {
  const account = input.bankAccount;
  if (!account?.accountNumber || !account.iban || !account.bic) {
    return '';
  }

  const parsed = parseDomesticAccountNumber(account.accountNumber);
  if (!parsed) {
    return '';
  }

  const bankAccountGroup = [
    xmlElement('ID', escapeXml(parsed.localId)),
    xmlElement('BankCode', escapeXml(parsed.bankCode)),
    xmlElement('Name', escapeXml(account.bankName ?? '')),
    xmlElement('IBAN', escapeXml(account.iban.replace(/\s+/g, '').toUpperCase())),
    xmlElement('BIC', escapeXml(account.bic.replace(/\s+/g, '').toUpperCase())),
  ].join('');

  const details = [
    xmlElement('PaymentDueDate', toIsdocDate(input.dueDate)),
    bankAccountGroup,
    xmlElementIfDefined('VariableSymbol', input.variableSymbol),
  ].join('');

  const payment = [
    '<Payment>',
    xmlElement('PaidAmount', formatAmount(input.totals.totalWithVat)),
    xmlElement('PaymentMeansCode', String(PAYMENT_MEANS_CODE_BANK_TRANSFER)),
    `<Details>${details}</Details>`,
    '</Payment>',
  ].join('');

  return `<PaymentMeans>${payment}</PaymentMeans>`;
}

// ---------------------------------------------------------------------------
// Top-level generator
// ---------------------------------------------------------------------------

/**
 * BEST-EFFORT: `ElectronicPossibilityAgreementReference` ("reference to
 * agreement about acceptance of electronic invoices") is REQUIRED by the
 * schema (no `minOccurs="0"` on the `Invoice` element) — Czech VAT law
 * requires the recipient's consent to receive electronic invoices, and this
 * field is meant to reference that specific agreement. `IsdocInvoiceInput`
 * has no field for it (consent is presumably tracked elsewhere, e.g. at
 * customer/contact creation time in the blueprint's `contacts` table), so
 * this generator emits a generic boilerplate note instead of a real
 * reference. This is a known gap: a production system should thread the
 * actual consent record reference through here if one exists.
 */
const ELECTRONIC_INVOICE_AGREEMENT_PLACEHOLDER =
  'Odberatel souhlasi s vystavenim a zaslanim faktury v elektronicke podobe.';

/**
 * Generates an ISDOC 6.0.2-compliant XML string for the given invoice.
 *
 * @throws {Error} if `lineItems` is empty (an ISDOC invoice with zero lines
 * is not a meaningful document — `InvoiceLinesType.InvoiceLine` requires
 * `maxOccurs="unbounded"` but implicitly at least one real invoice line is
 * expected in practice, and an empty `<InvoiceLines/>` would also make the
 * VAT recapitulation vacuous). Also throws if `totals`/`totals.vatRecapitulation`
 * are arithmetically inconsistent with `lineItems` — see
 * `validateTotalsConsistency`.
 */
export function generateIsdocXml(input: IsdocInvoiceInput): string {
  if (!input.lineItems || input.lineItems.length === 0) {
    throw new Error('generateIsdocXml: at least one line item is required');
  }

  const vatGroups = computeVatRecapitulation(input.lineItems);
  validateTotalsConsistency(vatGroups, input.totals);

  const vatApplicable = input.supplier.isVatPayer ?? vatGroups.some((group) => group.vatRatePercent > 0);

  const noteParts = [input.note, input.orderNumber ? `Objednavka: ${input.orderNumber}` : undefined].filter(
    (part): part is string => Boolean(part),
  );

  const invoiceLines = input.lineItems.map((item, index) => buildInvoiceLineXml(item, index)).join('');

  const body = [
    xmlElement('DocumentType', String(DOCUMENT_TYPE_INVOICE)),
    xmlElement('ID', escapeXml(input.invoiceNumber)),
    xmlElement('UUID', globalThis.crypto.randomUUID()),
    xmlElement('IssueDate', toIsdocDate(input.issueDate)),
    xmlElement('TaxPointDate', toIsdocDate(input.taxableSupplyDate)),
    xmlElement('VATApplicable', vatApplicable ? 'true' : 'false'),
    xmlElement('ElectronicPossibilityAgreementReference', escapeXml(ELECTRONIC_INVOICE_AGREEMENT_PLACEHOLDER)),
    noteParts.length > 0 ? xmlElement('Note', escapeXml(noteParts.join('; '))) : '',
    xmlElement('LocalCurrencyCode', escapeXml(input.currency)),
    xmlElement('CurrRate', formatDecimal(1)),
    xmlElement('RefCurrRate', formatDecimal(1)),
    `<AccountingSupplierParty>${buildPartyXml(input.supplier)}</AccountingSupplierParty>`,
    `<AccountingCustomerParty>${buildPartyXml(input.customer)}</AccountingCustomerParty>`,
    `<InvoiceLines>${invoiceLines}</InvoiceLines>`,
    buildTaxTotalXml(vatGroups),
    buildLegalMonetaryTotalXml(input.totals),
    buildPaymentMeansXml(input),
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="${ISDOC_NAMESPACE}" version="${ISDOC_VERSION}">${body}</Invoice>`;
}
