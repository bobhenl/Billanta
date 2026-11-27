import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { AVAILABLE_VAULT_CATEGORIES, type VaultCategory } from "@faktur/cz-compliance";
import { isSealed, sealedEnvelope } from "../sealed";
import { VAULT_EMAIL_MODES } from "../vault-email";

const b64 = (max: number) => z.string().max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64");
const sealed = z.string().max(20_000).refine(isSealed, "sealed");
const availableCategory = z.enum(AVAILABLE_VAULT_CATEGORIES as [VaultCategory, ...VaultCategory[]]);

/** A wrapped data key as the browser built it (`VaultWrap` in @faktur/cz-compliance). */
const passwordWrap = z.object({
  kind: z.literal("password"),
  kdf: z.literal("pbkdf2-sha256"),
  // Below this a stolen backup would make guessing cheap; the browser uses 600 000.
  iterations: z.number().int().min(100_000).max(10_000_000),
  salt: b64(64),
  iv: b64(32),
  wrappedKey: b64(128),
});

const recoveryWrap = z.object({
  kind: z.literal("recovery"),
  kdf: z.literal("hkdf-sha256"),
  iterations: z.null().optional(),
  salt: b64(64),
  iv: b64(32),
  wrappedKey: b64(128),
});

const b64url = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/, "base64url");

const passkeyWrap = recoveryWrap.extend({
  kind: z.literal("passkey"),
  credentialId: b64url(1024).refine((s) => s.length >= 16, "base64url"),
  label: z.string().trim().max(60).nullish(),
  /** With these two the passkey can also confirm a step-up (src/vault/passkey-step-up.ts). */
  publicKey: b64url(2048).optional(),
  publicKeyAlg: z.union([z.literal(-7), z.literal(-257)]).optional(),
});

export const enableVaultSchema = z.object({
  keyCheck: sealed,
  password: passwordWrap,
  recovery: recoveryWrap,
  /** Only the categories that are built; planned ones are shown, not selectable. */
  categories: z.array(availableCategory).min(1).default(["texts"]),
  /** The owner ticked every warning (lost password + code = unreadable data, 10-year archive duty). */
  acknowledged: z.literal(true),
});
export class EnableVaultDto extends createZodDto(enableVaultSchema) {}

// Wrapped in an object: a DTO class cannot extend a bare union.
export const memberWrapSchema = z.object({ wrap: z.discriminatedUnion("kind", [passwordWrap, passkeyWrap]) });
export class MemberWrapDto extends createZodDto(memberWrapSchema) {}

/** A WebAuthn assertion over a challenge from `POST me/passkey/challenge`. */
export const passkeyStepUpSchema = z.object({
  credentialId: b64url(1024),
  clientDataJSON: b64url(4096),
  authenticatorData: b64url(4096),
  signature: b64url(1024),
});
export class PasskeyStepUpDto extends createZodDto(passkeyStepUpSchema) {}

export const recoveryWrapSchema = z.object({ recovery: recoveryWrap });
export class RecoveryWrapDto extends createZodDto(recoveryWrapSchema) {}

// Each field is optional so one switch on the settings page saves alone.
// `categories` lets a company add a category built after it switched the mode on.
export const vaultSettingsSchema = z
  .object({
    sealNew: z.boolean().optional(),
    emailMode: z.enum(VAULT_EMAIL_MODES).optional(),
    autoSendPdf: z.boolean().optional(),
    categories: z.array(availableCategory).min(1).optional(),
  })
  .refine((v) => v.sealNew !== undefined || v.emailMode !== undefined || v.autoSendPdf !== undefined || v.categories !== undefined, {
    message: "nothing_to_update",
  });
export class VaultSettingsDto extends createZodDto(vaultSettingsSchema) {}

export const plainInvoicesQuerySchema = z.object({
  invoice_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export class PlainInvoicesQueryDto extends createZodDto(plainInvoicesQuerySchema) {}

export const plainAttachmentsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) });
export class PlainAttachmentsQueryDto extends createZodDto(plainAttachmentsQuerySchema) {}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Pages of documents for the browser's own search, suggestions and readable export. */
export const vaultDocumentsQuerySchema = z.object({
  /** Id of the last document of the previous page. */
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /** Only documents holding ciphertext (search and suggestions); "false" for the export. */
  sealed_only: z.enum(["true", "false"]).default("true"),
  /** Issue date range, both inclusive. */
  from: isoDay.optional(),
  to: isoDay.optional(),
});
export class VaultDocumentsQueryDto extends createZodDto(vaultDocumentsQuerySchema) {}

