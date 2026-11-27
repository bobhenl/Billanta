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

/** A file still stored readable, for "Zašifrovat stávající přílohy". */
export interface PlainAttachment {
  kind: 'invoice' | 'expense';
  id: string;
  /** The invoice or expense it belongs to. */
  parentId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

/** What the browser encrypted for "Zašifrovat": only the texts that were still plain. */
export interface PlainInvoice {
  id: string;
  invoiceNumber: string | null;
  noteAbove?: string;
  noteBelow?: string;
  internalNote?: string;
  items: { id: string; description: string }[];
}
