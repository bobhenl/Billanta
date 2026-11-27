import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import PDFDocument from "pdfkit";
import { renderTaxReturnPdf, type TaxReturnReport } from "@faktur/cz-compliance";

// The sections, CSV and PDF layout are shared with the browser (sealed amounts): cz-compliance.
export { taxReturnCsv, taxReturnFileName, taxReturnSections, type TaxReturnReport } from "@faktur/cz-compliance";

// DejaVu Sans covers č/ř/ě/ů/ľ/ô; Helvetica (WinAnsi) stays as a fallback, as in invoice-pdf.service.ts.
function resolveFonts(): { regular: string; bold: string } | null {
  try {
    const dir = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
    const regular = join(dir, "DejaVuSans.ttf");
    const bold = join(dir, "DejaVuSans-Bold.ttf");
    return existsSync(regular) && existsSync(bold) ? { regular, bold } : null;
  } catch {
    return null;
  }
}
const FONTS = resolveFonts();

export async function taxReturnPdf(r: TaxReturnReport): Promise<Buffer> {
  return Buffer.from(await renderTaxReturnPdf(PDFDocument, r, FONTS));
}
