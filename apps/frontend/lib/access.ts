/** Access constants shared by server and client components (no server imports here). */
export const PERMISSION_AREAS = ['invoices', 'contacts', 'expenses', 'bank', 'reports'] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];
export type PermissionLevel = 'none' | 'read' | 'write';
export const APP_MODULES = ['expenses', 'bank', 'recurring', 'quotes', 'reports', 'ai', 'time'] as const;
export type AppModule = (typeof APP_MODULES)[number];

const LEVELS: readonly PermissionLevel[] = ['none', 'read', 'write'];
const ROLE_DEFAULT_LEVEL: Record<string, PermissionLevel> = { owner: 'write', admin: 'write', service: 'write', accountant: 'write', viewer: 'read' };

/** One row of "what you will get access to". */
export interface AreaAccess {
  area: PermissionArea;
  level: PermissionLevel;
}

/**
 * What a role plus its stored overrides (`tenant_invitations.permissions`)
 * gives, area by area, for the invitation page. Mirrors `accessSummary` /
 * `effectivePermissions` in apps/backend/src/tenancy/permissions.ts (a parity
 * test there keeps them in step): owners and admins always have everything,
 * and overrides that do not parse are ignored as a whole. Driven by
 * `PERMISSION_AREAS`, so finer areas only need adding there and a label.
 */
export function accessSummary(role: string, overrides?: unknown): { manage: boolean; areas: AreaAccess[] } {
  const base = ROLE_DEFAULT_LEVEL[role] ?? 'none';
  const fixed = role === 'owner' || role === 'admin' || role === 'service';
  const parsed = fixed ? null : parseOverrides(overrides);
  return {
    manage: role === 'owner' || role === 'admin',
    areas: PERMISSION_AREAS.map((area) => ({ area, level: parsed?.[area] ?? base }))
  };
}

function parseOverrides(value: unknown): Partial<Record<PermissionArea, PermissionLevel>> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Partial<Record<PermissionArea, PermissionLevel>> = {};
  for (const [key, level] of Object.entries(value)) {
    if (!(PERMISSION_AREAS as readonly string[]).includes(key)) return null;
    if (level === undefined) continue;
    if (!LEVELS.includes(level as PermissionLevel)) return null;
    out[key as PermissionArea] = level as PermissionLevel;
  }
  return out;
}

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
