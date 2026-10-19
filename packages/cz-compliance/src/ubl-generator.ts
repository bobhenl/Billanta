/**
 * UBL 2.1 invoice in the Peppol BIS Billing 3.0 profile (EN 16931).
 *
 * Slovakia makes structured e-invoices mandatory for domestic B2B supplies
 * from 1 January 2027, exchanged over Peppol. This builds the XML from the
 * same `IsdocInvoiceInput` the ISDOC export uses, so both formats always come
 * from the same data.
 *
 * Amounts are recomputed from the line items (line → VAT group → document),
 * because EN 16931's business rules (BR-CO-10 … BR-CO-15) check that the
 * document totals equal the sums of their parts to the cent. A difference
 * between that and the caller's `totals.totalWithVat` under one unit of the
 * currency is reported as `PayableRoundingAmount` (cash rounding).
 *
 * Slovak parties are addressed as `0245:<DIČ>`, the scheme the Financial
 * Administration uses for the domestic Peppol network, and their IČ DPH goes
 * into PartyTaxScheme (FR SR FAQ eFaktúra 9/DPH/2025/IM, example 23). A
 * credit note is a UBL CreditNote (381) that references the original invoice
 * (BT-25): this is the correction the FR SR recommends while code 384 is not
 * allowed (FAQ example 30). See docs/sk-einvoicing-2027.md.
 *
 * Sending the file over Peppol needs an access point; this module only
 * produces the document.
 */
import { escapeXml, type IsdocAddress, type IsdocInvoiceInput, type IsdocParty } from './isdoc-generator.js';

export const PEPPOL_CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
export const PEPPOL_PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

export interface UblOptions {
  /** Reverse charge ("přenesení daňové povinnosti"): every line goes to tax category AE with 0 % VAT. */
  reverseCharge?: boolean;
  /** Amount already paid (advance), reported as `PrepaidAmount`. */
  prepaidAmount?: number;
  /**
   * `credit_note` writes a UBL CreditNote (type 381). The dashboard stores a
   * credit note's lines with negative quantities. We flip them so the
   * credited amounts are positive, which is the form Peppol expects.
   */
  documentType?: 'invoice' | 'credit_note';
  /**
   * The invoice this document corrects: BT-25 holds its number and BT-26 its
   * issue date. The FR SR asks for it on corrections already in 2027 (FAQ
   * eFaktúra, example 30). From 1 July 2030 it is a mandatory field
   * (§ 74 ods. 1 p) ZoDPH).
   */
  precedingInvoice?: { number: string; issueDate?: string };
}

/**
 * Peppol electronic address scheme (EAS) for a VAT number, by its country
 * prefix. Peppol participants are commonly registered under their VAT
 * number; parties without one get no `EndpointID` and the access point has
 * to supply it. Slovakia is left out on purpose: Slovak parties use 0245
 * with the DIČ (see `peppolEndpoint`), not 9950 with the IČ DPH.
 */
const VAT_EAS: Record<string, string> = {
  AT: '9914',
  BE: '9925',
  BG: '9926',
  CY: '9928',
  CZ: '9929',
  DE: '9930',
  EE: '9931',
  GR: '9933',
  EL: '9933',
  HR: '9934',
  IE: '9935',
  LT: '9937',
  LU: '9938',
  LV: '9939',
  MT: '9943',
  NL: '9944',
  PL: '9945',
  PT: '9946',
  RO: '9947',
  SI: '9949',
  HU: '9910',
  IT: '0211',
  FR: '9957',
  ES: '9920',
  SE: '9955',
  DK: '0198',
  FI: '0213'
};

