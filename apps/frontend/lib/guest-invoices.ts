/**
 * The invoices a visitor downloaded on `/create-invoice`, kept in their
 * browser so the account they may open later can take them over (the
 * welcome screen sends them to `POST /invoices/import/guest`). Each entry is
 * exactly the body the guest PDF was made from. Nothing expires or gets
 * locked: it is a convenience, and the visitor can forget it any time.
 */
export const GUEST_HISTORY_KEY = 'billanta.guestInvoice.history';
/** A handful is enough to carry the numbering and the regular customers over. */
const MAX_GUEST_INVOICES = 20;
/** Not a deadline for the visitor: a shared computer just shouldn't hold customers' details for years. */
const KEEP_DAYS = 90;

export type GuestInvoiceBody = {
  invoiceNumber: string;
  issueDate: string;
  documentType: string;
  customer: { name: string };
  supplier: { name: string; ico?: string; dic?: string; [key: string]: unknown };
  vatPayer?: boolean;
  /** When this browser kept it (the backend schema drops the field). */
  keptAt?: string;
  [key: string]: unknown;
};

export function readGuestInvoices(): GuestInvoiceBody[] {
  try {
    const raw = localStorage.getItem(GUEST_HISTORY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    const fresh = list.filter(
      (i): i is GuestInvoiceBody =>
        typeof i?.invoiceNumber === 'string' && typeof i?.issueDate === 'string' && !(Date.parse(i.keptAt ?? '') < cutoff)
    );
    if (fresh.length < list.length) {
      if (fresh.length) localStorage.setItem(GUEST_HISTORY_KEY, JSON.stringify(fresh));
      else localStorage.removeItem(GUEST_HISTORY_KEY);
    }
    return fresh;
  } catch {
    return [];
  }
}

/** Adds one downloaded invoice; a number downloaded again replaces its earlier copy. */
export function rememberGuestInvoice(body: GuestInvoiceBody): GuestInvoiceBody[] {
  const list = [...readGuestInvoices().filter((i) => i.invoiceNumber !== body.invoiceNumber), { ...body, keptAt: new Date().toISOString() }].slice(
    -MAX_GUEST_INVOICES
  );
  try {
    localStorage.setItem(GUEST_HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Private mode / blocked storage: the carry-over is a convenience only.
  }
  return list;
}

export function forgetGuestInvoices() {
  try {
    localStorage.removeItem(GUEST_HISTORY_KEY);
  } catch {
    // Nothing stored then.
  }
}

/** `20260007` → `20260008`, `FV-2026/09` → `FV-2026/10`: the last run of digits plus one, padding kept. */
export function nextGuestNumber(previous: string): string | null {
  const m = /^(.*?)(\d+)(\D*)$/.exec(previous.trim());
  if (!m || m[2]!.length > 15) return null;
  const next = String(Number(m[2]) + 1).padStart(m[2]!.length, '0');
  return `${m[1]}${next}${m[3]}`;
}
