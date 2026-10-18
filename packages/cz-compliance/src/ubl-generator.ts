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
}

/**
 * Peppol electronic address scheme (EAS) for a VAT number, by its country
 * prefix. Peppol participants are commonly registered under their VAT
 * number; parties without one get no `EndpointID` and the access point has
 * to supply it.
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
  SK: '9950',
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
  const eas = vat ? VAT_EAS[vat.slice(0, 2)] : undefined;
  const endpoint = vat && eas ? `<cbc:EndpointID schemeID="${eas}">${escapeXml(vat)}</cbc:EndpointID>` : '';
  const registered = party.ico ? `<cac:PartyIdentification>${el('cbc:ID', escapeXml(party.ico))}</cac:PartyIdentification>` : '';
  // Category O ("not subject to VAT", a supplier that isn't a VAT payer)
  // forbids both the seller's and the buyer's VAT identifier (BR-O-02).
  const taxScheme =
    vat && supplierIsVatPayer && (party.isVatPayer || !isSupplier)
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
 * Builds a Peppol BIS Billing 3.0 UBL invoice. Throws when there are no line
 * items (BR-16).
 */
export function generateUblInvoiceXml(input: IsdocInvoiceInput, options: UblOptions = {}): string {
  if (!input.lineItems || input.lineItems.length === 0) {
    throw new Error('generateUblInvoiceXml: at least one line item is required');
  }
  const currency = input.currency;
  const vatPayer = input.supplier.isVatPayer ?? input.lineItems.some((l) => l.vatRatePercent > 0);

  const categoryOf = (ratePercent: number): Category => {
    if (!vatPayer) return { id: 'O', percent: 0, exemption: 'Not subject to VAT' };
    if (options.reverseCharge) return { id: 'AE', percent: 0, exemption: 'Reverse charge' };
    if (ratePercent === 0) return { id: 'Z', percent: 0 };
    return { id: 'S', percent: ratePercent };
  };

  const lines = input.lineItems.map((item, index) => {
    const category = categoryOf(item.vatRatePercent);
    const net = round2(item.quantity * item.unitPriceWithoutVat);
    return { item, index, category, net };
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
  const roundingDiff = round2(input.totals.totalWithVat - inclusive);
  const rounding = roundingDiff !== 0 && Math.abs(roundingDiff) < 1 ? roundingDiff : 0;
  const prepaid = round2(Math.max(0, options.prepaidAmount ?? 0));
  const payable = round2(inclusive + rounding - prepaid);

  const notes = [input.note, input.variableSymbol ? `VS: ${input.variableSymbol}` : undefined].filter((n): n is string => Boolean(n));

  const account = input.bankAccount;
  const accountId = account?.iban?.replace(/\s+/g, '') || account?.accountNumber;
  const paymentMeans =
    '<cac:PaymentMeans>' +
    el('cbc:PaymentMeansCode', account?.iban ? '58' : '30') +
    opt('cbc:PaymentID', input.variableSymbol) +
    (accountId
      ? '<cac:PayeeFinancialAccount>' +
        el('cbc:ID', escapeXml(accountId)) +
        opt('cbc:Name', account?.bankName) +
        (account?.bic ? `<cac:FinancialInstitutionBranch>${el('cbc:ID', escapeXml(account.bic))}</cac:FinancialInstitutionBranch>` : '') +
        '</cac:PayeeFinancialAccount>'
      : '') +
    '</cac:PaymentMeans>';

  const invoiceLines = lines
    .map(
      ({ item, index, category, net }) =>
        '<cac:InvoiceLine>' +
        el('cbc:ID', String(index + 1)) +
        `<cbc:InvoicedQuantity unitCode="${ublUnitCode(item.unit)}">${Math.round(item.quantity * 10000) / 10000}</cbc:InvoicedQuantity>` +
        amountEl('cbc:LineExtensionAmount', net, currency) +
        '<cac:Item>' +
        el('cbc:Name', escapeXml(item.description.slice(0, 200) || '-')) +
        categoryXml('cac:ClassifiedTaxCategory', category) +
        '</cac:Item>' +
        `<cac:Price><cbc:PriceAmount currencyID="${escapeXml(currency)}">${Math.round(item.unitPriceWithoutVat * 10000) / 10000}</cbc:PriceAmount></cac:Price>` +
        '</cac:InvoiceLine>'
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

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
    'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">' +
    el('cbc:CustomizationID', PEPPOL_CUSTOMIZATION_ID) +
    el('cbc:ProfileID', PEPPOL_PROFILE_ID) +
    el('cbc:ID', escapeXml(input.invoiceNumber)) +
    el('cbc:IssueDate', date(input.issueDate)) +
    el('cbc:DueDate', date(input.dueDate)) +
    el('cbc:InvoiceTypeCode', '380') +
    notes.map((n) => el('cbc:Note', escapeXml(n))).join('') +
    (vatPayer ? el('cbc:TaxPointDate', date(input.taxableSupplyDate)) : '') +
    el('cbc:DocumentCurrencyCode', escapeXml(currency)) +
    // Peppol requires a buyer reference or an order reference (PEPPOL-EN16931-R003).
    el('cbc:BuyerReference', escapeXml(input.orderNumber || input.invoiceNumber)) +
    (input.orderNumber ? `<cac:OrderReference>${el('cbc:ID', escapeXml(input.orderNumber))}</cac:OrderReference>` : '') +
    `<cac:AccountingSupplierParty>${partyXml(input.supplier, true, vatPayer)}</cac:AccountingSupplierParty>` +
    `<cac:AccountingCustomerParty>${partyXml(input.customer, false, vatPayer)}</cac:AccountingCustomerParty>` +
    paymentMeans +
    taxTotalXml +
    monetary +
    invoiceLines +
    '</Invoice>'
  );
}

export interface PeppolIssue {
  /** EN 16931 / Peppol BIS rule id, e.g. "BR-06" or "PEPPOL-EN16931-R020". */
  rule: string;
  /** Which part of the invoice the rule is about. */
  field: 'supplier' | 'customer' | 'lines' | 'payment' | 'currency';
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
    if (!vat || !VAT_EAS[vat.slice(0, 2)]) add(endpointRule, field, 'endpointMissing');
  }

  if (vatPayer && !vatNumber(input.supplier)) add(options.reverseCharge ? 'BR-AE-02' : 'BR-S-02', 'supplier', 'vatMissing');
  if (vatPayer && options.reverseCharge && !vatNumber(input.customer)) add('BR-AE-02', 'customer', 'vatMissing');

  if (!input.lineItems?.length) add('BR-16', 'lines', 'noLines');
  else if (input.lineItems.some((l) => !l.description?.trim())) add('BR-25', 'lines', 'lineNameMissing', 'warning');

  if (!/^[A-Z]{3}$/.test(input.currency ?? '')) add('BR-05', 'currency', 'currencyInvalid');
  if (!input.bankAccount?.iban && !input.bankAccount?.accountNumber) add('BR-49', 'payment', 'noAccount', 'warning');
  else if (!input.bankAccount?.iban) add('BR-61', 'payment', 'noIban', 'warning');
  return issues;
}