/** Czech/Slovak unit abbreviations → UN/ECE Recommendation 20 codes. Unknown units fall back to C62 ("one"). */
const UNIT_CODES: Record<string, string> = {
  ks: 'H87',
  kus: 'H87',
  kusy: 'H87',
  pcs: 'H87',
  pc: 'H87',
  hod: 'HUR',
  h: 'HUR',
  hodina: 'HUR',
  hour: 'HUR',
  hours: 'HUR',
  min: 'MIN',
  den: 'DAY',
  dni: 'DAY',
  dní: 'DAY',
  deň: 'DAY',
  day: 'DAY',
  days: 'DAY',
  měs: 'MON',
  mes: 'MON',
  měsíc: 'MON',
  mesiac: 'MON',
  month: 'MON',
  rok: 'ANN',
  year: 'ANN',
  kg: 'KGM',
  g: 'GRM',
  t: 'TNE',
  m: 'MTR',
  km: 'KMT',
  m2: 'MTK',
  'm²': 'MTK',
  m3: 'MTQ',
  'm³': 'MTQ',
  l: 'LTR',
  bal: 'XPK',
  kpl: 'SET',
  sada: 'SET',
  set: 'SET',
  kwh: 'KWH'
};

export function ublUnitCode(unit: string | undefined): string {
  if (!unit) return 'H87';
  return UNIT_CODES[unit.trim().toLowerCase().replace(/\.$/, '')] ?? 'C62';
}

function round2(amount: number): number {
  return Math.round((amount + Math.sign(amount) * Number.EPSILON) * 100) / 100;
}

function money(amount: number, currency: string): string {
  return `currencyID="${escapeXml(currency)}">${round2(amount).toFixed(2)}`;
}

function el(tag: string, content: string): string {
  return `<${tag}>${content}</${tag}>`;
}

function opt(tag: string, value: string | undefined): string {
  return value ? el(tag, escapeXml(value)) : '';
}

function amountEl(tag: string, amount: number, currency: string): string {
  return `<${tag} ${money(amount, currency)}</${tag}>`;
}

function date(value: string): string {
  return value.slice(0, 10);
}

/**
 * A quantity or unit price in plain decimal notation (xs:decimal has no
 * exponent form). It keeps up to 10 decimals: EN 16931 sets no limit for
 * BT-129 and BT-146, and Peppol checks each line's net amount against
 * quantity × price within 0.02 (PEPPOL-EN16931-R120), so rounding a fine
 * price such as 0.123456 €/kWh to four places would break that check.
 */
function decimal(value: number): string {
  const fixed = value.toFixed(10).replace(/\.?0+$/, '');
  return fixed === '-0' ? '0' : fixed;
}

