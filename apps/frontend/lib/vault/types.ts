import type { VaultCategory, VaultWrap } from '@faktur/cz-compliance';

/** A wrapped company key as `GET /api/v1/vault/me` returns it. */
export interface VaultWrapView extends VaultWrap {
  id: string;
  credentialId: string | null;
  label: string | null;
  createdAt: string;
}

export type VaultStatus =
  | { enabled: false; planAllowed?: boolean }
  | {
      enabled: true;
      /** False below Plus: the vault still unlocks, but nothing new gets encrypted. Missing from an older backend. */
      planAllowed?: boolean;
      sealNew: boolean;
      categories: VaultCategory[];
      keyCheck: string;
      enabledAt: string;
      wraps: VaultWrapView[];
    };

export type EnabledVault = Extract<VaultStatus, { enabled: true }>;

/** What the browser encrypted for "Zašifrovat": only the texts that were still plain. */
export interface PlainInvoice {
  id: string;
  invoiceNumber: string | null;
  noteAbove?: string;
  noteBelow?: string;
  internalNote?: string;
  items: { id: string; description: string }[];
  /** The document key its sealed texts already use (from the server); missing on an older backend. */
  documentKeyWrap?: string | null;
}

/** `GET /api/v1/vault/invoices/documents`: one document with its texts exactly as stored, envelopes unopened. */
export interface VaultDocument {
  id: string;
  documentType: string;
  invoiceNumber: string | null;
  status: string;
  issueDate: string | null;
  taxableSupplyDate: string | null;
  dueDate: string | null;
  paidAt: string | null;
  currency: string;
  variableSymbol: string | null;
  contactName: string | null;
  contactIco: string | null;
  noteAbove: string | null;
  noteBelow: string | null;
  internalNote: string | null;
  totalWithoutVat: number;
  totalVat: number;
  total: number;
  createdAt: string;
  items: {
    description: string;
    code: string | null;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    vatRate: number | null;
    discountPercent: number;
    createdAt: string;
  }[];
}

export interface VaultDocumentPage {
  documents: VaultDocument[];
  /** Locked documents the member has not re-authenticated for; left out of the page. */
  skippedLocked: number;
  next: string | null;
}
