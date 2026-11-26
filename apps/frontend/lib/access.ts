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