/** Percent without trailing zeros, e.g. 21, 12.5. */
function percent(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** VAT number with the country prefix (CZ12345678); a bare number gets the address country's prefix. */
function vatNumber(party: IsdocParty): string | undefined {
  const raw = party.dic?.replace(/\s+/g, '').toUpperCase();
  if (!raw) return undefined;
  return /^[A-Z]{2}/.test(raw) ? raw : `${party.address.countryCode.toUpperCase()}${raw}`;
}

/**
 * The 10-digit Slovak DIČ of a party. It is either the bare DIČ or the
 * IČ DPH without its prefix, since an IČ DPH is "SK" followed by the DIČ.
 */
export function skDic(party: Pick<IsdocParty, 'dic'>): string | undefined {
  const digits = party.dic?.replace(/\s+/g, '').toUpperCase().replace(/^SK/, '');
  return digits && /^\d{10}$/.test(digits) ? digits : undefined;
}

const isSlovak = (party: IsdocParty) =>
  party.address?.countryCode?.trim().toUpperCase() === 'SK' || /^SK/i.test(party.dic?.trim() ?? '');

/**
 * Peppol participant identifier of a party as `{ scheme, id }`, or
 * undefined when we can't derive one. A Slovak party gets 0245 plus its
 * DIČ, the scheme every Slovak e-invoicing participant is registered under,
 * non-VAT payers included. Any other party gets its VAT number under the
 * country's EAS code.
 */
export function peppolEndpoint(party: IsdocParty): { scheme: string; id: string } | undefined {
  if (isSlovak(party)) {
    const dic = skDic(party);
    return dic ? { scheme: '0245', id: dic } : undefined;
  }
  const vat = vatNumber(party);
  const eas = vat ? VAT_EAS[vat.slice(0, 2)] : undefined;
  return vat && eas ? { scheme: eas, id: vat } : undefined;
}

function addressXml(address: IsdocAddress): string {
  const street = [address.street, address.houseNumber].filter(Boolean).join(' ');
  return (
    '<cac:PostalAddress>' +
    opt('cbc:StreetName', street) +
    opt('cbc:CityName', address.city) +
    opt('cbc:PostalZone', address.postalCode) +
    `<cac:Country>${el('cbc:IdentificationCode', escapeXml(address.countryCode.toUpperCase()))}</cac:Country>` +
    '</cac:PostalAddress>'
  );
}

function partyXml(party: IsdocParty, isSupplier: boolean, supplierIsVatPayer: boolean): string {
  const vat = vatNumber(party);
  const peppol = peppolEndpoint(party);
  const endpoint = peppol ? `<cbc:EndpointID schemeID="${peppol.scheme}">${escapeXml(peppol.id)}</cbc:EndpointID>` : '';
  const registered = party.ico ? `<cac:PartyIdentification>${el('cbc:ID', escapeXml(party.ico))}</cac:PartyIdentification>` : '';
  // Category O ("not subject to VAT", a supplier that isn't a VAT payer)
  // forbids both the seller's and the buyer's VAT identifier (BR-O-02).
  // A buyer known not to be a VAT payer has a DIČ but no IČ DPH, so we
  // don't turn that DIČ into one.
  const taxScheme =
    vat && supplierIsVatPayer && (isSupplier ? party.isVatPayer : party.isVatPayer !== false)
      ? `<cac:PartyTaxScheme>${el('cbc:CompanyID', escapeXml(vat))}<cac:TaxScheme>${el('cbc:ID', 'VAT')}</cac:TaxScheme></cac:PartyTaxScheme>`
      : '';
  const legal =
    '<cac:PartyLegalEntity>' +
    el('cbc:RegistrationName', escapeXml(party.legalName)) +
    opt('cbc:CompanyID', party.ico) +
    '</cac:PartyLegalEntity>';
  // UBL ContactType order: ID, Name, Telephone, Telefax, ElectronicMail.
  const contact =
    party.contactName || party.email || party.phone
      ? `<cac:Contact>${opt('cbc:Name', party.contactName)}${opt('cbc:Telephone', party.phone)}${opt('cbc:ElectronicMail', party.email)}</cac:Contact>`
      : '';
  return (
    '<cac:Party>' +
    endpoint +
    registered +
    `<cac:PartyName>${el('cbc:Name', escapeXml(party.legalName))}</cac:PartyName>` +
    addressXml(party.address) +
    taxScheme +
    legal +
    contact +
    '</cac:Party>'
  );
}

interface Category {
  id: 'S' | 'Z' | 'AE' | 'O';
  percent: number;
  exemption?: string;
}

function categoryXml(tag: 'cac:TaxCategory' | 'cac:ClassifiedTaxCategory', c: Category): string {
  return (
    `<${tag}>` +
    el('cbc:ID', c.id) +
    (c.id === 'O' ? '' : el('cbc:Percent', percent(c.percent))) +
    (tag === 'cac:TaxCategory' && c.exemption ? el('cbc:TaxExemptionReason', escapeXml(c.exemption)) : '') +
    `<cac:TaxScheme>${el('cbc:ID', 'VAT')}</cac:TaxScheme>` +
    `</${tag}>`
  );
}

/**
 * Builds a Peppol BIS Billing 3.0 UBL invoice, or a credit note when
 * `options.documentType` asks for one. Throws when there are no line items
 * (BR-16).
 */
export function generateUblInvoiceXml(input: IsdocInvoiceInput, options: UblOptions = {}): string {
  if (!input.lineItems || input.lineItems.length === 0) {
    throw new Error('generateUblInvoiceXml: at least one line item is required');
  }
  const creditNote = options.documentType === 'credit_note';
  const currency = input.currency;
  const rawNet = input.lineItems.reduce((sum, l) => sum + l.quantity * l.unitPriceWithoutVat, 0);
  const sign = creditNote && rawNet < 0 ? -1 : 1;
  const vatPayer = input.supplier.isVatPayer ?? input.lineItems.some((l) => l.vatRatePercent > 0);

  const categoryOf = (ratePercent: number): Category => {
    if (!vatPayer) return { id: 'O', percent: 0, exemption: 'Not subject to VAT' };
    if (options.reverseCharge) return { id: 'AE', percent: 0, exemption: 'Reverse charge' };
    if (ratePercent === 0) return { id: 'Z', percent: 0 };
    return { id: 'S', percent: ratePercent };
  };

  const lines = input.lineItems.map((item, index) => {
    const category = categoryOf(item.vatRatePercent);
    // The item net price must not be negative (BR-27), so a discount typed
    // as a line with a negative price becomes a negative quantity at a
    // positive price. The line amount stays the same.
    const priceSign = item.unitPriceWithoutVat < 0 ? -1 : 1;
    const price = priceSign * item.unitPriceWithoutVat;
    const quantity = sign * priceSign * item.quantity;
    const net = round2(quantity * price);
    return { item, index, category, quantity, price, net };
  });

  const groups = new Map<string, { category: Category; taxable: number }>();
  for (const line of lines) {
    const key = `${line.category.id}:${line.category.percent}`;
    const group = groups.get(key) ?? { category: line.category, taxable: 0 };
    group.taxable = round2(group.taxable + line.net);
    groups.set(key, group);
  }
  const subtotals = [...groups.values()].map((g) => ({ ...g, tax: round2((g.taxable * g.category.percent) / 100) }));

  const lineTotal = round2(lines.reduce((sum, l) => sum + l.net, 0));
  const taxTotal = round2(subtotals.reduce((sum, s) => sum + s.tax, 0));
  const inclusive = round2(lineTotal + taxTotal);
  const roundingDiff = round2(sign * input.totals.totalWithVat - inclusive);
  const rounding = roundingDiff !== 0 && Math.abs(roundingDiff) < 1 ? roundingDiff : 0;
  const prepaid = round2(Math.max(0, options.prepaidAmount ?? 0));
  const payable = round2(inclusive + rounding - prepaid);

  // Peppol allows a single document-level note (PEPPOL-EN16931-R002), so
  // the free text and the variable symbol share one.
  const note = [input.note, input.variableSymbol ? `VS: ${input.variableSymbol}` : undefined].filter(Boolean).join('\n');

  const account = input.bankAccount;
  const accountId = account?.iban?.replace(/\s+/g, '') || account?.accountNumber;
  const paymentMeans =
    '<cac:PaymentMeans>' +
    el('cbc:PaymentMeansCode', account?.iban ? '58' : '30') +
    // A UBL 2.1 CreditNote has no DueDate in its header, so BT-9 goes here.
    (creditNote ? el('cbc:PaymentDueDate', date(input.dueDate)) : '') +
    opt('cbc:PaymentID', input.variableSymbol) +
    (accountId
      ? '<cac:PayeeFinancialAccount>' +
        el('cbc:ID', escapeXml(accountId)) +
        opt('cbc:Name', account?.bankName) +
        (account?.bic ? `<cac:FinancialInstitutionBranch>${el('cbc:ID', escapeXml(account.bic))}</cac:FinancialInstitutionBranch>` : '') +
        '</cac:PayeeFinancialAccount>'
      : '') +
    '</cac:PaymentMeans>';

  const lineTag = creditNote ? 'CreditNoteLine' : 'InvoiceLine';
  const quantityTag = creditNote ? 'CreditedQuantity' : 'InvoicedQuantity';
  const invoiceLines = lines
    .map(
      ({ item, index, category, quantity, price, net }) =>
        `<cac:${lineTag}>` +
        el('cbc:ID', String(index + 1)) +
        `<cbc:${quantityTag} unitCode="${ublUnitCode(item.unit)}">${decimal(quantity)}</cbc:${quantityTag}>` +
        amountEl('cbc:LineExtensionAmount', net, currency) +
        '<cac:Item>' +
        el('cbc:Name', escapeXml(item.description.slice(0, 200) || '-')) +
        categoryXml('cac:ClassifiedTaxCategory', category) +
        '</cac:Item>' +
        `<cac:Price><cbc:PriceAmount currencyID="${escapeXml(currency)}">${decimal(price)}</cbc:PriceAmount></cac:Price>` +
        `</cac:${lineTag}>`
    )
    .join('');

  const taxTotalXml =
    '<cac:TaxTotal>' +
    amountEl('cbc:TaxAmount', taxTotal, currency) +
    subtotals
      .map(
        (s) =>
          '<cac:TaxSubtotal>' +
          amountEl('cbc:TaxableAmount', s.taxable, currency) +
          amountEl('cbc:TaxAmount', s.tax, currency) +
          categoryXml('cac:TaxCategory', s.category) +
          '</cac:TaxSubtotal>'
      )
      .join('') +
    '</cac:TaxTotal>';

  const monetary =
    '<cac:LegalMonetaryTotal>' +
    amountEl('cbc:LineExtensionAmount', lineTotal, currency) +
    amountEl('cbc:TaxExclusiveAmount', lineTotal, currency) +
    amountEl('cbc:TaxInclusiveAmount', inclusive, currency) +
    (prepaid ? amountEl('cbc:PrepaidAmount', prepaid, currency) : '') +
    (rounding ? amountEl('cbc:PayableRoundingAmount', rounding, currency) : '') +
    amountEl('cbc:PayableAmount', payable, currency) +
    '</cac:LegalMonetaryTotal>';

  const preceding = options.precedingInvoice;
  const billingReference = preceding?.number
    ? '<cac:BillingReference><cac:InvoiceDocumentReference>' +
      el('cbc:ID', escapeXml(preceding.number)) +
      (preceding.issueDate ? el('cbc:IssueDate', date(preceding.issueDate)) : '') +
      '</cac:InvoiceDocumentReference></cac:BillingReference>'
    : '';
  const root = creditNote ? 'CreditNote' : 'Invoice';
  const taxPoint = vatPayer ? el('cbc:TaxPointDate', date(input.taxableSupplyDate)) : '';
  const noteXml = opt('cbc:Note', note);
  // The two UBL 2.1 roots order their headers differently. An Invoice has
  // DueDate, the type code, notes, then TaxPointDate. A CreditNote puts
  // TaxPointDate before its type code and has no DueDate.
  const header = creditNote
    ? taxPoint + el('cbc:CreditNoteTypeCode', '381') + noteXml
    : el('cbc:DueDate', date(input.dueDate)) + el('cbc:InvoiceTypeCode', '380') + noteXml + taxPoint;

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" ` +
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
    'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">' +
    el('cbc:CustomizationID', PEPPOL_CUSTOMIZATION_ID) +
    el('cbc:ProfileID', PEPPOL_PROFILE_ID) +
    el('cbc:ID', escapeXml(input.invoiceNumber)) +
    el('cbc:IssueDate', date(input.issueDate)) +
    header +
    el('cbc:DocumentCurrencyCode', escapeXml(currency)) +
    // Peppol requires a buyer reference or an order reference (PEPPOL-EN16931-R003).
    el('cbc:BuyerReference', escapeXml(input.orderNumber || input.invoiceNumber)) +
    (input.orderNumber ? `<cac:OrderReference>${el('cbc:ID', escapeXml(input.orderNumber))}</cac:OrderReference>` : '') +
    billingReference +
    `<cac:AccountingSupplierParty>${partyXml(input.supplier, true, vatPayer)}</cac:AccountingSupplierParty>` +
    `<cac:AccountingCustomerParty>${partyXml(input.customer, false, vatPayer)}</cac:AccountingCustomerParty>` +
    paymentMeans +
    taxTotalXml +
    monetary +
    invoiceLines +
    `</${root}>`
  );
}

