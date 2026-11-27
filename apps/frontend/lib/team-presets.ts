import { ACTION_KEYS, areaOfAction, PERMISSION_ACTIONS, PERMISSION_AREAS, type PermissionAction, type PermissionArea, type PermissionLevel } from './access';

export type Perms = Record<PermissionArea, PermissionLevel>;
export type Flags = Record<PermissionAction, boolean>;
export type BaseRole = 'admin' | 'accountant' | 'viewer';

/** What `tenant_memberships.permissions` holds (every key optional; see apps/backend/src/tenancy/permissions.ts). */
export type StoredPerms = Partial<Perms> & { actions?: Partial<Flags> };

/**
 * A member's access as the dialog edits it: a level per area plus the raw
 * action toggles. A toggle only counts while its area level allows it
 * (`allowedActions`), so lowering an area to "read" keeps the ticks for
 * when it goes back to "write".
 */
export interface Access {
  levels: Perms;
  flags: Flags;
}

const all = (l: PermissionLevel) => Object.fromEntries(PERMISSION_AREAS.map((a) => [a, l])) as Perms;

/** Same defaults as the backend's ROLE_DEFAULT_PERMISSIONS (src/tenancy/permissions.ts). */
export const ROLE_DEFAULTS: Record<BaseRole | 'owner', Perms> = {
  owner: all('write'),
  admin: all('write'),
  accountant: { ...all('write'), settings: 'read' },
  viewer: all('read')
};

/** Off unless granted, as on the backend: before these existed only owners and admins could do them. */
export const OPT_IN_ACTIONS = new Set<PermissionAction>(ACTION_KEYS.filter((a) => a === 'bank.connections' || areaOfAction(a) === 'settings'));
export const DEFAULT_FLAGS = Object.fromEntries(ACTION_KEYS.map((a) => [a, !OPT_IN_ACTIONS.has(a)])) as Flags;
const ALL_FLAGS = Object.fromEntries(ACTION_KEYS.map((a) => [a, true])) as Flags;

/** Areas that used to be part of invoices: without their own stored level they follow it. */
const FOLLOWS_INVOICES: PermissionArea[] = ['projects', 'recurring'];

/** Finer actions per area, in the order the dialog lists them. */
export const AREA_ACTIONS = Object.fromEntries(PERMISSION_AREAS.map((area) => [area, ACTION_KEYS.filter((a) => areaOfAction(a) === area)])) as Record<
  PermissionArea,
  PermissionAction[]
>;

export function effective(role: string, stored: StoredPerms | null | undefined): Access {
  if (role === 'owner' || role === 'admin') return { levels: ROLE_DEFAULTS[role], flags: { ...ALL_FLAGS } };
  const levels = { ...(ROLE_DEFAULTS[role as BaseRole] ?? all('none')) };
  const s = stored ?? {};
  for (const area of PERMISSION_AREAS) if (s[area]) levels[area] = s[area]!;
  for (const area of FOLLOWS_INVOICES) if (!s[area]) levels[area] = levels.invoices;
  return { levels, flags: { ...DEFAULT_FLAGS, ...(s.actions ?? {}) } };
}

const satisfies = (have: PermissionLevel, need: 'read' | 'write') => (need === 'read' ? have !== 'none' : have === 'write');

/** The actions the member can really perform: the toggle and the area level both allow it (mirrors `effectiveActions`). */
export function allowedActions({ levels, flags }: Access): Flags {
  return Object.fromEntries(ACTION_KEYS.map((a) => [a, flags[a] && satisfies(levels[areaOfAction(a)], PERMISSION_ACTIONS[a])])) as Flags;
}

export interface TeamPreset {
  key: string;
  role: BaseRole;
  access: Access;
}

const preset = (key: string, role: BaseRole, levels: Partial<Perms> = {}, flags: Partial<Flags> = {}): TeamPreset => ({
  key,
  role,
  access: { levels: { ...ROLE_DEFAULTS[role], ...levels }, flags: { ...(role === 'admin' ? ALL_FLAGS : DEFAULT_FLAGS), ...flags } }
});

const INVOICER_LEVELS: Partial<Perms> = { expenses: 'none', bank: 'read', reports: 'none' };

/**
 * Ready-made access profiles offered when inviting or editing a member. Each
 * is a base role plus per-area levels and actions; anything else is
 * "custom". The older presets keep the exact access they always gave, so
 * members saved with them still show their name.
 */
export const TEAM_PRESETS: TeamPreset[] = [
  preset('admin', 'admin'),
  preset('accountant', 'accountant'),
  preset('invoicer', 'accountant', INVOICER_LEVELS),
  // Prepares drafts for someone else to issue and send.
  preset('assistant', 'accountant', INVOICER_LEVELS, { 'invoices.issue': false, 'invoices.send': false, 'invoices.cancel': false }),
  preset('expenses', 'accountant', { invoices: 'read', contacts: 'read', bank: 'none', reports: 'none', projects: 'read', recurring: 'read' }),
  preset('auditor', 'viewer'),
  preset('viewer', 'viewer', { bank: 'none', reports: 'none' })
];

export const sameAccess = (a: Access, b: Access) => {
  const fa = allowedActions(a);
  const fb = allowedActions(b);
  return PERMISSION_AREAS.every((k) => a.levels[k] === b.levels[k]) && ACTION_KEYS.every((k) => fa[k] === fb[k]);
};

/** The preset a member's access matches, or 'custom'. */
export function presetOf(role: string, stored: StoredPerms | null | undefined): string {
  if (role === 'owner') return 'owner';
  const access = effective(role, stored);
  return TEAM_PRESETS.find((p) => p.role === role && sameAccess(p.access, access))?.key ?? 'custom';
}

/**
 * What to send for a custom access: an editing role when anything is
 * writable (accountant), otherwise read-only (viewer), plus only what
 * differs from that role's defaults. Projects and recurring are stored only
 * when they differ from invoices, which they follow otherwise.
 */
export function toAssignment({ levels, flags }: Access): { role: Exclude<BaseRole, 'admin'>; permissions: StoredPerms | null } {
  const role = PERMISSION_AREAS.some((a) => levels[a] === 'write') ? 'accountant' : 'viewer';
  const out: StoredPerms = {};
  for (const a of PERMISSION_AREAS) {
    const implied = FOLLOWS_INVOICES.includes(a) ? levels.invoices : ROLE_DEFAULTS[role][a];
    if (levels[a] !== implied) out[a] = levels[a];
  }
  const actions = Object.fromEntries(ACTION_KEYS.filter((a) => flags[a] !== DEFAULT_FLAGS[a]).map((a) => [a, flags[a]])) as Partial<Flags>;
  if (Object.keys(actions).length) out.actions = actions;
  return { role, permissions: Object.keys(out).length ? out : null };
}
