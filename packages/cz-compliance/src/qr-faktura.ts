/**
 * QR Faktura (SID) — the Czech Banking Association's companion to QR Platba
 * that carries the invoice itself (number, dates, parties, VAT recap), so the
 * recipient's accounting software can import a received invoice by scanning
 * it. Billanta embeds it into the payment QR as the `X-INV` field ("QR Platba
 * + Faktura": one code both banking apps and accounting apps understand) and
 * reads it back when a received invoice is scanned into an expense.
 *
 * Spec: "Formát pro sdílení faktur — QR Faktura", ČBA, version 1.0.
 * Reference: https://qr-faktura.cz/
 *
 * String shape:
 *   SID*1.0*ID:<number>*DD:<YYYYMMDD>*AM:<amount>*VS:…*VII:…*INI:…*TB0:…*T0:…
 * Inside SPAYD the `*` separators are written as `%2A`:
 *   SPD*1.0*ACC:…*AM:…*X-INV:SID%2A1.0%2AID:…%2ADD:…
 */

export interface QrInvoiceVatLine {
  /** VAT rate in percent (21, 12, 10, 0…). */
  rate: number;
  base: number;
  vat: number;
}

export interface QrInvoiceParams {
  invoiceNumber: string;
  issueDate: Date;
  totalAmount: number;
  currency?: string;
  dueDate?: Date;
  taxableSupplyDate?: Date;
  variableSymbol?: string;
  orderNumber?: string;
  message?: string;
  supplierIco?: string;
  supplierDic?: string;
  customerIco?: string;
  customerDic?: string;
  /** VAT recap; omit (or leave empty) for a non-VAT-payer's document. */
  vatLines?: QrInvoiceVatLine[];
  /** 0 nedaňový doklad, 1 opravný daňový doklad, 9 (default) běžný daňový doklad. */
  documentType?: 0 | 1 | 2 | 9;
  /** 1 = přenesená daňová povinnost. */
  reverseCharge?: boolean;
  /** Zálohová faktura. */
  advance?: boolean;
  iban?: string;
  exchangeRate?: number;
  software?: string;
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\*/g, '\\*');
const amount = (n: number) => n.toFixed(2);
const date = (d: Date) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

/** Slot of a Czech VAT rate in the SID recap: 0 = standard, 1 = first reduced, 2 = second reduced. */
function rateSlot(rate: number): 0 | 1 | 2 | null {
  if (rate <= 0) return null;
  if (rate >= 19) return 0;
  if (rate >= 11) return 1;
  return 2;
}

/** Builds a standalone `SID*1.0*…` string. */
export function generateQrInvoiceString(p: QrInvoiceParams): string {
  if (!p.invoiceNumber) throw new Error('generateQrInvoiceString: "invoiceNumber" is required');
  const f: string[] = ['SID', '1.0', `ID:${esc(p.invoiceNumber.slice(0, 40))}`, `DD:${date(p.issueDate)}`, `AM:${amount(p.totalAmount)}`];
  const vatPayerDoc = (p.vatLines?.length ?? 0) > 0;
  const td = p.documentType ?? (vatPayerDoc ? 9 : 0);
  f.push(`TP:${p.reverseCharge ? 1 : 0}`, `TD:${td}`, `SA:${p.advance ? 1 : 0}`);
  if (p.message) f.push(`MSG:${esc(p.message.slice(0, 40))}`);
  if (p.orderNumber) f.push(`ON:${esc(p.orderNumber.slice(0, 20))}`);
  if (p.variableSymbol) f.push(`VS:${esc(p.variableSymbol)}`);
  if (p.supplierDic) f.push(`VII:${esc(p.supplierDic)}`);
  if (p.supplierIco) f.push(`INI:${esc(p.supplierIco)}`);
  if (p.customerDic) f.push(`VIR:${esc(p.customerDic)}`);
  if (p.customerIco) f.push(`INR:${esc(p.customerIco)}`);
  if (p.taxableSupplyDate) f.push(`DUZP:${date(p.taxableSupplyDate)}`);
  if (p.dueDate) f.push(`DT:${date(p.dueDate)}`);

  const slots: Array<{ base: number; vat: number }> = [0, 1, 2].map(() => ({ base: 0, vat: 0 }));
  let nonTaxable = 0;
  for (const line of p.vatLines ?? []) {
    const slot = rateSlot(line.rate);
    if (slot === null) nonTaxable += line.base;
    else {
      slots[slot]!.base += line.base;
      slots[slot]!.vat += line.vat;
    }
  }
  slots.forEach((s, i) => {
    if (s.base !== 0 || s.vat !== 0) f.push(`TB${i}:${amount(s.base)}`, `T${i}:${amount(s.vat)}`);
  });
  if (nonTaxable !== 0) f.push(`NTB:${amount(nonTaxable)}`);

  const currency = (p.currency ?? 'CZK').toUpperCase();
  f.push(`CC:${currency}`);
  if (currency !== 'CZK' && p.exchangeRate) f.push(`FX:${p.exchangeRate.toFixed(3)}`, 'FXA:1');
  if (p.iban) f.push(`ACC:${esc(p.iban.replace(/\s+/g, '').toUpperCase())}`);
  if (p.software) f.push(`X-SW:${esc(p.software)}`);
  return f.join('*');
}

