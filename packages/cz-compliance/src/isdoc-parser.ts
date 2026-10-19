/**
 * ISDOC 6.x reader: XML text → a plain invoice object, the counterpart of
 * `generateIsdocXml`. Element names follow the same XSD
 * (https://isdoc.github.io/xsd/isdoc-invoice-6.0.2.xsd); older 5.x files use
 * the same names in the 2010 namespace and read the same way.
 *
 * Runs in the browser (the public ISDOC viewer parses the visitor's file
 * locally, nothing is uploaded) and in Node, so it brings its own small XML
 * reader instead of DOMParser. Namespace prefixes are ignored: ISDOC has a
 * single namespace and exporters differ in whether they prefix it.
 */

// ---------------------------------------------------------------------------
// Minimal XML reader
// ---------------------------------------------------------------------------

export interface XmlNode {
  /** Local name, without the namespace prefix. */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export class IsdocParseError extends Error {
  constructor(public readonly code: 'not_xml' | 'not_isdoc', message: string) {
    super(message);
    this.name = 'IsdocParseError';
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const localName = (qname: string) => qname.slice(qname.indexOf(':') + 1);

/** Parses well-formed XML elements, attributes, text, CDATA; skips the prolog, comments, PIs and the DOCTYPE. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const top = stack[stack.length - 1]!;
    if (lt === -1) {
      top.text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      top.text += xml.slice(lt + 9, end === -1 ? n : end);
      i = end === -1 ? n : end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
    } else if (xml.startsWith('<!', lt)) {
      // DOCTYPE (with an optional internal subset in brackets).
      let depth = 0;
      let j = lt + 2;
      for (; j < n; j++) {
        if (xml[j] === '[') depth++;
        else if (xml[j] === ']') depth--;
        else if (xml[j] === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt);
      if (end === -1) throw new IsdocParseError('not_xml', 'Unterminated closing tag');
      const name = localName(xml.slice(lt + 2, end).trim());
      if (stack.length < 2 || top.name !== name) throw new IsdocParseError('not_xml', `Unexpected </${name}>`);
      stack.pop();
      i = end + 1;
    } else {
      // Start tag: find its end outside quoted attribute values.
      let j = lt + 1;
      let quote = '';
      for (; j < n; j++) {
        const ch = xml[j];
        if (quote) {
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
      }
      if (j >= n) throw new IsdocParseError('not_xml', 'Unterminated start tag');
      let body = xml.slice(lt + 1, j);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const nameMatch = /^[^\s/>]+/.exec(body);
      if (!nameMatch) throw new IsdocParseError('not_xml', 'Empty tag name');
      const node: XmlNode = { name: localName(nameMatch[0]), attrs: {}, children: [], text: '' };
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      const rest = body.slice(nameMatch[0].length);
      for (let m = attrRe.exec(rest); m; m = attrRe.exec(rest)) node.attrs[localName(m[1]!)] = decodeEntities(m[3] ?? m[4] ?? '');
      top.children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new IsdocParseError('not_xml', `Unclosed <${stack[stack.length - 1]!.name}>`);
  return root;
}

const child = (node: XmlNode | undefined, name: string) => node?.children.find((c) => c.name === name);
const children = (node: XmlNode | undefined, name: string) => node?.children.filter((c) => c.name === name) ?? [];
/** Text at a path of child names ("Party/PartyName/Name"); trimmed, undefined when missing or empty. */
function text(node: XmlNode | undefined, path: string): string | undefined {
  let cur = node;
  for (const part of path.split('/')) cur = child(cur, part);
  const t = cur?.text.trim();
  return t ? t : undefined;
}
function num(node: XmlNode | undefined, path: string): number | undefined {
  const t = text(node, path);
  if (t === undefined) return undefined;
  const v = Number(t.replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
}

// ---------------------------------------------------------------------------
// ISDOC model
// ---------------------------------------------------------------------------

/**
 * `DocumentTypeType` of the ISDOC XSD:
 * 1 faktura – daňový doklad, 2 opravný daňový doklad (dobropis),
 * 3 opravný daňový doklad (vrubopis), 4 zálohová faktura (nedaňový zálohový list),
 * 5 daňový doklad k přijaté záloze, 6 opravný daňový doklad k přijaté záloze (dobropis),
 * 7 zjednodušený daňový doklad.
 */
export type IsdocDocumentKind = 'invoice' | 'credit_note' | 'debit_note' | 'proforma' | 'advance_tax' | 'advance_credit' | 'simplified';
const DOCUMENT_KINDS: Record<string, IsdocDocumentKind> = {
  '1': 'invoice',
  '2': 'credit_note',
  '3': 'debit_note',
  '4': 'proforma',
  '5': 'advance_tax',
  '6': 'advance_credit',
  '7': 'simplified'
};

export interface ParsedIsdocParty {
  name?: string;
  ico?: string;
  dic?: string;
  /** Other tax IDs from further `PartyTaxScheme` blocks (e.g. a Slovak DIČ next to the IČ DPH). */
  otherTaxIds: string[];
  street?: string;
  buildingNumber?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
  countryName?: string;
  /** `RegisterIdentification` as one line (court, file reference …). */
  registry?: string;
  contactName?: string;
  email?: string;
  phone?: string;
}

export interface ParsedIsdocLine {
  id?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  unitPriceTaxInclusive?: number;
  /** Net amount of the line (`LineExtensionAmount`). */
  net?: number;
  gross?: number;
  tax?: number;
  vatPercent?: number;
  /** `ClassifiedTaxCategory/LocalReverseChargeFlag` or a `LocalReverseCharge` block. */
  reverseCharge: boolean;
}

export interface ParsedIsdocTaxSubTotal {
  percent?: number;
  taxable?: number;
  tax?: number;
  inclusive?: number;
}

export interface ParsedIsdocPayment {
  /** `PaymentMeansCode`: 10 cash, 42 bank transfer, 48 card … */
  code?: string;
  amount?: number;
  dueDate?: string;
  accountId?: string;
  bankCode?: string;
  bankName?: string;
  iban?: string;
  bic?: string;
  variableSymbol?: string;
  constantSymbol?: string;
  specificSymbol?: string;
}

export interface ParsedIsdoc {
  version?: string;
  documentType?: string;
  kind?: IsdocDocumentKind;
  number?: string;
  uuid?: string;
  issueDate?: string;
  taxPointDate?: string;
  /** From `PaymentMeans/Payment/Details/PaymentDueDate`. */
  dueDate?: string;
  vatApplicable?: boolean;
  notes: string[];
  localCurrency?: string;
  foreignCurrency?: string;
  currRate?: number;
  supplier: ParsedIsdocParty;
  customer?: ParsedIsdocParty;
  lines: ParsedIsdocLine[];
  taxSubTotals: ParsedIsdocTaxSubTotal[];
  /** `TaxTotal/TaxAmount`. */
  taxTotal?: number;
  totals: {
    taxExclusive?: number;
    taxInclusive?: number;
    rounding?: number;
    /** Tax-inclusive amount already settled by advance tax documents (`AlreadyClaimedTaxInclusiveAmount`). */
    alreadyClaimed?: number;
    paidDeposits?: number;
    payable?: number;
  };
  payments: ParsedIsdocPayment[];
  /** Numbers of the documents this one corrects (`OriginalDocumentReference/ID`). */
  originalDocuments: string[];
  orderNumbers: string[];
}

function parseParty(wrapper: XmlNode | undefined): ParsedIsdocParty | undefined {
  const party = child(wrapper, 'Party');
  if (!party) return undefined;
  const ids = children(party, 'PartyTaxScheme')
    .map((p) => text(p, 'CompanyID'))
    .filter((v): v is string => !!v);
  // The VAT one first: `TaxScheme` "VAT", or the one with a country prefix.
  const schemes = children(party, 'PartyTaxScheme').map((p) => ({ id: text(p, 'CompanyID'), scheme: text(p, 'TaxScheme')?.toUpperCase() }));
  const vat = schemes.find((s) => s.id && s.scheme === 'VAT')?.id ?? ids.find((v) => /^[A-Za-z]{2}/.test(v)) ?? ids[0];
  const reg = child(party, 'RegisterIdentification');
  const registry =
    text(reg, 'Preformatted') ??
    ([text(reg, 'RegisterKeptAt'), text(reg, 'RegisterFileRef'), text(reg, 'RegisterDate')].filter(Boolean).join(', ') || undefined);
  const ico = text(party, 'PartyIdentification/ID');
  const p: ParsedIsdocParty = {
    name: text(party, 'PartyName/Name'),
    // Generators without an IČO put the DIČ or "N/A" here (see buildPartyXml).
    ico: ico && /^\d{1,8}$/.test(ico.replace(/\s/g, '')) ? ico.replace(/\s/g, '') : undefined,
    dic: vat,
    otherTaxIds: ids.filter((v) => v !== vat),
    street: text(party, 'PostalAddress/StreetName'),
    buildingNumber: text(party, 'PostalAddress/BuildingNumber'),
    city: text(party, 'PostalAddress/CityName'),
    postalCode: text(party, 'PostalAddress/PostalZone'),
    countryCode: text(party, 'PostalAddress/Country/IdentificationCode')?.toUpperCase(),
    countryName: text(party, 'PostalAddress/Country/Name'),
    registry,
    contactName: text(party, 'Contact/Name'),
    email: text(party, 'Contact/ElectronicMail'),
    phone: text(party, 'Contact/Telephone')
  };
  return p;
}

function parsePaymentDetails(payment: XmlNode, code: string | undefined): ParsedIsdocPayment {
  const d = child(payment, 'Details');
  return {
    code,
    amount: num(payment, 'PaidAmount'),
    dueDate: text(d, 'PaymentDueDate'),
    accountId: text(d, 'ID'),
    bankCode: text(d, 'BankCode'),
    bankName: text(d, 'Name'),
    iban: text(d, 'IBAN'),
    bic: text(d, 'BIC'),
    variableSymbol: text(d, 'VariableSymbol'),
    constantSymbol: text(d, 'ConstantSymbol'),
    specificSymbol: text(d, 'SpecificSymbol')
  };
}

/**
 * Reads an ISDOC invoice. Throws `IsdocParseError` ('not_xml' for broken XML,
 * 'not_isdoc' when the root is not an ISDOC `Invoice`); anything optional
 * that is missing comes back undefined, so the checker can report it.
 */
export function parseIsdoc(xml: string): ParsedIsdoc {
  const doc = parseXml(xml.replace(/^﻿/, ''));
  const inv = doc.children.find((c) => c.name === 'Invoice') ?? doc.children[0];
  if (!inv || inv.name !== 'Invoice' || !child(inv, 'AccountingSupplierParty')) {
    throw new IsdocParseError('not_isdoc', 'Not an ISDOC invoice');
  }

  const documentType = text(inv, 'DocumentType');
  const vatApplicable = text(inv, 'VATApplicable');
  const lines = children(child(inv, 'InvoiceLines'), 'InvoiceLine').map((l): ParsedIsdocLine => {
    const qty = child(l, 'InvoicedQuantity');
    const flag = text(l, 'ClassifiedTaxCategory/LocalReverseChargeFlag');
    return {
      id: text(l, 'ID'),
      description: text(l, 'Item/Description'),
      quantity: num(l, 'InvoicedQuantity'),
      unit: qty?.attrs.unitCode || undefined,
      unitPrice: num(l, 'UnitPrice'),
      unitPriceTaxInclusive: num(l, 'UnitPriceTaxInclusive'),
      net: num(l, 'LineExtensionAmount'),
      gross: num(l, 'LineExtensionAmountTaxInclusive'),
      tax: num(l, 'LineExtensionTaxAmount'),
      vatPercent: num(l, 'ClassifiedTaxCategory/Percent'),
      reverseCharge: flag === 'true' || flag === '1' || !!child(l, 'LocalReverseCharge')
    };
  });

  const taxTotal = child(inv, 'TaxTotal');
  const taxSubTotals = children(taxTotal, 'TaxSubTotal').map((s) => ({
    percent: num(s, 'TaxCategory/Percent'),
    taxable: num(s, 'TaxableAmount'),
    tax: num(s, 'TaxAmount'),
    inclusive: num(s, 'TaxInclusiveAmount')
  }));

  const payments: ParsedIsdocPayment[] = [];
  for (const means of children(inv, 'PaymentMeans')) {
    for (const p of children(means, 'Payment')) payments.push(parsePaymentDetails(p, text(p, 'PaymentMeansCode')));
    // Alternative accounts carry no amount and no due date.
    for (const alt of children(child(means, 'AlternateBankAccounts'), 'AlternateBankAccount')) {
      payments.push({ code: '42', accountId: text(alt, 'ID'), bankCode: text(alt, 'BankCode'), bankName: text(alt, 'Name'), iban: text(alt, 'IBAN'), bic: text(alt, 'BIC') });
    }
  }

  const monetary = child(inv, 'LegalMonetaryTotal');
  return {
    version: inv.attrs.version,
    documentType,
    kind: documentType ? DOCUMENT_KINDS[documentType] : undefined,
    number: text(inv, 'ID'),
    uuid: text(inv, 'UUID'),
    issueDate: text(inv, 'IssueDate'),
    taxPointDate: text(inv, 'TaxPointDate'),
    dueDate: payments.find((p) => p.dueDate)?.dueDate,
    vatApplicable: vatApplicable === undefined ? undefined : vatApplicable === 'true' || vatApplicable === '1',
    notes: children(inv, 'Note')
      .map((n) => n.text.trim())
      .filter(Boolean),
    localCurrency: text(inv, 'LocalCurrencyCode'),
    foreignCurrency: text(inv, 'ForeignCurrencyCode'),
    currRate: num(inv, 'CurrRate'),
    supplier: parseParty(child(inv, 'AccountingSupplierParty')) ?? parseParty(child(inv, 'SellerSupplierParty')) ?? { otherTaxIds: [] },
    customer: parseParty(child(inv, 'AccountingCustomerParty')) ?? parseParty(child(inv, 'BuyerCustomerParty')),
    lines,
    taxSubTotals,
    taxTotal: num(taxTotal, 'TaxAmount'),
    totals: {
      taxExclusive: num(monetary, 'TaxExclusiveAmount'),
      taxInclusive: num(monetary, 'TaxInclusiveAmount'),
      rounding: num(monetary, 'PayableRoundingAmount'),
      alreadyClaimed: num(monetary, 'AlreadyClaimedTaxInclusiveAmount'),
      paidDeposits: num(monetary, 'PaidDepositsAmount'),
      payable: num(monetary, 'PayableAmount')
    },
    payments,
    originalDocuments: children(child(inv, 'OriginalDocumentReferences'), 'OriginalDocumentReference')
      .concat(children(inv, 'OriginalDocumentReference'))
      .map((r) => text(r, 'ID'))
      .filter((v): v is string => !!v),
    orderNumbers: children(child(inv, 'OrderReferences'), 'OrderReference')
      .map((r) => text(r, 'SalesOrderID') ?? text(r, 'ExternalOrderID'))
      .filter((v): v is string => !!v)
  };
}

// ---------------------------------------------------------------------------
// Files: .isdoc (XML) and .isdocx (ZIP with the .isdoc inside)
// ---------------------------------------------------------------------------

/** Decodes XML bytes, honouring a UTF-16 BOM and the `encoding` of the XML declaration (old exporters write windows-1250). */
export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  let head = '';
  for (let i = 0; i < Math.min(bytes.length, 200); i++) head += String.fromCharCode(bytes[i]!);
  const label = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Pulls the invoice out of an ISDOCX package (a ZIP: the .isdoc plus a
 * manifest and attachments). Reads the central directory, so data
 * descriptors do not matter; stored and deflated entries only, which is all
 * the format uses. Returns null when the ZIP holds no .isdoc.
 */
export async function extractIsdocFromZip(zip: Uint8Array): Promise<Uint8Array | null> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new IsdocParseError('not_isdoc', 'Not a ZIP archive');
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  const entries: { name: string; method: number; size: number; offset: number }[] = [];
  for (let k = 0; k < count && p + 46 <= zip.length && u32(zip, p) === 0x02014b50; k++) {
    const nameLen = u16(zip, p + 28);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method: u16(zip, p + 10), size: u32(zip, p + 20), offset: u32(zip, p + 42) });
    p += 46 + nameLen + u16(zip, p + 30) + u16(zip, p + 32);
  }
  // The invoice sits at the root; prefer it over an .isdoc attachment in a folder.
  const isdocs = entries.filter((e) => /\.isdoc$/i.test(e.name)).sort((a, b) => a.name.split('/').length - b.name.split('/').length);
  const entry = isdocs[0];
  if (!entry) return null;
  const local = entry.offset;
  if (u32(zip, local) !== 0x04034b50) throw new IsdocParseError('not_isdoc', 'Broken ZIP entry');
  const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
  const data = zip.subarray(start, start + entry.size);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new IsdocParseError('not_isdoc', `Unsupported ZIP compression ${entry.method}`);
}

/** Reads an uploaded .isdoc or .isdocx (detected by the ZIP signature, not the file name). */
export async function readIsdocFile(bytes: Uint8Array): Promise<ParsedIsdoc> {
  let xml = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const inner = await extractIsdocFromZip(bytes);
    if (!inner) throw new IsdocParseError('not_isdoc', 'The ISDOCX package holds no .isdoc file');
    xml = inner;
  }
  return parseIsdoc(decodeXmlBytes(xml));
}
