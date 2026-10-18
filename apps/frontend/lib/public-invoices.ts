/**
 * Client-portal data access — talks to the backend's PUBLIC, unauthenticated
 * `GET /api/v1/public/invoices/:token` endpoint (`apps/backend/src/public-
 * invoices`). No session/JWT is ever attached here on purpose: a client
 * opening an emailed invoice link has neither, and the endpoint doesn't
 * accept or need one (see that module's doc comments for the full RLS/
 * SECURITY DEFINER story behind it).
 *
 * `BACKEND_URL` is a plain server-side env var (NOT `NEXT_PUBLIC_*`) because
 * this fetch only ever runs in the Server Component that renders
 * `app/[locale]/i/[token]/page.tsx` — it never needs to reach the browser
 * bundle. Defaults to the backend's own default port (see
 * `apps/backend/src/main.ts`) for local dev.
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:3000").replace(/\/$/, "");

export type PublicInvoiceStatus = "draft" | "pending_review" | "issued" | "paid" | "cancelled";

export interface PublicInvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number | null;
  sortOrder: number;
}

export interface PublicInvoiceSupplier {
  companyName: string;
  bankAccountIban: string | null;
  bankAccountNumber: string | null;
  bankAccountBankCode: string | null;
  /** Registered country: SK gets a PAY by square code instead of SPAYD. */
  country?: string | null;
}

export interface PublicInvoice {
  /** Issued in the demo playground: made up, shown with a notice (backend src/demo/); missing on an older backend. */
  demo?: boolean;
  invoiceNumber: string | null;
  variableSymbol: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  status: PublicInvoiceStatus;
  lineItems: PublicInvoiceLineItem[];
  subtotal: number;
  vatTotal: number;
  total: number;
  amountPaid?: number;
  /** Built-in key plus the custom label/instructions (Settings → Způsoby úhrady). */
  paymentMethod?: string;
  paymentMethodLabel?: string | null;
  paymentInstructions?: string | null;
  supplier: PublicInvoiceSupplier | null;
  /** Files the supplier chose to offer for download here. */
  attachments?: { id: string; filename: string; mime: string; sizeBytes: number }[];
  /** Server-built QR Faktura (SID) with both parties' IČO/DIČ and the VAT recap. */
  qrInvoice?: string | null;
  /** Buyer country (ISO alpha-2); with the IBAN it picks SPAYD or PAY by square. */
  buyerCountry?: string | null;
  /** Present for quotes: the client's accept/reject state. */
  quote?: { canRespond: boolean; response: 'accepted' | 'rejected' | null; respondedAt: string | null; name: string | null } | null;
  /** The supplier accepts cards (own Stripe account) and something is left to pay. */
  cardPayment?: boolean;
}

/**
 * After the client returns from Stripe Checkout (`?card=success&session_id=`):
 * asks the backend to book the payment. Null when the session is unknown.
 */
export async function confirmCardPayment(token: string, sessionId: string): Promise<'paid' | 'open' | 'expired' | null> {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/invoices/${encodeURIComponent(token)}/card-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { status: 'paid' | 'open' | 'expired' }).status;
  } catch {
    return null;
  }
}

/**
 * Fetches the client-portal view of an invoice by its `public_token`.
 * Returns `null` for a 404 (unmatched or malformed token — the backend
 * deliberately returns the same shape for both, see
 * `PublicInvoicesService.findByPublicToken`), so the page can render a
 * proper `notFound()` instead of an error boundary. Any other non-2xx
 * response is a genuine unexpected failure and is thrown.
 */
export async function getPublicInvoice(token: string): Promise<PublicInvoice | null> {
  const res = await fetch(`${BACKEND_URL}/api/v1/public/invoices/${encodeURIComponent(token)}`, {
    // Always fetch fresh — this is per-invoice, per-request data (status,
    // amounts) that must never be served stale from a cache, and there is
    // no tenant-aware cache key to scope it by anyway.
    cache: "no-store",
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`Failed to load public invoice (backend returned ${res.status})`);
  }

  return (await res.json()) as PublicInvoice;
}

/** Counts one client view of the shared link. Best effort: failures are swallowed. */
export async function recordPublicInvoiceView(token: string): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/v1/public/invoices/${encodeURIComponent(token)}/view`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    });
  } catch {
    // Analytics only — never break the invoice page over it.
  }
}
