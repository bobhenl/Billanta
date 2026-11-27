/** Who still sees a locked invoice, expense or client (migration 0122). */
export const ACCESS_LOCK_LEVELS = ['private', 'admin', 'accountant'] as const;
export type AccessLock = (typeof ACCESS_LOCK_LEVELS)[number];

/** A member's reach in one area (tenant_memberships.*_scope). */
export const RECORD_SCOPES = ['all', 'edit_own', 'own'] as const;
export type RecordScope = (typeof RECORD_SCOPES)[number];
export const SCOPE_AREAS = ['contacts', 'invoices', 'expenses'] as const;
export type ScopeArea = (typeof SCOPE_AREAS)[number];
export type MemberScopes = Record<ScopeArea, RecordScope>;

export interface Lockable {
  /** The record's person: whoever created it, or for a client the member it belongs to. */
  person: string | null;
  accessLock: AccessLock | null;
  accessLockUserId: string | null;
}

/**
 * Same rule as the API (mayChangeLock), only to decide whether to show the
 * control: an existing lock is its holder's or the company owner's, an open
 * record may be locked by its person or a manager.
 */
export function mayChangeLock(role: string | null | undefined, me: string | null | undefined, record: Lockable): boolean {
  if (role === 'owner') return true;
  if (!me) return false;
  if (record.accessLock) return record.accessLockUserId === me;
  return record.person === me || role === 'admin';
}
