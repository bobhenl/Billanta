import { PERMISSION_AREAS, type PermissionArea, type PermissionLevel } from './access';

export type Perms = Record<PermissionArea, PermissionLevel>;
export type BaseRole = 'admin' | 'accountant' | 'viewer';

const all = (l: PermissionLevel) => Object.fromEntries(PERMISSION_AREAS.map((a) => [a, l])) as Perms;

/** Same defaults as the backend's ROLE_DEFAULT_PERMISSIONS (src/tenancy/permissions.ts). */
export const ROLE_DEFAULTS: Record<BaseRole | 'owner', Perms> = {
  owner: all('write'),
  admin: all('write'),
  accountant: all('write'),
  viewer: all('read')
};

export function effective(role: string, overrides: Partial<Perms> | null | undefined): Perms {
  const base = ROLE_DEFAULTS[role as BaseRole] ?? all('none');
  if (role === 'owner' || role === 'admin') return base;
  return { ...base, ...(overrides ?? {}) };
}

export interface TeamPreset {
  key: string;
  role: BaseRole;
  perms: Perms;
}

/**
 * Ready-made access profiles offered when inviting or editing a member. Each
 * is a base role plus per-area levels; anything else is "custom".
 */
export const TEAM_PRESETS: TeamPreset[] = [
  { key: 'admin', role: 'admin', perms: all('write') },
  { key: 'accountant', role: 'accountant', perms: all('write') },
  { key: 'invoicer', role: 'accountant', perms: { invoices: 'write', contacts: 'write', expenses: 'none', bank: 'read', reports: 'none' } },
  { key: 'expenses', role: 'accountant', perms: { invoices: 'read', contacts: 'read', expenses: 'write', bank: 'none', reports: 'none' } },
  { key: 'auditor', role: 'viewer', perms: all('read') },
  { key: 'viewer', role: 'viewer', perms: { invoices: 'read', contacts: 'read', expenses: 'read', bank: 'none', reports: 'none' } }
];

export const samePerms = (a: Perms, b: Perms) => PERMISSION_AREAS.every((k) => a[k] === b[k]);

/** The preset a member's access matches, or 'custom'. */
export function presetOf(role: string, overrides: Partial<Perms> | null | undefined): string {
  if (role === 'owner') return 'owner';
  const perms = effective(role, overrides);
  return TEAM_PRESETS.find((p) => p.role === role && samePerms(p.perms, perms))?.key ?? 'custom';
}

/**
 * What to send for a custom set of levels: an editing role when anything is
 * writable (accountant), otherwise read-only (viewer), plus only the areas
 * that differ from that role's defaults.
 */
export function toAssignment(perms: Perms): { role: Exclude<BaseRole, 'admin'>; permissions: Partial<Perms> | null } {
  const role = PERMISSION_AREAS.some((a) => perms[a] === 'write') ? 'accountant' : 'viewer';
  const diff = Object.fromEntries(PERMISSION_AREAS.filter((a) => perms[a] !== ROLE_DEFAULTS[role][a]).map((a) => [a, perms[a]])) as Partial<Perms>;
  return { role, permissions: Object.keys(diff).length ? diff : null };
}