export interface PeppolIssue {
  /** EN 16931 / Peppol BIS rule id, e.g. "BR-06" or "PEPPOL-EN16931-R020". */
  rule: string;
  /** Which part of the invoice the rule is about. */
  field: 'supplier' | 'customer' | 'lines' | 'payment' | 'currency' | 'document';
  /** Machine key for the UI text. */
  code: string;
  /** "error" fails Peppol validation at the access point; "warning" usually passes but is worth fixing. */
  severity: 'error' | 'warning';
}

/**
 * Pre-flight check of the Peppol BIS 3.0 rules that depend on the invoice
 * data rather than on the generator: names, countries, VAT numbers,
 * electronic addresses. It is not a full schematron run; the generator
 * already handles the structural rules.
 */
export function validatePeppolInvoice(input: IsdocInvoiceInput, options: UblOptions = {}): PeppolIssue[] {
  const issues: PeppolIssue[] = [];
  const add = (rule: string, field: PeppolIssue['field'], code: string, severity: PeppolIssue['severity'] = 'error') =>
    issues.push({ rule, field, code, severity });
  const vatPayer = input.supplier.isVatPayer ?? input.lineItems.some((l) => l.vatRatePercent > 0);

  for (const [party, field, nameRule, countryRule, endpointRule] of [
    [input.supplier, 'supplier', 'BR-06', 'BR-09', 'PEPPOL-EN16931-R020'],
    [input.customer, 'customer', 'BR-07', 'BR-11', 'PEPPOL-EN16931-R010']
  ] as const) {
    if (!party.legalName?.trim()) add(nameRule, field, 'nameMissing');
    const country = party.address?.countryCode?.trim().toUpperCase() ?? '';
    if (!/^[A-Z]{2}$/.test(country)) add(countryRule, field, 'countryMissing');
    if (!party.address?.city?.trim() || !party.address?.street?.trim()) add('BR-08', field, 'addressIncomplete', 'warning');
    const vat = vatNumber(party);
    if (vat && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vat)) add('BR-CO-09', field, 'vatInvalid');
    // A Slovak party is reached by its DIČ, so the DIČ is what has to be right.
    if (!peppolEndpoint(party)) add(endpointRule, field, isSlovak(party) ? 'skDicMissing' : 'endpointMissing');
  }

  if (vatPayer && !vatNumber(input.supplier)) add(options.reverseCharge ? 'BR-AE-02' : 'BR-S-02', 'supplier', 'vatMissing');
  if (vatPayer && options.reverseCharge && !vatNumber(input.customer)) add('BR-AE-02', 'customer', 'vatMissing');

  if (!input.lineItems?.length) add('BR-16', 'lines', 'noLines');
  else if (input.lineItems.some((l) => !l.description?.trim())) add('BR-25', 'lines', 'lineNameMissing', 'warning');

  if (options.documentType === 'credit_note' && !options.precedingInvoice?.number) add('BT-25', 'document', 'precedingMissing');

  if (!/^[A-Z]{3}$/.test(input.currency ?? '')) add('BR-05', 'currency', 'currencyInvalid');
  if (!input.bankAccount?.iban && !input.bankAccount?.accountNumber) add('BR-49', 'payment', 'noAccount', 'warning');
  else if (!input.bankAccount?.iban) add('BR-61', 'payment', 'noIban', 'warning');
  return issues;
}
