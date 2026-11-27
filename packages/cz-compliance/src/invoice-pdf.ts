/*
 * The invoice PDF layout, shared by the backend (Node pdfkit) and the
 * browser (pdfkit's standalone build). Everything that needs the database,
 * the company settings or a QR library is resolved by the backend into an
 * `InvoicePdfModel` first (apps/backend/src/invoices/invoice-pdf.service.ts);
 * this module only draws it. That split is what lets "Důvěrný režim" print
 * a sealed invoice in the browser: the server builds the model with the
 * encrypted texts left as envelopes, the browser opens them and renders the
 * same layout. pdfkit is passed in, so neither build is imported here.
 */
import { BRAND_MARK_PNG_BASE64 } from './brand-mark.js';
import { isSealed } from './vault/confidential.js';
import { fillTemplate } from './fill-template.js';

/** Joins two label sets for a bilingual PDF; the renderer splits on it where space is tight. */
export const BILINGUAL_SEPARATOR = ' / ';

/** Puts each language on its own line (narrow table headers, the total box). */
const stacked = (label: string) => label.replace(BILINGUAL_SEPARATOR, '\n');

const MUTED = '#6b7280';
const BRAND_MARK = `data:image/png;base64,${BRAND_MARK_PNG_BASE64}`;

/** Labels the layout itself prints; the backend resolves them in the document's language(s). */
export interface InvoicePdfLabels {
  supplier: string;
  customer: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vat: string;
  total: string;
  vatRecap: string;
  paidSoFar: string;
  remaining: string;
}

export interface InvoicePdfParty {
  name: string;
  /** Lines under the name; `width` only where the original layout wrapped at a fixed width. */
  lines: { text: string; width?: number }[];
}

/** One table row, with every number already formatted by the backend. */
export interface InvoicePdfItem {
  /** May be a `enc:v1:` envelope until the browser opens it. */
  description: string;
  code: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  vatRate: string;
  total: string;
}

export type InvoicePdfQrSlot = { label: string; png: string } | { label: string; pending: string };

/**
 * Everything the layout draws. Plain JSON, so it travels to the browser.
 * Images are `data:` URLs. Only `noteAbove`, `notes.noteBelow` and the item
 * descriptions can be sealed; `vars` fills their `{…}` placeholders.
 */
export interface InvoicePdfModel {
  version: 1;
  info: { title: string; creator: string | null };
  title: string;
  number: string;
  accent: string;
  tint: string;
  logo: string | null;
  stamp: { text: string; color: string } | null;
  labels: InvoicePdfLabels;
  supplier: InvoicePdfParty;
  customer: InvoicePdfParty;
  rows: { left: [string, string][]; right: [string, string][] };
  noteAbove: string | null;
  vars: Record<string, string>;
  table: { showVat: boolean; lumpSum: boolean; hasDiscount: boolean; items: InvoicePdfItem[] };
  totals: {
    showVat: boolean;
    byRate: { base: string; amount: string; vat: string }[];
    label: string;
    amount: string;
    paid: { amount: string; remaining: string } | null;
    fx: string[] | null;
  };
  payment: { rows: [string, string][]; qr: InvoicePdfQrSlot | null; linkQr: { label: string; png: string } | null };
  notes: {
    reverseCharge: string | null;
    proforma: string | null;
    paymentInstructions: string | null;
    noteBelow: string | null;
    issuedBy: string | null;
  };
  credit: { text: string; url: string } | null;
  watermark: { stamp: string; footer: string } | null;
}

/** A TrueType font as a path (Node) or its bytes (browser). */
export type PdfFontSource = string | ArrayBuffer | Uint8Array;
export interface PdfFonts {
  regular: PdfFontSource;
  bold: PdfFontSource;
}

/** The pdfkit `PDFDocument` class, from `pdfkit` on the server or `pdfkit/js/pdfkit.standalone` in the browser. */
export type PdfDocumentClass = new (options?: object) => unknown;

