import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { SEALED_BUYER_SNAPSHOT_FIELDS, isSealed, type SealedContactField } from "@faktur/cz-compliance";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { SEALED_PLACEHOLDER, assertSealingAllowed } from "./sealed";

/*
 * Server side of the "contacts" category. A sealed contact has its name,
 * address, contact person, phone and note as `enc:v1:` envelopes the server
 * cannot open; IČO, DIČ and country stay readable, and the e-mail too unless
 * the user sealed it as well (then nothing is ever e-mailed to it from here).
 * The name decides: a sealed name means a sealed contact, and then every
 * other sealable field must be sealed too, so a contact is never half-open.
 */

// Spelled out (not spread from SEALED_CONTACT_FIELDS at load time) so specs that mock the package still load this.
export const CONTACT_SEALABLE = [
  "legalName",
  "addressStreet",
  "addressCity",
  "addressPostalCode",
  "contactPerson",
  "phone",
  "internalNote",
  "email",
] as const satisfies readonly (SealedContactField | "email")[];
type SealableKey = (typeof CONTACT_SEALABLE)[number];
type ContactTexts = Partial<Record<SealableKey, string | null | undefined>>;

/** The contact is sealed: its name is an envelope. */
export function contactIsSealed(contact: { legalName?: string | null } | null | undefined): boolean {
  return isSealed(contact?.legalName);
}

/** A sealed contact's e-mail is an envelope: the server must not send to it. */
export function emailIsSealed(contact: { email?: string | null } | null | undefined): boolean {
  return isSealed(contact?.email);
}

/**
 * Plain text in a sealed contact, or an envelope in a plain one. Both mean the
 * browser and the server disagree about the contact, so the write is refused.
 */
export function assertContactShape(contact: ContactTexts): void {
  const filled = CONTACT_SEALABLE.filter((k) => contact[k] != null && contact[k] !== "");
  if (isSealed(contact.legalName)) {
    if (filled.some((k) => k !== "email" && !isSealed(contact[k]))) throw new BadRequestException("contact_plaintext");
  } else if (filled.some((k) => isSealed(contact[k]))) {
    throw new BadRequestException("contact_partly_sealed");
  }
}

/**
 * Whether a contact write may be stored. `incoming` holds only the fields
 * being written, `stored` the row as it is now (null for a new contact).
 * Plain text over a sealed contact is refused (it would undo the encryption
 * behind the user's back); a contact becomes sealed only with the plan and
 * the "contacts" category on. Editing an already sealed contact stays
 * possible after a downgrade or with the category off again.
 */
export async function assertContactWrite(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  incoming: ContactTexts,
  stored: ContactTexts | null,
): Promise<void> {
  const merged: ContactTexts = { ...(stored ?? {}) };
  for (const k of CONTACT_SEALABLE) if (incoming[k] !== undefined) merged[k] = incoming[k];
  if (contactIsSealed(stored) && !contactIsSealed(merged)) throw new ConflictException("contact_sealed");
  assertContactShape(merged);
  const values = CONTACT_SEALABLE.map((k) => incoming[k]);
  if (!values.some((v) => isSealed(v)) || contactIsSealed(stored)) return;
  await assertSealingAllowed(db, tenantId, values);
  await assertContactsCategory(db, tenantId);
}

/** 403 vault_category_off unless the company encrypts contacts. */
export async function assertContactsCategory(db: PostgresJsDatabase<typeof schema>, tenantId: string): Promise<void> {
  const [vault] = await db
    .select({ categories: schema.tenantVaults.categories })
    .from(schema.tenantVaults)
    .where(eq(schema.tenantVaults.tenantId, tenantId))
    .limit(1);
  if (!vault?.categories.includes("contacts")) throw new ForbiddenException("vault_category_off");
}

/** The buyer's printed texts (snapshot laid over the contact), for `assertServerReadable`. */
export function buyerTexts(
  buyer: { legalName?: string | null; addressStreet?: string | null; addressCity?: string | null; addressPostalCode?: string | null } | null | undefined,
  buyerContactPerson?: string | null,
): (string | null | undefined)[] {
  if (!buyer) return [buyerContactPerson];
  return [...SEALED_BUYER_SNAPSHOT_FIELDS.map((k) => buyer[k]), buyerContactPerson];
}

/** A name for logs, audit rows, exports and e-mails: the placeholder for a sealed one. */
export function contactLabel(name: string | null | undefined): string {
  return isSealed(name) ? SEALED_PLACEHOLDER : (name ?? "");
}

/** A name where a missing value is better than a placeholder (e-mail greetings, URL slugs). */
export function plainName(name: string | null | undefined): string | null {
  return name && !isSealed(name) ? name : null;
}

/** A contact as the server can export it: the placeholder instead of each envelope. */
export function redactSealedContact<T extends ContactTexts>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of CONTACT_SEALABLE) if (isSealed(out[k])) out[k] = SEALED_PLACEHOLDER;
  return out as T;
}
