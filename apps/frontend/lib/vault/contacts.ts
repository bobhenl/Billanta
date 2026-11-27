import { isSealed, open, seal, SEALED_BUYER_SNAPSHOT_FIELDS, SEALED_CONTACT_FIELDS, type VaultKey } from '@faktur/cz-compliance';
import type { EnabledVault } from './types';

/*
 * Browser side of the "contacts" category: name, address, contact person,
 * phone and internal note are encrypted here before they leave the tab.
 * IČO, DIČ and country stay readable (registers, VAT check, payment QR).
 * The e-mail is encrypted only on request, because then the server can no
 * longer send anything to that contact.
 */

type Fields = Partial<Record<(typeof SEALED_CONTACT_FIELDS)[number] | 'email', string | null | undefined>>;

/** The category is on: names are shown, searched and matched here, and the server never gets a typed name. */
export const contactsConfidential = (vault: EnabledVault | null) => Boolean(vault?.categories.includes('contacts'));

/** New and edited contacts get encrypted: the category is on and the plan still allows it. */
export const sealsContacts = (vault: EnabledVault | null) => contactsConfidential(vault) && vault?.planAllowed !== false;

export const contactIsSealed = (contact: Fields | null | undefined) => isSealed(contact?.legalName);

const sealOne = async (key: VaultKey, value: string | null | undefined) => (value && value.trim() && !isSealed(value) ? seal(key, value) : value);
const openOne = async (key: VaultKey, value: string | null | undefined) => (value && isSealed(value) ? open(key, value) : value);

/** Every sealable field that holds text, encrypted; the e-mail only with `email: true`. */
export async function sealContact<T extends Fields>(key: VaultKey, contact: T, opts: { email: boolean }): Promise<T> {
  const out: Fields = { ...contact };
  for (const k of SEALED_CONTACT_FIELDS) out[k] = await sealOne(key, contact[k]);
  if (opts.email) out.email = await sealOne(key, contact.email);
  return out as T;
}

/** The same contact with every envelope opened; plain values pass through. */
export async function openContact<T extends Fields>(key: VaultKey, contact: T): Promise<T> {
  const out: Fields = { ...contact };
  for (const k of [...SEALED_CONTACT_FIELDS, 'email'] as const) out[k] = await openOne(key, contact[k]);
  return out as T;
}

/** Opens a list; a row this key can't open stays as stored (shown locked). */
export async function openContacts<T extends Fields>(key: VaultKey, rows: T[]): Promise<T[]> {
  return Promise.all(rows.map((row) => openContact(key, row).catch(() => row)));
}

/** What "Zašifrovat stávající kontakty" gets from the server: the plain values only. */
export interface PlainContactBatch {
  remaining: number;
  contacts: ({ id: string } & Fields)[];
  invoices: { id: string; invoiceNumber: string | null; buyer: Partial<Record<(typeof SEALED_BUYER_SNAPSHOT_FIELDS)[number], string>>; buyerContactPerson?: string }[];
}

/** The batch with each plain value replaced by its envelope, ready for `POST /vault/contacts/seal`. */
export async function sealContactBatch(key: VaultKey, batch: PlainContactBatch) {
  const only = async <K extends string>(keys: readonly K[], values: Partial<Record<K, string | null | undefined>>) => {
    const out: Partial<Record<K, string>> = {};
    for (const k of keys) {
      const v = values[k];
      if (v && !isSealed(v)) out[k] = await seal(key, v);
    }
    return out;
  };
  return {
    contacts: await Promise.all(batch.contacts.map(async (c) => ({ id: c.id, ...(await only(SEALED_CONTACT_FIELDS, c)) }))),
    invoices: await Promise.all(
      batch.invoices.map(async (i) => ({
        id: i.id,
        buyer: await only(SEALED_BUYER_SNAPSHOT_FIELDS, i.buyer),
        ...(i.buyerContactPerson ? { buyerContactPerson: await seal(key, i.buyerContactPerson) } : {})
      }))
    )
  };
}

/**
 * The invoice's own copies of the buyer, encrypted before the save leaves
 * the tab: the contact person, and a register pick that becomes a new
 * contact on save (name and address; IČO, DIČ and country stay readable).
 */
export async function sealBuyer<T extends { buyerContactPerson: string; customer?: { kind: string; ares?: Fields } | null }>(key: VaultKey, input: T): Promise<T> {
  const customer =
    input.customer?.kind === 'ares' && input.customer.ares
      ? { ...input.customer, ares: { ...input.customer.ares, ...(await sealContact(key, pick(input.customer.ares), { email: false })) } }
      : input.customer;
  return { ...input, buyerContactPerson: (await sealOne(key, input.buyerContactPerson)) ?? '', customer };
}

const pick = (a: Fields): Fields => ({ legalName: a.legalName, addressStreet: a.addressStreet, addressCity: a.addressCity, addressPostalCode: a.addressPostalCode });

/** Local typeahead over opened contacts: name, IČO, DIČ, city or e-mail, accent-insensitive. */
export function matchContacts<T extends Fields & { ico?: string | null; dic?: string | null; isStarred?: boolean }>(rows: T[], query: string, limit = 8): T[] {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const q = fold(query.trim());
  if (q.length < 2) return [];
  return rows
    .filter((r) => [r.legalName, r.ico, r.dic, r.addressCity, r.email].some((v) => v && !isSealed(v) && fold(v).includes(q)))
    .sort((a, b) => Number(Boolean(b.isStarred)) - Number(Boolean(a.isStarred)))
    .slice(0, limit);
}