type Doc = PDFKit.PDFDocument;

/**
 * Whether a note already says the customer pays the VAT. Invoices imported
 * from BitFaktura carry "Daň odvede zákazník … / Reverse charge" in their own
 * note, and printing our line on top of it showed the same thing twice.
 */
export function mentionsReverseCharge(note: string | null | undefined): boolean {
  if (!note) return false;
  const text = note.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /dan odvede zakaznik|prenesen\w* danov|reverse[ -]?charge/.test(text);
}

/** The texts of a model that "Důvěrný režim" may have sealed. */
export function sealableModelTexts(model: InvoicePdfModel): (string | null)[] {
  return [model.noteAbove, model.notes.noteBelow, ...model.table.items.map((i) => i.description)];
}

/**
 * An envelope anywhere in a text. The buyer block (category "contacts")
 * prints envelopes inside composed lines such as "PSČ město" or
 * "Kontaktní osoba: …", so whole-string checks are not enough there.
 */
const ENVELOPE_IN_TEXT = /enc:v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]+={0,2}(?::[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{64})?/g;

const customerTexts = (model: InvoicePdfModel): string[] =>
  model.customer ? [model.customer.name, ...model.customer.lines.map((l) => l.text)] : [];

const holdsEnvelope = (v: string | null) => !!v && (isSealed(v) || new RegExp(ENVELOPE_IN_TEXT.source).test(v));

/** The model with every sealed text replaced by `open(text)`; plain texts pass through. */
export async function openInvoicePdfModel(model: InvoicePdfModel, open: (value: string) => Promise<string>): Promise<InvoicePdfModel> {
  const opened = async (v: string | null) => (v && isSealed(v) ? open(v) : v);
  const openedIn = async (text: string) => {
    let out = '';
    let at = 0;
    for (const m of text.matchAll(ENVELOPE_IN_TEXT)) {
      out += text.slice(at, m.index) + (await open(m[0]));
      at = m.index + m[0].length;
    }
    return out + text.slice(at);
  };
  return {
    ...model,
    noteAbove: await opened(model.noteAbove),
    notes: { ...model.notes, noteBelow: await opened(model.notes.noteBelow) },
    table: { ...model.table, items: await Promise.all(model.table.items.map(async (i) => ({ ...i, description: (await opened(i.description)) ?? '' }))) },
    ...(model.customer
      ? {
          customer: {
            name: await openedIn(model.customer.name),
            lines: await Promise.all(model.customer.lines.map(async (l) => ({ ...l, text: await openedIn(l.text) }))),
          },
        }
      : {}),
  };
}

function startDoc(PDFDocument: PdfDocumentClass, options: object, fonts: PdfFonts | null) {
  const doc = new PDFDocument(options) as Doc;
  if (fonts) {
    doc.registerFont('Body', fonts.regular as never);
    doc.registerFont('Body-Bold', fonts.bold as never);
  }
  const chunks: Uint8Array[] = [];
  doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('end', () => {
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      resolve(out);
    });
    doc.on('error', reject);
  });
  return { doc, finished, regular: fonts ? 'Body' : 'Helvetica', bold: fonts ? 'Body-Bold' : 'Helvetica-Bold' };
}

/**
 * Draws the invoice. Refuses a model that still holds an envelope: the
 * ciphertext must never end up printed as if it were the text.
 */
