import type { HomeCurrency } from './home-currency.js';
import { isSealed } from './vault/confidential.js';
import type { DocumentAmounts, ItemAmounts } from './vault-amounts.js';

/*
 * The accountant's XML files: a Pohoda dataPack and a Money S3 MoneyData.
 * Shared so the server builds them from plain documents and the browser
 * builds the same files when some amounts are sealed and only it can open
 * them. Element names and order follow Stormware's and Solitea's XSDs.
 */

/** A date as stored, or as an ISO string after JSON. */
type DateLike = Date | string | null | undefined;

export type AccountingPaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'cash_on_delivery' | 'other';
export type AccountingDocumentType = 'invoice' | 'proforma' | 'credit_note' | 'quote';

export interface AccountingInvoice {
  invoiceNumber: string | null;
  documentType: AccountingDocumentType;
  variableSymbol: string | null;
  constantSymbol: string | null;
  specificSymbol: string | null;
  issueDate: DateLike;
  taxableSupplyDate: DateLike;
  dueDate: DateLike;
  paymentMethod: AccountingPaymentMethod;
  noteBelow: string | null;
  internalNote: string | null;
  currency: string;
  exchangeRate: string | null;
  reverseCharge: boolean;
}

export interface AccountingContact {
  legalName: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  ico: string | null;
  dic: string | null;
}

/** A line item; numbers as Postgres returns them (strings) or plain numbers. */
export interface AccountingItem {
  description: string;
  unit: string | null;
  quantity: string | number;
  unitPrice: string | number;
  vatRate: string | number | null;
  discountPercent: string | number | null;
}

type RateBucket = { vatRatePercent: number; totalWithoutVat: number; vatAmount: number };

export interface AccountingDoc {
  invoice: AccountingInvoice;
  contact: AccountingContact | null;
  lineItems: AccountingItem[];
  totals: { byRate: RateBucket[]; totalWithVat: number };
}

export interface AccountingExpense {
  id: string;
  documentNumber: string | null;
  variableSymbol: string | null;
  expenseDate: DateLike;
  dueDate: DateLike;
  description: string;
  supplierNameRaw: string | null;
  supplierIco: string | null;
  note: string | null;
  vatRate: string | number;
  amount: string | number;
  currency: string;
  reverseCharge: boolean;
}

export interface AccountingFileInput {
  period: { from: DateLike; to: DateLike };
  /** The company's IČO, as the file's owner. */
  ico: string | null;
  home: HomeCurrency;
  invoices: AccountingDoc[];
  expenses: AccountingExpense[];
  /** Money's export date; defaults to now. */
  today?: Date;
}

const TYPE_LABEL: Record<AccountingDocumentType, string> = {
  invoice: 'Faktura',
  proforma: 'Zálohová faktura',
  credit_note: 'Dobropis',
  quote: 'Nabídka',
};

const POHODA_INVOICE_TYPE: Partial<Record<AccountingDocumentType, string>> = {
  invoice: 'issuedInvoice',
  credit_note: 'issuedCreditNotice',
  proforma: 'issuedAdvanceInvoice',
};

const POHODA_PAYMENT: Record<AccountingPaymentMethod, string> = {
  bank_transfer: 'draft',
  cash: 'cash',
  card: 'creditcard',
  cash_on_delivery: 'delivery',
  other: 'draft',
};

