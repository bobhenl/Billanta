/** Shapes and fetcher for the public per-customer portal (`/api/v1/public/portal/:token`). */

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface ClientPortalDocument {
  token: string;
  number: string | null;
  documentType: 'invoice' | 'proforma' | 'credit_note' | 'quote';
  status: 'issued' | 'paid' | 'cancelled';
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  total: number;
  amountPaid: number;
  balance: number;
  overdue: boolean;
  clientResponse: 'accepted' | 'rejected' | null;
}

export interface ClientPortal {
  customerName: string;
  companyName: string;
  documents: ClientPortalDocument[];
  outstanding: { currency: string; amount: number; overdue: number }[];
}

/** null for an unknown, revoked or malformed token. */
export async function getClientPortal(token: string): Promise<ClientPortal | null> {
  const res = await fetch(`${BACKEND_URL}/api/v1/public/portal/${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load client portal (backend returned ${res.status})`);
  return (await res.json()) as ClientPortal;
}