export async function renderInvoicePdf(PDFDocument: PdfDocumentClass, model: InvoicePdfModel, fonts: PdfFonts | null): Promise<Uint8Array> {
  if ([...sealableModelTexts(model), ...customerTexts(model)].some(holdsEnvelope)) throw new Error('confidential_content');
  const { doc, finished, regular, bold } = startDoc(
    PDFDocument,
    {
      size: 'A4',
      margin: 50,
      bufferPages: true,
      info: { Title: model.info.title, ...(model.info.creator ? { Creator: model.info.creator } : {}) },
    },
    fonts,
  );
  const f = { regular, bold };
  const fill = (text: string | null) => (text ? fillTemplate(text, model.vars) : text);

  renderHeader(doc, f, model);
  if (model.noteAbove) {
    doc.font(regular).fontSize(9).fillColor('black').text(fill(model.noteAbove) ?? '', 50, doc.y, { width: 500 });
    doc.moveDown(0.8);
  }
  renderLineItemsTable(doc, f, model);
  const totalsTop = renderTotals(doc, f, model);
  renderPaymentBlock(doc, f, model.payment, totalsTop);
  renderFooterNotes(doc, f, model, fill);
  if (model.credit) drawBrandCredit(doc, model.credit, regular);
  if (model.watermark) drawWatermark(doc, model.watermark, regular);

  doc.end();
  return finished;
}

/**
 * A plain A4 letter: a bold title and paragraphs separated by blank lines,
 * with the same font and footer credit as the invoices.
 */
export async function renderLetterPdf(
  PDFDocument: PdfDocumentClass,
  input: { title: string; body: string; creator: string; credit: { text: string; url: string } },
  fonts: PdfFonts | null,
): Promise<Uint8Array> {
  const { doc, finished, regular, bold } = startDoc(
    PDFDocument,
    { size: 'A4', margin: 60, bufferPages: true, info: { Title: input.title, Creator: input.creator } },
    fonts,
  );
  const width = doc.page.width - 120;
  doc.font(bold).fontSize(15).fillColor('black').text(input.title, 60, 60, { width });
  doc.moveDown(1.2);
  doc.font(regular).fontSize(10.5);
  for (const paragraph of input.body.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    doc.text(paragraph.trim(), { width, lineGap: 2 });
    doc.moveDown(0.8);
  }
  drawBrandCredit(doc, input.credit, regular);
  doc.end();
  return finished;
}

type Fonts = { regular: string; bold: string };

function renderHeader(doc: Doc, f: Fonts, m: InvoicePdfModel): void {
  doc.font(f.bold).fontSize(18).fillColor(m.accent).text(m.title, 50, 50);
  doc.font(f.regular).fontSize(11).fillColor('black').text(m.number, 50, doc.y + 2);

  // Company logo, top right (idea from faktorio, MIT © Jiri Spac). A broken
  // image must never block the invoice, so failures just skip it.
  let hasLogo = false;
  if (m.logo) {
    try {
      doc.image(m.logo, 395, 40, { fit: [150, 50], align: 'right' });
      hasLogo = true;
    } catch {
      hasLogo = false;
    }
  }
  if (m.stamp) {
    doc.font(f.bold).fontSize(14).fillColor(m.stamp.color).text(m.stamp.text, 350, hasLogo ? 88 : 56, { width: 200, align: 'right' });
  }

  const startY = 105;
  const right = 310;
  const party = (label: string, p: InvoicePdfParty, x: number) => {
    doc.font(f.bold).fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x, startY);
    doc.font(f.bold).fontSize(10).fillColor('black').text(p.name, x, doc.y + 2, { width: 240 });
    doc.font(f.regular).fontSize(9);
    for (const line of p.lines) {
      if (line.width) doc.text(line.text, x, doc.y, { width: line.width });
      else doc.text(line.text, x);
    }
    return doc.y;
  };
  const leftEnd = party(m.labels.supplier, m.supplier, 50);
  const rightEnd = party(m.labels.customer, m.customer, right);

  // Dates (left) and payment details (right).
  let y = Math.max(leftEnd, rightEnd) + 18;
  doc.moveTo(50, y - 8).lineTo(545, y - 8).strokeColor('#e5e7eb').stroke();
  const rows = Math.max(m.rows.left.length, m.rows.right.length);
  for (let i = 0; i < rows; i++) {
    // A long IBAN or custom-field value wraps, so the row grows to its tallest cell.
    let height = 14;
    for (const [x, row] of [
      [50, m.rows.left[i]],
      [right, m.rows.right[i]],
    ] as const) {
      if (!row) continue;
      doc.font(f.regular).fontSize(9).fillColor(MUTED).text(row[0], x, y, { width: 105 });
      const labelHeight = doc.heightOfString(row[0], { width: 105 });
      doc.font(f.bold).fillColor('black').text(row[1], x + 105, y, { width: 135 });
      height = Math.max(height, labelHeight + 3, doc.heightOfString(row[1], { width: 135 }) + 3);
    }
    y += height;
  }
  doc.y = y + 12;
  doc.x = 50;
}

