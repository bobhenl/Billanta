import { ForbiddenException } from "@nestjs/common";
import type { AccessLockLevel } from "../../drizzle/schema";
import type { AuthenticatedUser } from "./tenant-context.middleware";

export const ACCESS_LOCK_LEVELS = ["private", "admin", "accountant"] as const satisfies readonly AccessLockLevel[];

/**
 * A refusal from the database, as a 403 the frontend can word:
 * - the 0122 trigger (someone got past the API check): visibility_owner_only;
 * - member_edit_scope (an 'edit_own' member writing someone else's record):
 *   record_read_only;
 * - member_visibility rejecting the new row, i.e. the change would hide the
 *   record from the person making it: visibility_would_hide.
 * Anything else is rethrown as it is.
 */
export function visibilityError(error: unknown): unknown {
  return rlsRefusal(error) ?? error;
}

/** The 403 for a row-level refusal, or null when the error is something else. */
export function rlsRefusal(error: unknown): ForbiddenException | null {
  const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.code ?? e?.cause?.code;
  if (code !== "42501") return null;
  const message = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  if (message.includes("visibility_owner_only")) return new ForbiddenException("visibility_owner_only");
  if (message.includes("member_edit_scope")) return new ForbiddenException("record_read_only");
  if (message.includes("row-level security")) return new ForbiddenException("visibility_would_hide");
  return null;
}

type Actor = Pick<AuthenticatedUser, "id" | "role" | "apiKey">;

/** A record as the lock rules see it: whose it is and how it is locked. */
export type Lockable = {
  /** The record's person: a client's assignee, a document's creator. */
  person: string | null;
  accessLock: AccessLockLevel | null;
  accessLockUserId: string | null;
};

/**
 * Who a client belongs to is decided by the company owner or by the
 * client's current owner, nobody else. An admin manages the team but must
 * not be able to open a client the owner kept from them. A locked client is
 * handed over only by the company owner, who moves the lock along with it.
 * The trigger in migrations/0122 holds the same line in SQL.
 */
export function mayChangeContactOwner(user: Actor, contact: { ownerUserId: string | null; accessLock: AccessLockLevel | null }): boolean {
  if (user.apiKey) return false;
  if (user.role === "owner") return true;
  return contact.accessLock === null && contact.ownerUserId !== null && contact.ownerUserId === user.id;
}

/**
 * Locks and unlocks. An existing lock is its holder's (or the company
 * owner's) to change, so an admin can't lift what someone locked away from
 * them. A record without a lock may be locked by its person or a manager.
 * API keys never touch locks: a key acts for the whole company.
 */
export function mayChangeLock(user: Actor, record: Lockable): boolean {
  if (user.apiKey) return false;
  if (user.role === "owner") return true;
  if (record.accessLock !== null) return record.accessLockUserId === user.id;
  return (record.person !== null && record.person === user.id) || user.role === "admin";
}

// How many people a level lets in, from the fewest.
const OPENNESS: Record<AccessLockLevel | "none", number> = { private: 0, admin: 1, accountant: 2, none: 3 };

/**
 * Whether a lock change lets more people see the record, which needs a
 * step-up (src/auth/step-up.ts). Locking or tightening only hides it.
 */
export function lockWidens(before: AccessLockLevel | null, next: AccessLockLevel | null): boolean {
  return OPENNESS[next ?? "none"] > OPENNESS[before ?? "none"];
}

/**
 * Whether a client's new owner lets more people see it. A new owner other
 * than the person making the change gains the client; the actor already
 * sees it (company owner, or its current owner).
 */
export function contactOwnerWidens(before: { ownerUserId: string | null }, nextOwner: string | null | undefined, actorId: string): boolean {
  return Boolean(nextOwner) && nextOwner !== before.ownerUserId && nextOwner !== actorId;
}
