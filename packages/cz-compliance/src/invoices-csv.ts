import { csvCell } from './csv-cell.js';
import { burdenOf, displayCustomField, resolveVars, type CustomField } from './custom-fields.js';
import type { HomeCurrency } from './home-currency.js';

/*
 * The accountant's invoice list (CSV). Shared so the server builds it from
 * plain documents and the browser builds the same file when some amounts are
 * sealed and only it can open them.
 */

/** A date as stored, or as an ISO string after JSON. */
type DateLike = Date | string | null | undefined;

export interface CsvInvoice {
  invoiceNumber: string | null;
  documentType: 'invoice' | 'proforma' | 'credit_note' | 'quote';
  status: 'draft' | 'pending_review' | 'issued' | 'paid' | 'cancelled';
  issueDate: DateLike;
  taxableSupplyDate: DateLike;
  dueDate: DateLike;
  paidAt: DateLike;
  currency: string;
  exchangeRate: string | number | null;
  variableSymbol: string | null;
  language: string;
  reverseCharge: boolean;
  amountPaid: string | number | null;
  customFields: CustomField[] | null;
  internalNote: string | null;
}

export interface CsvContact {
  legalName: string | null;
  ico: string | null;
  dic: string | null;
}

export interface CsvTotals {
  totalWithoutVat: number;
  totalVat: number;
  totalWithVat: number;
  byRate: { vatRatePercent: number; totalWithoutVat: number; vatAmount: number }[];
}

export interface CsvInvoiceRow {
  invoice: CsvInvoice;
  contact: CsvContact | null;
  totals: CsvTotals;
}

const TYPE_LABEL: Record<CsvInvoice['documentType'], string> = {
  invoice: 'Faktura',
  proforma: 'Zálohová faktura',
  credit_note: 'Dobropis',
  quote: 'Nabídka',
};

const STATUS_LABEL: Record<CsvInvoice['status'], string> = {
  draft: 'Koncept',
  pending_review: 'Ke kontrole',
  issued: 'Vystaveno',
  paid: 'Uhrazeno',
  cancelled: 'Stornováno',
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function csvDate(d: DateLike): string {
  if (!d) return '';
  const x = new Date(d);
  return `${x.getDate()}.${x.getMonth() + 1}.${x.getFullYear()}`;
}

/** Czech Excel opens `;`-separated, comma-decimal, BOM-prefixed UTF-8 cleanly. */
export function csvSheet(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

const percentLabel = (p: number) => `${String(p).replace('.', ',')} %`;

/**
 * The accountant's invoice list: one row per document, the columns Czech
 * accountants ask for first (dates, customer IDs, base and VAT per rate,
 * home-currency rate and total), then the extras. Rate columns are made for
 * every VAT rate present, highest first. The rate is the one stored on the
 * document at issue (ČNB, or ECB for a Slovak company in EUR); a foreign
 * document without one gets an empty home-currency total.
 */
export function invoicesCsvBody(rows: CsvInvoiceRow[], companyVars: { key: string; value: string }[] = [], home: HomeCurrency = 'CZK'): string {
  const rates = [...new Set(rows.flatMap((r) => r.totals.byRate.map((b) => b.vatRatePercent)))].sort((a, b) => b - a);
  const rateHeaders = rates.flatMap((p) => (p > 0 ? [`Základ ${percentLabel(p)}`, `DPH ${percentLabel(p)}`] : [`Základ ${percentLabel(p)}`]));
  return csvSheet([
    [
      'Číslo',
      'Typ',
      'Vystaveno',
      'DUZP',
      'Splatnost',
      'Uhrazeno',
      'Odběratel',
      'IČO',
      'DIČ',
      'Měna',
      ...rateHeaders,
      'Základ celkem',
      'DPH celkem',
      'Celkem',
      home === 'EUR' ? 'Kurz ECB' : 'Kurz ČNB',
      `Celkem v ${home}`,
      'VS',
      'Stav',
      'Jazyk',
      'Přenesená daňová povinnost',
      'Uhrazená částka',
      'Čistý odhad (po dani a pojištění, paušál 60 %)',
      'Vlastní pole',
      'Interní poznámka',
    ],
    ...rows.map(({ invoice, contact, totals }) => {
      const perRate = rates.flatMap((p) => {
        const b = totals.byRate.find((x) => x.vatRatePercent === p);
        return p > 0 ? [b?.totalWithoutVat ?? null, b?.vatAmount ?? null] : [b?.totalWithoutVat ?? null];
      });
      const rate = invoice.currency === home ? 1 : invoice.exchangeRate == null ? null : Number(invoice.exchangeRate);
      return [
        invoice.invoiceNumber,
        TYPE_LABEL[invoice.documentType],
        csvDate(invoice.issueDate),
        csvDate(invoice.taxableSupplyDate ?? invoice.issueDate),
        csvDate(invoice.dueDate),
        csvDate(invoice.paidAt),
        contact?.legalName,
        contact?.ico,
        contact?.dic,
        invoice.currency,
        ...perRate,
        totals.totalWithoutVat,
        totals.totalVat,
        totals.totalWithVat,
        // Up to 6 decimals as stored; a plain number cell would round it to 2.
        rate == null ? null : String(rate).replace('.', ','),
        rate == null ? null : round2(totals.totalWithVat * rate),
        invoice.variableSymbol,
        STATUS_LABEL[invoice.status],
        invoice.language,
        invoice.reverseCharge ? 'ano' : '',
        Number(invoice.amountPaid ?? 0),
        burdenOf(totals.totalWithoutVat).net,
        // Internal ones included: the export goes to the company / its accountant.
        (invoice.customFields ?? [])
          .map(
            (f) =>
              `${f.label}: ${displayCustomField(f, resolveVars(invoice.customFields, totals, invoice.amountPaid, companyVars), (n) => n.toFixed(2).replace('.', ','), (v) => v)}${f.internal ? ' (interní)' : ''}`,
          )
          .join(' | '),
        invoice.internalNote,
      ];
    }),
  ]);
}