function renderLineItemsTable(doc: Doc, f: Fonts, m: InvoicePdfModel): void {
  const { showVat, lumpSum, hasDiscount, items } = m.table;
  const t = m.labels;
  // Without the VAT column the description takes its 40pt, without quantity and unit price all the room.
  const shift = showVat ? 0 : 40;
  const columns = {
    description: { x: 50, width: lumpSum ? 405 : (hasDiscount ? 185 : 225) + shift },
    quantity: { x: (hasDiscount ? 235 : 275) + shift, width: 60 },
    unitPrice: { x: (hasDiscount ? 300 : 335) + shift, width: hasDiscount ? 75 : 80 },
    discount: { x: 375 + shift, width: 40 },
    vatRate: { x: 415, width: 40 },
    lineTotal: { x: 455, width: 90 },
  };

  // Bilingual labels go on two lines, so the header band grows.
  const twoLine = t.description.includes(BILINGUAL_SEPARATOR);
  const header = (top: number) => {
    doc.rect(50, top - 4, 495, twoLine ? 27 : 18).fill('#f3f4f6');
    doc.font(f.bold).fontSize(8).fillColor(MUTED);
    doc.text(stacked(t.description), columns.description.x + 4, top);
    if (!lumpSum) {
      doc.text(stacked(t.quantity), columns.quantity.x, top, { width: columns.quantity.width, align: 'right' });
      doc.text(stacked(t.unitPrice), columns.unitPrice.x, top, { width: columns.unitPrice.width, align: 'right' });
    }
    if (hasDiscount) doc.text(stacked(t.discount), columns.discount.x, top, { width: columns.discount.width, align: 'right' });
    if (showVat) doc.text(stacked(t.vat), columns.vatRate.x, top, { width: columns.vatRate.width, align: 'right' });
    doc.text(stacked(t.total), columns.lineTotal.x, top, { width: columns.lineTotal.width - 4, align: 'right' });
    return top + (twoLine ? 29 : 20);
  };

  let y = header(doc.y + 4);
  doc.font(f.regular).fontSize(9).fillColor('black');
  for (const item of items) {
    const descHeight = doc.heightOfString(item.description, { width: columns.description.width - 4 }) + (item.code ? 10 : 0);
    if (y + descHeight > 760) {
      doc.addPage();
      y = header(60);
      doc.font(f.regular).fontSize(9).fillColor('black');
    }
    doc.text(item.description, columns.description.x + 4, y, { width: columns.description.width - 4 });
    if (item.code) {
      doc.fontSize(7.5).fillColor(MUTED).text(item.code, columns.description.x + 4, doc.y, { width: columns.description.width - 4 });
      doc.fontSize(9).fillColor('black');
    }
    if (!lumpSum) {
      doc.text(item.quantity, columns.quantity.x, y, { width: columns.quantity.width, align: 'right' });
      doc.text(item.unitPrice, columns.unitPrice.x, y, { width: columns.unitPrice.width, align: 'right' });
    }
    if (hasDiscount) doc.text(item.discount, columns.discount.x, y, { width: columns.discount.width, align: 'right' });
    if (showVat) doc.text(item.vatRate, columns.vatRate.x, y, { width: columns.vatRate.width, align: 'right' });
    doc.text(item.total, columns.lineTotal.x, y, { width: columns.lineTotal.width - 4, align: 'right' });
    y += Math.max(descHeight, 11) + 7;
    doc.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor('#f3f4f6').stroke();
  }
  doc.y = y + 6;
}