/** SID string → value of a SPAYD `X-INV` field (`*` → `%2A`). */
export function qrInvoiceForSpayd(sid: string): string {
  return sid.replace(/%/g, '%25').replace(/\*/g, '%2A').replace(/\+/g, '%2B');
}

// ---------------------------------------------------------------- parsing

/** Splits on unescaped `*` and unescapes `\x`. */
function splitFields(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) cur += text[++i];
    else if (ch === '*') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function toMap(fields: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of fields) {
    const i = field.indexOf(':');
    if (i > 0) map.set(field.slice(0, i).toUpperCase(), field.slice(i + 1));
  }
  return map;
}

const parseDate = (v: string | undefined) => (v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : undefined);
const parseNum = (v: string | undefined) => {
  if (v == null || v === '') return undefined;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** What a scanned QR Platba / QR Faktura says about a received invoice (dates as YYYY-MM-DD). */
export interface ScannedInvoice {
  /** Which formats the code carried. */
  format: 'spayd' | 'sid' | 'spayd+sid';
  invoiceNumber?: string;
  issueDate?: string;
  taxableSupplyDate?: string;
  dueDate?: string;
  amount?: number;
  currency?: string;
  variableSymbol?: string;
  constantSymbol?: string;
  specificSymbol?: string;
  message?: string;
  iban?: string;
  supplierIco?: string;
  supplierDic?: string;
  customerIco?: string;
  customerDic?: string;
  /** Total VAT from the SID recap (TB/T fields). */
  vatAmount?: number;
  /** Base without VAT (TB0–TB2 + NTB). */
  baseAmount?: number;
  /** Highest VAT rate slot present: 21 / 12 / 10 / 0. */
  vatRate?: number;
  /** False for a nedaňový doklad (SID `TD:0`, e.g. from a non-VAT payer). */
  taxDocument?: boolean;
}

function readSid(map: Map<string, string>, out: ScannedInvoice): void {
  out.invoiceNumber = map.get('ID') ?? out.invoiceNumber;
  out.issueDate = parseDate(map.get('DD')) ?? out.issueDate;
  out.taxableSupplyDate = parseDate(map.get('DUZP')) ?? out.taxableSupplyDate;
  out.dueDate = parseDate(map.get('DT')) ?? out.dueDate;
  out.amount = parseNum(map.get('AM')) ?? out.amount;
  out.currency = map.get('CC') ?? out.currency;
  out.variableSymbol = map.get('VS') ?? out.variableSymbol;
  out.message = map.get('MSG') ?? out.message;
  const td = map.get('TD');
  if (td != null) out.taxDocument = td !== '0';
  out.supplierIco = map.get('INI');
  out.supplierDic = map.get('VII');
  out.customerIco = map.get('INR');
  out.customerDic = map.get('VIR');
  if (!out.iban && map.get('ACC')) out.iban = map.get('ACC')!.split('+')[0];
  let base = 0;
  let vat = 0;
  let seen = false;
  const rates = [21, 12, 10];
  for (const i of [0, 1, 2]) {
    const b = parseNum(map.get(`TB${i}`));
    const t = parseNum(map.get(`T${i}`));
    if (b != null || t != null) {
      seen = true;
      base += b ?? 0;
      vat += t ?? 0;
      if (out.vatRate == null) out.vatRate = rates[i];
    }
  }
  const ntb = parseNum(map.get('NTB'));
  if (ntb != null) {
    seen = true;
    base += ntb;
    if (out.vatRate == null) out.vatRate = 0;
  }
  if (seen) {
    out.baseAmount = Math.round(base * 100) / 100;
    out.vatAmount = Math.round(vat * 100) / 100;
  }
}

/**
 * Parses the text of a scanned QR code: QR Platba (`SPD*…`, optionally with an
 * embedded `X-INV` QR Faktura) or standalone QR Faktura (`SID*…`). Returns
 * null for anything else.
 */
export function parseInvoiceQr(raw: string): ScannedInvoice | null {
  const text = raw.trim();
  if (/^SID\*/i.test(text)) {
    const out: ScannedInvoice = { format: 'sid' };
    readSid(toMap(splitFields(text).slice(2)), out);
    return out;
  }
  if (!/^SPD\*/i.test(text)) return null;
  const map = toMap(splitFields(text).slice(2));
  const out: ScannedInvoice = { format: 'spayd' };
  const acc = map.get('ACC');
  if (acc) out.iban = acc.split('+')[0];
  out.amount = parseNum(map.get('AM'));
  out.currency = map.get('CC');
  out.dueDate = parseDate(map.get('DT'));
  out.variableSymbol = map.get('X-VS');
  out.constantSymbol = map.get('X-KS');
  out.specificSymbol = map.get('X-SS');
  out.message = map.get('MSG');
  const inv = map.get('X-INV');
  if (inv) {
    let sid = inv;
    try {
      sid = decodeURIComponent(inv);
    } catch {
      sid = inv.replace(/%2A/gi, '*');
    }
    if (/^SID\*/i.test(sid)) {
      out.format = 'spayd+sid';
      readSid(toMap(splitFields(sid).slice(2)), out);
    }
  }
  return out;
}
