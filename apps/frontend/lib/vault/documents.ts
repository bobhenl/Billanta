import {
  generateIsdocXml,
  generateUblInvoiceXml,
  isSealed,
  open,
  openInvoicePdfModel,
  renderInvoicePdf,
  type InvoicePdfModel,
  type IsdocInvoiceInput,
  type UblOptions,
  type VaultKey
} from '@faktur/cz-compliance';

/**
 * Důvěrný režim: the PDF and ISDOC of a sealed invoice are made here, in the
 * browser. The server hands over the same layout data it prints from, with
 * the notes and item texts still encrypted; the key never leaves this tab.
 */

export interface RenderedDocument {
  filename: string;
  blob: Blob;
}

/** A backend error code ("confidential_content", "not_found"…), so callers can map it to text. */
export class DocumentError extends Error {}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api/files/${path}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
    const code = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : 'download_failed';
    throw new DocumentError(code);
  }
  return (await res.json()) as T;
}

let fonts: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer } | null> | null = null;

/** DejaVu Sans, as on the server's PDFs; without it Czech letters would be missing. */
function pdfFonts() {
  fonts ??= Promise.all(
    (['regular', 'bold'] as const).map((weight) =>
      fetch(`/api/files/invoices/pdf-fonts/${weight}`).then((r) => {
        if (!r.ok) throw new Error('font');
        return r.arrayBuffer();
      })
    )
  )
    .then(([regular, bold]) => ({ regular: regular!, bold: bold! }))
    .catch(() => {
      fonts = null;
      return null;
    });
  return fonts;
}

export async function renderSealedPdf(key: VaultKey, invoiceId: string): Promise<RenderedDocument> {
  const { filename, model } = await getJson<{ filename: string; model: InvoicePdfModel }>(`invoices/${invoiceId}/pdf-model`);
  const opened = await openInvoicePdfModel(model, (value) => open(key, value));
  // pdfkit is large; only someone downloading a sealed invoice loads it.
  const [{ default: PDFDocument }, f] = await Promise.all([import('pdfkit/js/pdfkit.standalone'), pdfFonts()]);
  const pdf = await renderInvoicePdf(PDFDocument, opened, f);
  return { filename, blob: new Blob([pdf as BlobPart], { type: 'application/pdf' }) };
}

/** ISDOC and UBL share one input; only the item texts can be sealed in it. */
async function openInput(key: VaultKey, input: IsdocInvoiceInput): Promise<IsdocInvoiceInput> {
  const lineItems = await Promise.all(
    input.lineItems.map(async (item) => ({ ...item, description: isSealed(item.description) ? await open(key, item.description) : item.description }))
  );
  return { ...input, lineItems };
}

export async function renderSealedIsdoc(key: VaultKey, invoiceId: string): Promise<RenderedDocument> {
  const { filename, input } = await getJson<{ filename: string; input: IsdocInvoiceInput }>(`invoices/${invoiceId}/isdoc-input`);
  const xml = generateIsdocXml(await openInput(key, input));
  return { filename, blob: new Blob([xml], { type: 'application/xml' }) };
}

export async function renderSealedUbl(key: VaultKey, invoiceId: string): Promise<RenderedDocument> {
  const { filename, input, options } = await getJson<{ filename: string; input: IsdocInvoiceInput; options: UblOptions }>(`invoices/${invoiceId}/ubl-input`);
  const xml = generateUblInvoiceXml(await openInput(key, input), options);
  return { filename, blob: new Blob([xml], { type: 'application/xml' }) };
}

export function saveDocument(doc: RenderedDocument): void {
  const url = URL.createObjectURL(doc.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Sends a sealed invoice with the files made above. They pass through the
 * server once for this e-mail; the user said yes to that in the send dialog.
 */
export async function sendWithSealedFiles(invoiceId: string, files: { pdf?: RenderedDocument; isdoc?: RenderedDocument }): Promise<void> {
  const form = new FormData();
  if (files.pdf) form.append('pdf', files.pdf.blob, files.pdf.filename);
  if (files.isdoc) form.append('isdoc', files.isdoc.blob, files.isdoc.filename);
  const res = await fetch(`/api/invoices/${invoiceId}/send-with-files`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
    throw new DocumentError(typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : 'send_failed');
  }
}
