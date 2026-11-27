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
      /** What sending an encrypted document does about its PDF (backend vault/vault-email.ts). Missing from an older backend. */
      emailMode?: VaultEmailMode;
      /** Let the outbox send queued PDFs without a click, once the browser renders them itself. */
      autoSendPdf?: boolean;
      categories: VaultCategory[];
      keyCheck: string;
      enabledAt: string;
      wraps: VaultWrapView[];
    };

/** `link_now`: the link goes now, the PDF follows; `wait`: the whole e-mail waits; `link_only`: never a PDF. */
export const VAULT_EMAIL_MODES = ['link_now', 'wait', 'link_only'] as const;
export type VaultEmailMode = (typeof VAULT_EMAIL_MODES)[number];

export type EnabledVault = Extract<VaultStatus, { enabled: true }>;

/** What the browser encrypted for "Zašifrovat": only the texts that were still plain. */
export interface PlainInvoice {
  id: string;
  invoiceNumber: string | null;
  noteAbove?: string;
  noteBelow?: string;
  internalNote?: string;
  items: { id: string; description: string }[];
}
