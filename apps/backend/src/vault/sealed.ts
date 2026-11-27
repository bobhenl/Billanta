import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { documentKeyWrap, isSealed, sealedMaxLength } from "@faktur/cz-compliance";
import { z } from "zod";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../../drizzle/schema";
import { loadPlanSummary } from "../billing/plan.guard";
import { planAllows, type PlanSummary } from "../billing/plan-access";
import { FEATURE_MIN_PLAN } from "../billing/plans";

/*
 * Server side of "Důvěrný režim". The browser stores some free text as
 * `enc:v1:…` ciphertext the server cannot read (vault.service.ts). Whatever
 * the server renders for someone else (PDF, ISDOC, UBL, accounting exports,
 * the public link) must never carry that ciphertext as if it were text.
 */

export { isSealed };

/**
 * Which of a re-key's fields may be written: only ciphertext over
 * ciphertext (plain text becomes sealed through "Zašifrovat", with its plan
 * check), and every new envelope under one and the same document key, or
 * the client link could open only part of the document. Throws on anything
 * else, so a half-applied re-key can't happen.
 */
export function rekeyWrites(pairs: { incoming: string; stored: string | null | undefined }[]): void {
  const wraps = new Set(pairs.map((p) => documentKeyWrap(p.incoming)));
  if (wraps.has(null) || wraps.size > 1) throw new BadRequestException("rekey_one_document_key");
  if (pairs.some((p) => !isSealed(p.stored))) throw new ConflictException("rekey_plain_text");
}

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

/**
 * Whether a save may store the incoming ciphertext. Sealing is a Plus
 * feature, but a document that already holds encrypted text stays editable
 * (and so re-sealed by the browser) after a downgrade: only turning plain
 * text into ciphertext needs the plan.
 */
export function sealingAllowed(plan: Pick<PlanSummary, "plan" | "enforced"> | null, incoming: unknown[], stored: unknown[]): boolean {
  if (!incoming.some((v) => isSealed(v))) return true;
  if (!plan || planAllows(plan, "confidential_mode")) return true;
  return stored.some((v) => isSealed(v));
}

export function confidentialPlanRequired(): ForbiddenException {
  return new ForbiddenException({ error: "plan_required", message: "This needs a higher plan", feature: "confidential_mode", plan: FEATURE_MIN_PLAN.confidential_mode });
}

/**
 * Refuses a save that would bring new ciphertext into a plain document on a
 * plan without confidential mode. `stored` is only read when it matters.
 */
export async function assertSealingAllowed(db: PostgresJsDatabase<typeof schema>, tenantId: string, incoming: unknown[], stored: () => Promise<unknown[]> | unknown[] = () => []): Promise<void> {
  if (!incoming.some((v) => isSealed(v))) return;
  const plan = await loadPlanSummary(db, tenantId);
  if (!plan || planAllows(plan, "confidential_mode")) return;
  if (!sealingAllowed(plan, incoming, await stored())) throw confidentialPlanRequired();
}