function renderTotals(doc: Doc, f: Fonts, m: InvoicePdfModel): number {
  const t = m.labels;
  const totals = m.totals;
  if (doc.y > 650) doc.addPage();
  const x = 300;
  let y = doc.y;
  const top = y;
  if (totals.showVat) {
    doc.font(f.bold).fontSize(8).fillColor(MUTED).text(t.vatRecap.toUpperCase(), x, y);
    y += 14;
  }
  doc.font(f.regular).fontSize(9).fillColor('black');
  for (const entry of totals.showVat ? totals.byRate : []) {
    // Bilingual labels can wrap, so each row grows to its tallest cell.
    const cells: Array<[string, number, number, 'left' | 'right']> = [
      [entry.base, x, 80, 'left'],
      [entry.amount, x + 80, 80, 'right'],
      [entry.vat, x + 160, 85, 'right'],
    ];
    let height = 13;
    for (const [text, cx, width, align] of cells) {
      doc.text(text, cx, y, { width, align });
      height = Math.max(height, doc.heightOfString(text, { width }) + 2);
    }
    y += height;
  }
  y += 6;
  doc.rect(x, y - 4, 245, 26).fill(m.tint);
  const bilingual = totals.label.includes(BILINGUAL_SEPARATOR);
  doc
    .font(f.bold)
    .fontSize(bilingual ? 8.5 : 12)
    .fillColor(m.accent)
    .text(stacked(totals.label), x + 8, bilingual ? y - 1 : y + 3, { width: 120 });
  doc.fontSize(12).text(totals.amount, x + 110, y + 3, { width: 127, align: 'right' });
  doc.fillColor('black');
  y += 34;
  if (totals.paid) {
    doc.font(f.regular).fontSize(9).fillColor('black');
    doc.text(stacked(t.paidSoFar), x + 8, y, { width: 120 });
    doc.text(totals.paid.amount, x + 110, y, { width: 127, align: 'right' });
    y += t.paidSoFar.includes(BILINGUAL_SEPARATOR) ? 22 : 14;
    doc.font(f.bold).fillColor(m.accent);
    doc.text(stacked(t.remaining), x + 8, y, { width: 120 });
    doc.text(totals.paid.remaining, x + 110, y, { width: 127, align: 'right' });
    doc.fillColor('black');
    y += t.remaining.includes(BILINGUAL_SEPARATOR) ? 26 : 18;
  }
  if (totals.fx) {
    doc.font(f.regular).fontSize(8.5).fillColor(MUTED);
    totals.fx.forEach((line, i) => {
      doc.text(line, x, y, { width: 245 });
      y += i === totals.fx!.length - 1 ? 16 : 12;
    });
    doc.fillColor('black');
  }
  doc.y = y;
  doc.x = 50;
  return top;
}

/**
 * The bank details and the QR code side by side, to the left of the totals
 * block and level with its top (`top`). The rows stack label over value so
 * they fit beside the code without making the block taller than the code.
 */
