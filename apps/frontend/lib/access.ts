/** Access constants shared by server and client components (no server imports here). */
export const PERMISSION_AREAS = ['invoices', 'contacts', 'expenses', 'bank', 'reports'] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];
export type PermissionLevel = 'none' | 'read' | 'write';
export const APP_MODULES = ['expenses', 'bank', 'recurring', 'quotes', 'reports', 'ai', 'time'] as const;
export type AppModule = (typeof APP_MODULES)[number];

/** What `canWrite` needs from `GET /api/v1/tenants/me/access` (`MyAccess` in lib/tenant.ts). */
export interface WriteAccess {
  role: string;
  permissions: Partial<Record<PermissionArea, PermissionLevel>>;
}

/**
 * Whether the member may create, change or delete things in `area`, or with
 * `null` in the rest of the app outside the areas (AI drafts, products,
 * reminders…; the owner-only settings are `canManage`'s job). Mirrors
 * `roleMayAccess` in apps/backend/src/tenancy/role-access.guard.ts so the UI
 * hides exactly the buttons the backend would refuse; a parity test there
 * keeps the two in step. Unknown access (an older backend, a failed fetch)
 * allows everything: the backend still decides, and hiding the owner's
 * buttons over a glitch would be worse.
 */
export function canWrite(access: WriteAccess | null | undefined, area: PermissionArea | null): boolean {
  if (!access) return true;
  const { role } = access;
  if (role === 'owner' || role === 'admin' || role === 'service') return true;
  if (area === null) return role === 'accountant';
  return access.permissions[area] === 'write';
}
