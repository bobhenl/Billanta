import { ConflictException } from "@nestjs/common";
import { isSealed, sealedMaxLength } from "@faktur/cz-compliance";
import { z } from "zod";

/*
 * Server side of "Důvěrný režim". The browser stores some free text as
 * `enc:v1:…` ciphertext the server cannot read (vault.service.ts). Whatever
 * the server renders for someone else (PDF, ISDOC, UBL, accounting exports,
 * the public link) must never carry that ciphertext as if it were text.
 */

export { isSealed };

/** 409 code: the document holds encrypted text, so the server can't render it. */
export const CONFIDENTIAL_CONTENT = "confidential_content";

/** Shown in accounting exports instead of an encrypted text (the amounts still export). */
export const SEALED_PLACEHOLDER = "[Důvěrný obsah]";

/** Throws `confidential_content` when any of the values is encrypted. */
export function assertServerReadable(...values: unknown[]): void {
  if (values.some((v) => isSealed(v))) throw new ConflictException(CONFIDENTIAL_CONTENT);
}

/** The printed texts of a document: notes above / below and every item description. */
export function printedTexts(invoice: { noteAbove: string | null; noteBelow: string | null }, items: { description: string }[]): (string | null)[] {
  return [invoice.noteAbove, invoice.noteBelow, ...items.map((i) => i.description)];
}

/** Null for ciphertext: search and suggestions must not match random base64. */
export function plainOrNull(value: string | null | undefined): string | null {
  return value == null || isSealed(value) ? null : value;
}

export function plainOr<T extends string | null | undefined>(value: T, placeholder: string): T | string {
  return isSealed(value) ? placeholder : value;
}

/** An invoice row with its encrypted texts replaced by the placeholder. */
export function redactSealedInvoice<T extends { noteAbove: string | null; noteBelow: string | null; internalNote: string | null }>(invoice: T): T {
  if (!isSealed(invoice.noteAbove) && !isSealed(invoice.noteBelow) && !isSealed(invoice.internalNote)) return invoice;
  return {
    ...invoice,
    noteAbove: plainOr(invoice.noteAbove, SEALED_PLACEHOLDER),
    noteBelow: plainOr(invoice.noteBelow, SEALED_PLACEHOLDER),
    internalNote: plainOr(invoice.internalNote, SEALED_PLACEHOLDER),
  };
}

export function redactSealedItem<T extends { description: string }>(item: T): T {
  return isSealed(item.description) ? { ...item, description: SEALED_PLACEHOLDER } : item;
}

/**
 * Text of at most `max` characters, or the envelope such a text seals to.
 * The length of the plain text is then checked in the browser.
 */
export function sealableText(max: number) {
  return z
    .string()
    .trim()
    .refine((v) => (isSealed(v) ? v.length <= sealedMaxLength(max) : v.length <= max), {
      message: `String must contain at most ${max} character(s)`,
    });
}