/**
 * "Zašifrovat": the browser sends back the texts it encrypted. Every value
 * must be an envelope; the server cannot check it holds the same text, so
 * only the text columns change, never amounts, dates or numbers.
 */
export const sealInvoicesSchema = z.object({
  invoices: z
    .array(
      z.object({
        id: z.string().uuid(),
        noteAbove: sealed.optional(),
        noteBelow: sealed.optional(),
        internalNote: sealed.optional(),
        items: z.array(z.object({ id: z.string().uuid(), description: sealed })).max(200).default([]),
      }),
    )
    .min(1)
    .max(50),
});
export class SealInvoicesDto extends createZodDto(sealInvoicesSchema) {}

/**
 * "Připravit odkaz pro klienta": the browser re-encrypts the printed texts of
 * one document under a key of that document, so the client link can carry
 * that key. Ciphertext replaces ciphertext; the server never sees either key.
 */
export const rekeyInvoiceSchema = z.object({
  noteAbove: sealed.optional(),
  noteBelow: sealed.optional(),
  items: z.array(z.object({ id: z.string().uuid(), description: sealed })).max(500).default([]),
  /** The buyer as printed (the document's snapshot), so the client's browser can draw it in the PDF. */
  buyer: z
    .object({ legalName: sealed.optional(), addressStreet: sealed.optional(), addressCity: sealed.optional(), addressPostalCode: sealed.optional() })
    .strict()
    .optional(),
  buyerContactPerson: sealed.optional(),
  /** Category "amounts": the totals and each item's amounts under the same document key. */
  encAmounts: sealed.optional(),
  itemAmounts: z.array(z.object({ id: z.string().uuid(), encAmounts: sealed })).max(500).default([]),
});
export class RekeyInvoiceDto extends createZodDto(rekeyInvoiceSchema) {}

export const plainContactsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
export class PlainContactsQueryDto extends createZodDto(plainContactsQuerySchema) {}

/**
 * "Zašifrovat stávající kontakty": envelopes for the sealable columns of
 * contacts, and for the buyer snapshot of their documents. Every value must
 * be an envelope; only those columns change.
 */
export const sealContactsSchema = z.object({
  contacts: z
    .array(
      z.object({
        id: z.string().uuid(),
        legalName: sealed,
        addressStreet: sealed.optional(),
        addressCity: sealed.optional(),
        addressPostalCode: sealed.optional(),
        contactPerson: sealed.optional(),
        phone: sealed.optional(),
        internalNote: sealed.optional(),
      }),
    )
    .max(50)
    .default([]),
  invoices: z
    .array(
      z.object({
        id: z.string().uuid(),
        buyer: z
          .object({ legalName: sealed.optional(), addressStreet: sealed.optional(), addressCity: sealed.optional(), addressPostalCode: sealed.optional() })
          .default({}),
        buyerContactPerson: sealed.optional(),
      }),
    )
    .max(50)
    .default([]),
});
export class SealContactsDto extends createZodDto(sealContactsSchema) {}

export const plainAmountsQuerySchema = z.object({
  invoice_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export class PlainAmountsQueryDto extends createZodDto(plainAmountsQuerySchema) {}

/**
 * "Zašifrovat stávající částky": per document the totals envelope and one
 * envelope per item. Every item of the document must come back, or nothing
 * of it changes.
 */
export const sealAmountsSchema = z.object({
  invoices: z
    .array(
      z.object({
        id: z.string().uuid(),
        encAmounts: sealedEnvelope(4000),
        items: z.array(z.object({ id: z.string().uuid(), encAmounts: sealedEnvelope(400) })).max(200),
        // The plain paid sum, fees and home-currency proceeds, sealed as one payment (vault-payments.ts).
        encPaid: sealedEnvelope(4000).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export class SealAmountsDto extends createZodDto(sealAmountsSchema) {}