const MONEY_PAYMENT: Record<AccountingPaymentMethod, string> = {
  bank_transfer: 'převodem',
  cash: 'hotově',
  card: 'kartou',
  cash_on_delivery: 'dobírkou',
  other: 'jinak',
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function isoDate(d: DateLike): string {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** The last day of an exclusive period end. */
function lastDay(to: DateLike): string {
  return isoDate(new Date(new Date(to ?? 0).getTime() - 1));
}

function xml(v: string | number | null | undefined): string {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Closes a non-stock item; the XSD requires Protizapis (only meaningful for deposit deductions). */
const NESKL_TAIL = '<Protizapis>false</Protizapis></NesklPolozka>';

/** An optional XML element: omitted when the value is empty. */
function el(tag: string, v: string | number | null | undefined): string {
  return v == null || v === '' ? '' : `<${tag}>${xml(v)}</${tag}>`;
}

function money(n: number): string {
  return round2(n).toFixed(2);
}

/** Money's VAT summary: the reduced rate lives in the "5" slots, the standard one in "22". */
export function moneyVatSummary(byRate: RateBucket[]): string {
  const sum = (pick: (r: RateBucket) => boolean, key: 'totalWithoutVat' | 'vatAmount') =>
    money(byRate.filter(pick).reduce((a, r) => a + r[key], 0));
  const zero = (r: RateBucket) => r.vatRatePercent <= 0;
  const low = (r: RateBucket) => r.vatRatePercent > 0 && r.vatRatePercent < 19;
  const high = (r: RateBucket) => r.vatRatePercent >= 19;
  return (
    `<SouhrnDPH><Zaklad0>${sum(zero, 'totalWithoutVat')}</Zaklad0>` +
    `<Zaklad5>${sum(low, 'totalWithoutVat')}</Zaklad5><Zaklad22>${sum(high, 'totalWithoutVat')}</Zaklad22>` +
    `<DPH5>${sum(low, 'vatAmount')}</DPH5><DPH22>${sum(high, 'vatAmount')}</DPH22></SouhrnDPH>`
  );
}

/** Header totals: plain in the home currency, inside `Valuty` (with the stored rate, if any) for a foreign one. */
export function moneyTotals(currency: string, rate: string | null, byRate: RateBucket[], total: number, home: HomeCurrency = 'CZK'): string {
  if (currency === home) return moneyVatSummary(byRate) + `<Celkem>${money(total)}</Celkem>`;
  // Without a stored rate Money converts with its own exchange-rate list.
  return (
    `<Valuty><Mena><Kod>${xml(currency)}</Kod><Mnozstvi>1</Mnozstvi>` +
    (rate ? `<Kurs>${Math.round(Number(rate) * 10000) / 10000}</Kurs>` : '') +
    `</Mena>${moneyVatSummary(byRate)}<Celkem>${money(total)}</Celkem></Valuty>`
  );
}

/** Pohoda's VAT rate classes; the exact percentage is sent alongside. */
function pohodaRate(percent: number): string {
  if (percent <= 0) return 'none';
  if (percent >= 19) return 'high';
  if (percent >= 10 && percent <= 15) return 'low';
  return 'third';
}

/** Issued documents (invoices, credit notes, proformas) and received expenses as a Pohoda XML dataPack. */
export function pohodaXml(input: AccountingFileInput): string {
  const { home } = input;
  const packId = `billanta-${isoDate(input.period.from)}`;

  const partner = (c: AccountingContact | null) =>
    c
      ? `<inv:partnerIdentity><typ:address>` +
        `<typ:company>${xml(c.legalName)}</typ:company>` +
        `<typ:city>${xml(c.addressCity)}</typ:city>` +
        `<typ:street>${xml(c.addressStreet)}</typ:street>` +
        `<typ:zip>${xml(c.addressPostalCode)}</typ:zip>` +
        (c.ico ? `<typ:ico>${xml(c.ico)}</typ:ico>` : '') +
        (c.dic ? `<typ:dic>${xml(c.dic)}</typ:dic>` : '') +
        `</typ:address></inv:partnerIdentity>`
      : '';

  const items: string[] = [];
  for (const { invoice, contact, lineItems } of input.invoices) {
    const type = POHODA_INVOICE_TYPE[invoice.documentType];
    if (!type) continue;
    const foreign = invoice.currency !== home;
    const priceTag = foreign ? 'inv:foreignCurrency' : 'inv:homeCurrency';
    const lines = lineItems
      .map((li) => {
        const rate = invoice.reverseCharge ? 0 : Number(li.vatRate ?? 0);
        return (
          `<inv:invoiceItem>` +
          `<inv:text>${xml(li.description.slice(0, 90))}</inv:text>` +
          `<inv:quantity>${Number(li.quantity)}</inv:quantity>` +
          (li.unit ? `<inv:unit>${xml(li.unit)}</inv:unit>` : '') +
          `<inv:payVAT>false</inv:payVAT>` +
          `<inv:rateVAT>${pohodaRate(rate)}</inv:rateVAT>` +
          (rate > 0 ? `<inv:percentVAT>${rate}</inv:percentVAT>` : '') +
          (Number(li.discountPercent ?? 0) > 0 ? `<inv:discountPercentage>${Number(li.discountPercent)}</inv:discountPercentage>` : '') +
          `<${priceTag}><typ:unitPrice>${Math.round(Number(li.unitPrice) * 10000) / 10000}</typ:unitPrice></${priceTag}>` +
          `</inv:invoiceItem>`
        );
      })
      .join('');

    items.push(
      `<dat:dataPackItem id="${xml(invoice.invoiceNumber)}" version="2.0">` +
        `<inv:invoice version="2.0"><inv:invoiceHeader>` +
        `<inv:invoiceType>${type}</inv:invoiceType>` +
        `<inv:number><typ:numberRequested>${xml(invoice.invoiceNumber)}</typ:numberRequested></inv:number>` +
        (invoice.variableSymbol ? `<inv:symVar>${xml(invoice.variableSymbol)}</inv:symVar>` : '') +
        `<inv:date>${isoDate(invoice.issueDate)}</inv:date>` +
        (invoice.documentType !== 'proforma' ? `<inv:dateTax>${isoDate(invoice.taxableSupplyDate ?? invoice.issueDate)}</inv:dateTax>` : '') +
        (invoice.dueDate ? `<inv:dateDue>${isoDate(invoice.dueDate)}</inv:dateDue>` : '') +
        `<inv:text>${xml((lineItems[0]?.description ?? TYPE_LABEL[invoice.documentType]).slice(0, 240))}</inv:text>` +
        partner(contact) +
        `<inv:paymentType><typ:paymentType>${POHODA_PAYMENT[invoice.paymentMethod]}</typ:paymentType></inv:paymentType>` +
        (invoice.constantSymbol ? `<inv:symConst>${xml(invoice.constantSymbol)}</inv:symConst>` : '') +
        (invoice.specificSymbol ? `<inv:symSpec>${xml(invoice.specificSymbol)}</inv:symSpec>` : '') +
        (invoice.noteBelow ? `<inv:note>${xml(invoice.noteBelow)}</inv:note>` : '') +
        (invoice.internalNote ? `<inv:intNote>${xml(invoice.internalNote)}</inv:intNote>` : '') +
        `</inv:invoiceHeader>` +
        `<inv:invoiceDetail>${lines}</inv:invoiceDetail>` +
        `<inv:invoiceSummary><inv:roundingDocument>none</inv:roundingDocument>` +
        (foreign ? `<inv:foreignCurrency><typ:currency><typ:ids>${xml(invoice.currency)}</typ:ids></typ:currency></inv:foreignCurrency>` : '') +
        `</inv:invoiceSummary>` +
        `</inv:invoice></dat:dataPackItem>`,
    );
  }

  for (const e of input.expenses) {
    // Reverse charge: the supplier's document carries no VAT, like our own
    // reverse-charge invoices above. The accountant books the self-assessment.
    const rate = e.reverseCharge ? 0 : Number(e.vatRate);
    const foreign = e.currency !== home;
    const priceTag = foreign ? 'inv:foreignCurrency' : 'inv:homeCurrency';
    const ref = e.documentNumber || e.id.slice(0, 8);
    items.push(
      `<dat:dataPackItem id="exp-${xml(e.id)}" version="2.0">` +
        `<inv:invoice version="2.0"><inv:invoiceHeader>` +
        `<inv:invoiceType>receivedInvoice</inv:invoiceType>` +
        `<inv:originalDocument>${xml(ref)}</inv:originalDocument>` +
        (e.variableSymbol ? `<inv:symVar>${xml(e.variableSymbol)}</inv:symVar>` : '') +
        `<inv:date>${isoDate(e.expenseDate)}</inv:date>` +
        `<inv:dateTax>${isoDate(e.expenseDate)}</inv:dateTax>` +
        (e.dueDate ? `<inv:dateDue>${isoDate(e.dueDate)}</inv:dateDue>` : '') +
        `<inv:text>${xml(e.description.slice(0, 240))}</inv:text>` +
        (e.supplierNameRaw || e.supplierIco
          ? `<inv:partnerIdentity><typ:address>` +
            `<typ:company>${xml(e.supplierNameRaw)}</typ:company>` +
            (e.supplierIco ? `<typ:ico>${xml(e.supplierIco)}</typ:ico>` : '') +
            `</typ:address></inv:partnerIdentity>`
          : '') +
        (e.note ? `<inv:intNote>${xml(e.note)}</inv:intNote>` : '') +
        `</inv:invoiceHeader><inv:invoiceDetail><inv:invoiceItem>` +
        `<inv:text>${xml(e.description.slice(0, 90))}</inv:text>` +
        `<inv:quantity>1</inv:quantity>` +
        `<inv:payVAT>true</inv:payVAT>` +
        `<inv:rateVAT>${pohodaRate(rate)}</inv:rateVAT>` +
        (rate > 0 ? `<inv:percentVAT>${rate}</inv:percentVAT>` : '') +
        `<${priceTag}><typ:unitPrice>${round2(Number(e.amount))}</typ:unitPrice></${priceTag}>` +
        `</inv:invoiceItem></inv:invoiceDetail>` +
        `<inv:invoiceSummary><inv:roundingDocument>none</inv:roundingDocument>` +
        (foreign ? `<inv:foreignCurrency><typ:currency><typ:ids>${xml(e.currency)}</typ:ids></typ:currency></inv:foreignCurrency>` : '') +
        `</inv:invoiceSummary></inv:invoice></dat:dataPackItem>`,
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<dat:dataPack id="${xml(packId)}" ico="${xml(input.ico)}" application="Billanta" version="2.0" ` +
    `note="Export ${isoDate(input.period.from)} – ${lastDay(input.period.to)}" ` +
    `xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd" ` +
    `xmlns:inv="http://www.stormware.cz/schema/version_2/invoice.xsd" ` +
    `xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd">\n` +
    items.join('\n') +
    `\n</dat:dataPack>\n`
  );
}

/**
 * The same documents as a Money S3 `MoneyData` file (Soubor → Import →
 * XML). Discounts are folded into the unit price; reverse charge exports
 * with a 0 % rate.
 */
export function moneyS3Xml(input: AccountingFileInput): string {
  const { home } = input;

  const issued = input.invoices.map(({ invoice, contact, lineItems, totals }) => {
    const foreign = invoice.currency !== home;
    const lines = lineItems
      .map((li) => {
        const rate = invoice.reverseCharge ? 0 : Number(li.vatRate ?? 0);
        const unitPrice = Number(li.unitPrice) * (1 - Number(li.discountPercent ?? 0) / 100);
        const price = Math.round(unitPrice * 10000) / 10000;
        return (
          `<Polozka>${el('Popis', li.description.slice(0, 50))}` +
          (li.description.length > 50 ? el('Poznamka', li.description) : '') +
          `<PocetMJ>${Number(li.quantity)}</PocetMJ><SazbaDPH>${rate}</SazbaDPH>` +
          `<Cena>${foreign ? 0 : price}</Cena><CenaTyp>0</CenaTyp>` +
          (foreign ? `<Valuty>${price}</Valuty>` : '') +
          `<NesklPolozka>${el('MJ', li.unit?.slice(0, 10))}${NESKL_TAIL}</Polozka>`
        );
      })
      .join('');
    const number = invoice.invoiceNumber ?? '';
    // Doklad holds at most 10 characters; a longer number goes to the note.
    const note = [number.length > 10 ? `Číslo dokladu: ${number}` : '', invoice.internalNote ?? ''].filter(Boolean);
    return (
      `<FaktVyd>` +
      el('Doklad', number.slice(0, 10)) +
      el('Popis', (lineItems[0]?.description ?? TYPE_LABEL[invoice.documentType]).slice(0, 50)) +
      el('Vystaveno', isoDate(invoice.issueDate)) +
      (invoice.documentType !== 'proforma' ? el('PlnenoDPH', isoDate(invoice.taxableSupplyDate ?? invoice.issueDate)) : '') +
      el('Splatno', isoDate(invoice.dueDate)) +
      el('KonstSym', invoice.constantSymbol) +
      el('VarSymbol', invoice.variableSymbol) +
      el('SpecSymbol', invoice.specificSymbol) +
      `<Druh>${invoice.documentType === 'proforma' ? 'Z' : 'N'}</Druh>` +
      (invoice.documentType === 'credit_note' ? `<Dobropis>true</Dobropis>` : '') +
      el('Uhrada', MONEY_PAYMENT[invoice.paymentMethod]) +
      `<SazbaDPH1>12</SazbaDPH1><SazbaDPH2>21</SazbaDPH2>` +
      moneyTotals(invoice.currency, invoice.exchangeRate, totals.byRate, totals.totalWithVat, home) +
      el('Poznamka', note.join('\n')) +
      el('TextZaFa', invoice.noteBelow) +
      (contact
        ? `<DodOdb>${el('ObchNazev', contact.legalName)}` +
          `<ObchAdresa>${el('Ulice', contact.addressStreet)}${el('Misto', contact.addressCity)}` +
          `${el('PSC', contact.addressPostalCode)}${el('Stat', contact.addressCountry)}</ObchAdresa>` +
          `${el('ICO', contact.ico)}${el('DIC', contact.dic)}</DodOdb>`
        : '') +
      `<SeznamPolozek>${lines}</SeznamPolozek>` +
      `</FaktVyd>`
    );
  });

  const received = input.expenses.map((e) => {
    const rate = e.reverseCharge ? 0 : Number(e.vatRate);
    const total = Number(e.amount);
    const base = total / (1 + rate / 100);
    const foreign = e.currency !== home;
    return (
      `<FaktPrij>` +
      el('Popis', e.description.slice(0, 50)) +
      el('Vystaveno', isoDate(e.expenseDate)) +
      el('PlnenoDPH', isoDate(e.expenseDate)) +
      el('Splatno', isoDate(e.dueDate)) +
      el('VarSymbol', e.variableSymbol) +
      el('PrijatDokl', e.documentNumber) +
      `<Druh>N</Druh><SazbaDPH1>12</SazbaDPH1><SazbaDPH2>21</SazbaDPH2>` +
      moneyTotals(e.currency, null, [{ vatRatePercent: rate, totalWithoutVat: base, vatAmount: total - base }], total, home) +
      el('Poznamka', e.note) +
      (e.supplierNameRaw || e.supplierIco ? `<DodOdb>${el('ObchNazev', e.supplierNameRaw)}${el('ICO', e.supplierIco)}</DodOdb>` : '') +
      `<SeznamPolozek><Polozka>${el('Popis', e.description.slice(0, 50))}<PocetMJ>1</PocetMJ>` +
      `<SazbaDPH>${rate}</SazbaDPH><Cena>${foreign ? 0 : money(total)}</Cena><CenaTyp>1</CenaTyp>` +
      (foreign ? `<Valuty>${money(total)}</Valuty>` : '') +
      `<NesklPolozka>${NESKL_TAIL}</Polozka></SeznamPolozek>` +
      `</FaktPrij>`
    );
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<MoneyData ${input.ico ? `ICAgendy="${xml(input.ico)}" ` : ''}` +
    `description="Billanta ${isoDate(input.period.from)} – ${lastDay(input.period.to)}" ` +
    `ExpZkratka="Billanta" ExpDate="${isoDate(input.today ?? new Date())}">\n` +
    // The schema wants received invoices before issued ones.
    (received.length ? `<SeznamFaktPrij>\n${received.join('\n')}\n</SeznamFaktPrij>\n` : '') +
    (issued.length ? `<SeznamFaktVyd>\n${issued.join('\n')}\n</SeznamFaktVyd>\n` : '') +
    `</MoneyData>\n`
  );
}

export type AccountingFormat = 'pohoda' | 'money-s3';

/** A line item of the inputs: plain, or the placeholder with its sealed envelope. */
export type SealedAccountingItem = AccountingItem & { encAmounts: string | null };

/** A document of the inputs: plain with `totals`, or sealed with `encAmounts` and no totals. */
export interface SealedAccountingDoc {
  invoice: AccountingInvoice;
  contact: AccountingContact | null;
  lineItems: SealedAccountingItem[];
  totals: AccountingDoc['totals'] | null;
  encAmounts: string | null;
}

/** What `GET /exports/accounting-inputs` returns. */
export interface SealedAccountingInputs {
  format: AccountingFormat;
  period: { from: string; to: string };
  ico: string | null;
  home: HomeCurrency;
  invoices: SealedAccountingDoc[];
  expenses: AccountingExpense[];
}

/** Every envelope the inputs need opened: document totals and line items. */
export function sealedAccountingEnvelopes(inputs: SealedAccountingInputs): { documents: string[]; items: string[] } {
  const documents: string[] = [];
  const items: string[] = [];
  for (const d of inputs.invoices) {
    if (!isSealed(d.encAmounts)) continue;
    documents.push(d.encAmounts!);
    for (const li of d.lineItems) if (isSealed(li.encAmounts)) items.push(li.encAmounts!);
  }
  return { documents, items };
}

/**
 * The Pohoda or Money S3 file with the opened sealed amounts, documents in
 * the server's order. A sealed document needs its totals and every sealed
 * line opened; `body` is null while any of them is missing.
 */
export function buildSealedAccountingXml(
  inputs: SealedAccountingInputs,
  openedDocs: ReadonlyMap<string, DocumentAmounts>,
  openedItems: ReadonlyMap<string, ItemAmounts>,
  today?: Date,
): { body: string | null; missing: number } {
  const invoices: AccountingDoc[] = [];
  let missing = 0;
  for (const { encAmounts, totals, lineItems, ...doc } of inputs.invoices) {
    if (!isSealed(encAmounts)) {
      if (!totals) {
        missing++;
        continue;
      }
      invoices.push({ ...doc, totals, lineItems: lineItems.map(({ encAmounts: _, ...li }) => li) });
      continue;
    }
    const opened = openedDocs.get(encAmounts!);
    const lines: AccountingItem[] = [];
    let shut = false;
    for (const { encAmounts: itemCipher, ...li } of lineItems) {
      if (!isSealed(itemCipher)) {
        lines.push(li);
        continue;
      }
      const amounts = openedItems.get(itemCipher!);
      if (!amounts) {
        shut = true;
        break;
      }
      lines.push({ ...li, quantity: amounts.quantity, unitPrice: amounts.unitPrice, vatRate: amounts.vatRate, discountPercent: amounts.discountPercent });
    }
    if (shut || !opened) {
      missing++;
      continue;
    }
    invoices.push({ ...doc, lineItems: lines, totals: opened });
  }
  if (missing > 0) return { body: null, missing };
  const file: AccountingFileInput = { period: inputs.period, ico: inputs.ico, home: inputs.home, invoices, expenses: inputs.expenses, today };
  return { body: inputs.format === 'pohoda' ? pohodaXml(file) : moneyS3Xml(file), missing: 0 };
}
