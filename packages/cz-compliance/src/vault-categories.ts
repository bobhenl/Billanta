/**
 * What a company can choose to encrypt in Confidential mode. Each category
 * switches off the server features that need to read it (the enable screen
 * lists them), so the choice is the customer's. `available: false` ones are
 * planned, not built. Kept outside vault/, which holds only the generic
 * crypto that gets published on its own.
 */
export const VAULT_CATEGORIES = [
  { id: 'texts', available: true, default: true },
  { id: 'attachments', available: true, default: false },
  { id: 'contacts', available: true, default: false },
  { id: 'amounts', available: true, default: false },
] as const;

export type VaultCategory = (typeof VAULT_CATEGORIES)[number]['id'];

export const AVAILABLE_VAULT_CATEGORIES = VAULT_CATEGORIES.filter((c) => c.available).map((c) => c.id);

/**
 * Contact columns sealed in the "contacts" category. IČO, DIČ and country
 * stay readable (registers, VAT checks, the payment QR); the e-mail is
 * sealed only when the user asks for it, because then the server can no
 * longer send anything to that contact.
 */
export const SEALED_CONTACT_FIELDS = [
  'legalName',
  'addressStreet',
  'addressCity',
  'addressPostalCode',
  'contactPerson',
  'phone',
  'internalNote',
] as const;

export type SealedContactField = (typeof SEALED_CONTACT_FIELDS)[number];

/** The same split for the buyer snapshot stored on each invoice. */
export const SEALED_BUYER_SNAPSHOT_FIELDS = ['legalName', 'addressStreet', 'addressCity', 'addressPostalCode'] as const;
