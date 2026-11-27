import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "./tenant-context.middleware";

/**
 * A refusal from the database, as a 403 the frontend can word: the 0111
 * trigger (someone got past the API check) or member_visibility rejecting
 * the new row, i.e. the change would hide the record from the person making
 * it (a member giving a private client away). Anything else is rethrown.
 */
export function visibilityError(error: unknown): unknown {
  const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e.code ?? e.cause?.code;
  if (code !== "42501") return error;
  const message = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  return new ForbiddenException(message.includes("visibility_owner_only") ? "visibility_owner_only" : "visibility_would_hide");
}

type Actor = Pick<AuthenticatedUser, "id" | "role" | "apiKey">;

/**
 * Who a client belongs to and whether it is private is decided by the
 * company owner or by the client's current owner, nobody else. An admin
 * manages the team but must not be able to open a client the owner kept
 * from them. The trigger in migrations/0111 holds the same line in SQL.
 */
export function mayChangeContactVisibility(user: Actor, contact: { ownerUserId: string | null }): boolean {
  if (user.apiKey) return false;
  if (user.role === "owner") return true;
  return contact.ownerUserId !== null && contact.ownerUserId === user.id;
}

/** A private invoice is the company owner's or its creator's to mark and unmark. */
export function mayChangeInvoicePrivacy(user: Actor, invoice: { createdByUserId: string | null }): boolean {
  if (user.apiKey) return false;
  if (user.role === "owner") return true;
  return invoice.createdByUserId !== null && invoice.createdByUserId === user.id;
}
