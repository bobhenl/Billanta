/** What the confirmation step shows from an EPO file before it is saved. */
export interface VatFilingSummary {
  /** c_ufo of VetaP; null when EPO will ask for it. */
  office: number | null;
  /** DPHDP3 Veta6: tax on output, deduction, own tax or excess deduction. */
  dp3?: { output: number; deduction: number; payable: number; refund: number };
  /** DPHKH1 rows in sections A and B (C only sums them up). */
  khRows?: number;
  /** DPHSHV: rows and the total value of supplies. */
  shv?: { rows: number; total: number };
}

const num = (el: Element | null | undefined, attr: string) => Number(el?.getAttribute(attr) ?? 0) || 0;

/** Reads our own EPO XML; null for anything else (the Slovak files, a parse error). */
export function vatFilingSummary(xml: string): VatFilingSummary | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (root?.nodeName !== 'Pisemnost') return null;
  const form = root.firstElementChild;
  if (!form) return null;
  const p = form.querySelector('VetaP');
  const ufo = p?.getAttribute('c_ufo');
  const out: VatFilingSummary = { office: ufo ? Number(ufo) : null };
  if (form.nodeName === 'DPHDP3') {
    const v6 = form.querySelector('Veta6');
    out.dp3 = { output: num(v6, 'dan_zocelk'), deduction: num(v6, 'odp_zocelk'), payable: num(v6, 'dano_da'), refund: num(v6, 'dano_no') };
  } else if (form.nodeName === 'DPHKH1') {
    out.khRows = [...form.children].filter((c) => /^Veta[AB]/.test(c.nodeName)).length;
  } else if (form.nodeName === 'DPHSHV') {
    const rows = [...form.querySelectorAll('VetaR')];
    out.shv = { rows: rows.length, total: rows.reduce((s, r) => s + num(r, 'pln_hodnota'), 0) };
  }
  return out;
}
