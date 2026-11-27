/**
 * What a company can choose to encrypt in Confidential mode. Each category
 * switches off the server features that need to read it (the enable screen
 * lists them), so the choice is the customer's. `available: false` ones are
 * planned, not built. Kept outside vault/, which holds only the generic
 * crypto that gets published on its own.
 */
export const VAULT_CATEGORIES = [
  { id: 'texts', available: true, default: true },
  { id: 'attachments', available: false, default: false },
  { id: 'contacts', available: false, default: false },
  { id: 'amounts', available: false, default: false },
] as const;

export type VaultCategory = (typeof VAULT_CATEGORIES)[number]['id'];

export const AVAILABLE_VAULT_CATEGORIES = VAULT_CATEGORIES.filter((c) => c.available).map((c) => c.id);