function renderPaymentBlock(doc: Doc, f: Fonts, payment: InvoicePdfModel['payment'], top: number): void {
  const codes = [payment.qr, payment.linkQr].filter((code) => code !== null);
  const rows = payment.rows;
  if (!rows.length && !codes.length) return;
  const size = 90;
  codes.forEach((code, i) => {
    const cx = 50 + i * (size + 15);
    doc.font(f.bold).fontSize(8).fillColor(MUTED).text(code.label, cx, top, { width: codes.length > 1 ? size + 10 : 240, lineBreak: false });
    if ('png' in code) {
      doc.image(code.png, cx, top + 12, { width: size, height: size });
    } else {
      doc.save().roundedRect(cx, top + 12, size, size, 4).dash(3, { space: 3 }).strokeColor(MUTED).stroke().undash().restore();
      doc.font(f.regular).fontSize(7.5).fillColor(MUTED).text(code.pending, cx + 8, top + 12 + size / 2 - 12, { width: size - 16, align: 'center' });
    }
  });
  // Two codes fill the width beside the totals, so the bank details go under them.
  const below = codes.length > 1;
  const x = codes.length === 1 ? 50 + size + 10 : 50;
  const width = 290 - x;
  let y = below ? top + 12 + size + 10 : codes.length ? top + 14 : top;
  for (const [label, value] of rows) {
    doc.font(f.regular).fontSize(7.5).fillColor(MUTED).text(label, x, y, { width });
    y += doc.heightOfString(label, { width }) + 1;
    doc.font(f.bold).fontSize(9).fillColor('black').text(value, x, y, { width });
    y += doc.heightOfString(value, { width }) + 5;
  }
  doc.fillColor('black');
  doc.y = Math.max(doc.y, y, codes.length ? top + 12 + size + 8 : top);
}

function renderFooterNotes(doc: Doc, f: Fonts, m: InvoicePdfModel, fill: (text: string | null) => string | null): void {
  const n = m.notes;
  const notes = [
    mentionsReverseCharge(n.noteBelow) ? null : n.reverseCharge,
    n.proforma,
    n.paymentInstructions,
    fill(n.noteBelow),
    n.issuedBy,
  ].filter((note): note is string => !!note);
  if (notes.length === 0) return;
  doc.moveDown(1);
  doc.font(f.regular).fontSize(8.5).fillColor(MUTED);
  for (const note of notes) {
    doc.text(note, 50, doc.y, { width: 495 });
    doc.moveDown(0.4);
  }
  doc.fillColor('black');
}

/**
 * One small grey line at the very bottom of every page, the way Fakturoid
 * and iDoklad sign their PDFs. Drawn inside the bottom margin, so the margin
 * is lifted for the moment or pdfkit would start a new page.
 */
function drawBrandCredit(doc: Doc, credit: { text: string; url: string }, font: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    // Mark + text centred together as one line.
    doc.font(font).fontSize(7.5);
    const mark = 11;
    const width = Math.ceil(doc.widthOfString(credit.text)) + 1;
    const left = 50 + (495 - (mark + 5 + width)) / 2;
    doc.image(BRAND_MARK, left, doc.page.height - 31, { width: mark, height: mark });
    // pdfkit needs an explicit width to size the link annotation.
    doc.fillColor('#4b5563').text(credit.text, left + mark + 5, doc.page.height - 28.5, { width, link: credit.url, lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.fillColor('black');
}

/**
 * Stamps every buffered page; drawn last so the stamp sits on top. `font` is
 * the body font (it has the Czech diacritics).
 */
function drawWatermark(doc: Doc, mark: { stamp: string; footer: string }, font: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const { width, height } = doc.page;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.save();
    doc.rotate(-35, { origin: [width / 2, height / 2] });
    // At 35° a line through the centre leaves the page at the side edges, so
    // the page width bounds how long the stamp may be.
    doc.font(font).fontSize(60);
    const room = (0.8 * width) / Math.cos((35 * Math.PI) / 180);
    const size = Math.min(60, (60 * room) / doc.widthOfString(mark.stamp));
    doc.fontSize(size).fillColor('#dc2626').fillOpacity(0.15);
    const w = doc.widthOfString(mark.stamp);
    doc.text(mark.stamp, width / 2 - w / 2, height / 2 - size / 2, { lineBreak: false });
    doc.restore();

    doc.font(font).fontSize(7.5).fillColor('#dc2626').fillOpacity(1);
    doc.text(mark.footer, 50, height - 44, { width: width - 100, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.fillColor('black');
}
