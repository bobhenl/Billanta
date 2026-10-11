/**
 * Finds a QR Platba / QR Faktura code on a received invoice — a photo, a
 * screenshot or a PDF — entirely in the browser (jsQR; PDFs are rendered with
 * pdf.js served from /public/pdfjs). Nothing is uploaded and no AI is
 * involved, so it's instant and free; the expense form falls back to the AI
 * reader when no code is found.
 */
import jsQR from 'jsqr';
import { parseInvoiceQr, type ScannedInvoice } from '@faktur/cz-compliance';

export type { ScannedInvoice };

/** Decodes every QR-ish region we can find in the pixels, trying a few scales (big photos hide small codes). */
function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  const full = ctx.getImageData(0, 0, width, height);
  const hit = jsQR(full.data, width, height, { inversionAttempts: 'attemptBoth' });
  if (hit?.data) return hit.data;
  // Retry on quadrants: on an A4 page the code is small, and jsQR does better when it fills more of the frame.
  const qw = Math.floor(width / 2);
  const qh = Math.floor(height / 2);
  for (const [x, y] of [
    [0, qh],
    [0, 0],
    [qw, qh],
    [qw, 0]
  ] as const) {
    const part = ctx.getImageData(x, y, qw, qh);
    const r = jsQR(part.data, qw, qh, { inversionAttempts: 'dontInvert' });
    if (r?.data) return r.data;
  }
  return null;
}

function canvasOf(source: CanvasImageSource, w: number, h: number, maxSide = 2000): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function imageTexts(file: Blob): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  try {
    const out: string[] = [];
    for (const side of [2000, 1200]) {
      const text = decodeCanvas(canvasOf(bitmap, bitmap.width, bitmap.height, side));
      if (text) out.push(text);
      if (out.length) break;
    }
    return out;
  } finally {
    bitmap.close();
  }
}

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: ArrayBuffer }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getViewport(o: { scale: number }): { width: number; height: number };
        render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
      }>;
      destroy(): Promise<void>;
    }>;
  };
}

let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (import(/* webpackIgnore: true */ '/pdfjs/pdf.min.mjs' as string) as Promise<PdfJs>).then((m) => {
    m.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
    return m;
  });
  return pdfjs;
}

async function pdfTexts(file: Blob): Promise<string[]> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    for (let n = 1; n <= Math.min(doc.numPages, 2); n++) {
      const page = await doc.getPage(n);
      // ~200 dpi: enough modules per pixel for a 3 cm code on A4.
      const viewport = page.getViewport({ scale: 2.8 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const text = decodeCanvas(canvas);
      if (text) return [text];
    }
    return [];
  } finally {
    await doc.destroy();
  }
}

/** The invoice data from the first QR Platba / QR Faktura on `file`, or null. Never throws. */
export async function scanInvoiceFile(file: Blob): Promise<ScannedInvoice | null> {
  try {
    const texts = file.type === 'application/pdf' ? await pdfTexts(file) : await imageTexts(file);
    for (const text of texts) {
      const parsed = parseInvoiceQr(text);
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** One video frame → parsed code (live camera scanning). */
export function scanVideoFrame(video: HTMLVideoElement): ScannedInvoice | null {
  if (!video.videoWidth) return null;
  const text = decodeCanvas(canvasOf(video, video.videoWidth, video.videoHeight, 900));
  return text ? parseInvoiceQr(text) : null;
}
