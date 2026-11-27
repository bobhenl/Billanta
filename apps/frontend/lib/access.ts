/** Access constants shared by server and client components (no server imports here). */
export const PERMISSION_AREAS = ['invoices', 'contacts', 'expenses', 'bank', 'reports', 'projects', 'recurring', 'settings'] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];
export type PermissionLevel = 'none' | 'read' | 'write';
export const APP_MODULES = ['expenses', 'bank', 'recurring', 'quotes', 'reports', 'ai', 'time'] as const;
export type AppModule = (typeof APP_MODULES)[number];

/**
 * Finer actions inside an area and the area level each also needs. Same
 * list as `PERMISSION_ACTIONS` in apps/backend/src/tenancy/permissions.ts.
 */
export const PERMISSION_ACTIONS = {
  'invoices.create': 'write',
  'invoices.issue': 'write',
  'invoices.send': 'write',
  'invoices.cancel': 'write',
  'expenses.create': 'write',
  'expenses.approve': 'write',
  'expenses.delete': 'write',
  'bank.match': 'write',
  'bank.connections': 'write',
  'reports.export': 'read',
  'settings.company': 'write',
  'settings.numbering': 'write',
  'settings.templates': 'write',
  'settings.paymentMethods': 'write',
  'settings.integrations': 'write',
  'settings.apiKeys': 'write'
} as const satisfies Record<string, Exclude<PermissionLevel, 'none'>>;
export type PermissionAction = keyof typeof PERMISSION_ACTIONS;
export const ACTION_KEYS = Object.keys(PERMISSION_ACTIONS) as PermissionAction[];
export const areaOfAction = (action: PermissionAction) => action.slice(0, action.indexOf('.')) as PermissionArea;

const LEVELS: readonly PermissionLevel[] = ['none', 'read', 'write'];
const ROLE_DEFAULT_LEVEL: Record<string, PermissionLevel> = { owner: 'write', admin: 'write', service: 'write', accountant: 'write', viewer: 'read' };
/** Areas that used to be part of invoices: without their own stored level they follow it. */
const FOLLOWS_INVOICES: readonly PermissionArea[] = ['projects', 'recurring'];

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
  // Company settings stay with owners and admins unless a section is granted.
  const roleLevel = (area: PermissionArea): PermissionLevel => (area === 'settings' && role === 'accountant' ? 'read' : base);
  const levels = Object.fromEntries(PERMISSION_AREAS.map((area) => [area, parsed?.[area] ?? roleLevel(area)])) as Record<PermissionArea, PermissionLevel>;
  if (parsed) for (const area of FOLLOWS_INVOICES) if (!parsed[area]) levels[area] = levels.invoices;
  return {
    manage: role === 'owner' || role === 'admin',
    areas: PERMISSION_AREAS.map((area) => ({ area, level: levels[area] }))
  };
}

function parseOverrides(value: unknown): Partial<Record<PermissionArea, PermissionLevel>> | null {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Partial<Record<PermissionArea, PermissionLevel>> = {};
  for (const [key, level] of Object.entries(value)) {
    if (level === undefined) continue;
    if (key === 'actions') {
      if (!actionsParse(level)) return null;
      continue;
    }
    if (!(PERMISSION_AREAS as readonly string[]).includes(key)) return null;
    if (!LEVELS.includes(level as PermissionLevel)) return null;
    out[key as PermissionArea] = level as PermissionLevel;
  }
  return out;
}

const actionsParse = (value: unknown) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.entries(value).every(([k, v]) => (ACTION_KEYS as string[]).includes(k) && (v === undefined || typeof v === 'boolean'));

/** What `canWrite` / `canDo` need from `GET /api/v1/tenants/me/access` (`MyAccess` in lib/tenant.ts). */
export interface WriteAccess {
  role: string;
  permissions: Partial<Record<PermissionArea, PermissionLevel>>;
  /** Effective finer actions; missing from an older backend. */
  actions?: Partial<Record<PermissionAction, boolean>>;
}

const FULL_ACCESS = new Set(['owner', 'admin', 'service']);

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
  if (FULL_ACCESS.has(role)) return true;
  if (area === null) return role === 'accountant';
  // Every recurring run makes an invoice draft, so the backend also wants invoices.create.
  if (area === 'recurring' && !canDo(access, 'invoices.create')) return false;
  return access.permissions[area] === 'write';
}

/**
 * Whether the member may perform one finer action (issue, send, a settings
 * section…). The backend sends the effective flags; an older backend sends
 * none, and then the area level decides, as it did before the actions.
 */
export function canDo(access: WriteAccess | null | undefined, action: PermissionAction): boolean {
  if (!access) return true;
  if (FULL_ACCESS.has(access.role)) return true;
  if (access.actions) return access.actions[action] === true;
  const level = access.permissions[areaOfAction(action)];
  return PERMISSION_ACTIONS[action] === 'read' ? level !== undefined && level !== 'none' : level === 'write';
}
