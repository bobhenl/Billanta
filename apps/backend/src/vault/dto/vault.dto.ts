import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { AVAILABLE_VAULT_CATEGORIES, type VaultCategory } from "@faktur/cz-compliance";
import { isSealed } from "../sealed";

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

const passkeyWrap = recoveryWrap.extend({
  kind: z.literal("passkey"),
  credentialId: z.string().min(16).max(1024).regex(/^[A-Za-z0-9_-]+$/, "base64url"),
  label: z.string().trim().max(60).nullish(),
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

export const recoveryWrapSchema = z.object({ recovery: recoveryWrap });
export class RecoveryWrapDto extends createZodDto(recoveryWrapSchema) {}

/** `categories` lets a company add a category built after it switched the mode on. */
export const vaultSettingsSchema = z
  .object({ sealNew: z.boolean().optional(), categories: z.array(availableCategory).min(1).optional() })
  .refine((v) => v.sealNew !== undefined || v.categories !== undefined, "empty");
export class VaultSettingsDto extends createZodDto(vaultSettingsSchema) {}

export const plainInvoicesQuerySchema = z.object({
  invoice_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export class PlainInvoicesQueryDto extends createZodDto(plainInvoicesQuerySchema) {}

export const plainAttachmentsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(20).default(10) });
export class PlainAttachmentsQueryDto extends createZodDto(plainAttachmentsQuerySchema) {}

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
