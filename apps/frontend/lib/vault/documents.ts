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

type Fonts = { regular: ArrayBuffer; bold: ArrayBuffer };
const fontLoads = new Map<string, Promise<Fonts | null>>();

/**
 * DejaVu Sans, as on the server's PDFs; without it Czech letters would be
 * missing. The dashboard loads it through the session proxy, the client's
 * public page through `/api/public/pdf-fonts`.
 */
function pdfFonts(base = '/api/files/invoices/pdf-fonts') {
  const cached = fontLoads.get(base);
  if (cached) return cached;
  const load = Promise.all(
    (['regular', 'bold'] as const).map((weight) =>
      fetch(`${base}/${weight}`).then((r) => {
        if (!r.ok) throw new Error('font');
        return r.arrayBuffer();
      })
    )
  )
    .then(([regular, bold]) => ({ regular: regular!, bold: bold! }))
    .catch(() => {
      fontLoads.delete(base);
      return null;
    });
  fontLoads.set(base, load);
  return load;
}

async function drawPdf(model: InvoicePdfModel, fontBase?: string): Promise<Uint8Array> {
  // pdfkit is large; only someone downloading a sealed invoice loads it.
  const [{ default: PDFDocument }, f] = await Promise.all([import('pdfkit/js/pdfkit.standalone'), pdfFonts(fontBase)]);
  return renderInvoicePdf(PDFDocument, model, f);
}

export async function renderSealedPdf(key: VaultKey, invoiceId: string): Promise<RenderedDocument> {
  const { filename, model } = await getJson<{ filename: string; model: InvoicePdfModel }>(`invoices/${invoiceId}/pdf-model`);
  const pdf = await drawPdf(await openInvoicePdfModel(model, (value) => open(key, value)));
  return { filename, blob: new Blob([pdf as BlobPart], { type: 'application/pdf' }) };
}

/**
 * The client's /i/ page: the PDF of an encrypted document, with the item
 * texts the page already opened with its link key (`openItem` maps a
 * ciphertext to its text, or throws when it stayed closed).
 */
export async function renderClientPdf(token: string, openItem: (cipher: string) => Promise<string>): Promise<RenderedDocument> {
  const res = await fetch(`/api/public/invoices/${encodeURIComponent(token)}/pdf-model`, { cache: 'no-store' });
  if (!res.ok) throw new DocumentError('download_failed');
  const { filename, model } = (await res.json()) as { filename: string; model: InvoicePdfModel };
  const pdf = await drawPdf(await openInvoicePdfModel(model, openItem), '/api/public/pdf-fonts');
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
 * Sends the invoice with what this browser made or decrypted for this one
 * e-mail: a sealed invoice's PDF/ISDOC (made above) and decrypted
 * attachments, in one request. They pass through the server once; the user
 * said yes to that in the send dialog. Returns the backend's answer.
 */
export async function sendWithSealedFiles(
  invoiceId: string,
  files: { pdf?: RenderedDocument; isdoc?: RenderedDocument; attachments?: File[] }
): Promise<unknown> {
  const form = new FormData();
  if (files.pdf) form.append('pdf', files.pdf.blob, files.pdf.filename);
  if (files.isdoc) form.append('isdoc', files.isdoc.blob, files.isdoc.filename);
  for (const file of files.attachments ?? []) form.append('files', file, file.name);
  const res = await fetch(`/api/invoices/${invoiceId}/send-with-files`, { method: 'POST', body: form });
  const body = (await res.json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
  if (!res.ok) {
    const nested = body?.message && typeof body.message === 'object' ? (body.message as { error?: unknown }).error : undefined;
    const code = [body?.message, nested, body?.error].find((v): v is string => typeof v === 'string');
    throw new DocumentError(code ?? 'send_failed');
  }
  return body;
}
