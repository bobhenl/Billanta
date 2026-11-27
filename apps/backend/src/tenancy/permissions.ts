import { ForbiddenException } from "@nestjs/common";
import { z } from "zod";

/**
 * Per-member access by area of the app. A member's role is a preset that
 * gives defaults; owners/admins can then fine-tune individual areas and the
 * finer actions inside them (stored as `tenant_memberships.permissions`,
 * null = role defaults).
 *
 * Stored shape, every key optional: `{ invoices: "write", …, actions: { "invoices.issue": false } }`.
 * Values written before the actions existed (`{ invoices: "write" }`) keep
 * their meaning: a missing action follows the role default, a missing
 * `projects`/`recurring` level follows the invoices level (they used to be
 * part of the invoices area).
 */
export const PERMISSION_AREAS = ["invoices", "contacts", "expenses", "bank", "reports", "projects", "recurring", "settings"] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];
export type PermissionLevel = "none" | "read" | "write";
export type Permissions = Record<PermissionArea, PermissionLevel>;

/**
 * Finer actions inside an area, with the area level each one also needs.
 * An action is allowed only when its flag is on AND the area level is
 * high enough, so lowering an area to "read" switches its write actions off.
 */
export const PERMISSION_ACTIONS = {
  "invoices.create": "write",
  "invoices.issue": "write",
  "invoices.send": "write",
  "invoices.cancel": "write",
  "expenses.create": "write",
  "expenses.approve": "write",
  "expenses.delete": "write",
  "bank.match": "write",
  "bank.connections": "write",
  "reports.export": "read",
  "settings.company": "write",
  "settings.numbering": "write",
  "settings.templates": "write",
  "settings.paymentMethods": "write",
  "settings.integrations": "write",
  "settings.apiKeys": "write",
} as const satisfies Record<string, Exclude<PermissionLevel, "none">>;
export type PermissionAction = keyof typeof PERMISSION_ACTIONS;
export const ACTION_KEYS = Object.keys(PERMISSION_ACTIONS) as PermissionAction[];
export type Actions = Record<PermissionAction, boolean>;

export const areaOfAction = (action: PermissionAction) => action.slice(0, action.indexOf(".")) as PermissionArea;

/**
 * Off unless granted: before these existed only owners and admins could do
 * them, so an old membership must not gain them silently.
 */
const OPT_IN_ACTIONS = new Set<PermissionAction>(ACTION_KEYS.filter((a) => a === "bank.connections" || areaOfAction(a) === "settings"));

/** Areas that used to be part of invoices: without their own level they follow it. */
const FOLLOWS_INVOICES: PermissionArea[] = ["projects", "recurring"];

const level = z.enum(["none", "read", "write"]);
export const permissionsSchema = z
  .object({
    ...(Object.fromEntries(PERMISSION_AREAS.map((a) => [a, level.optional()])) as Record<PermissionArea, z.ZodOptional<typeof level>>),
    actions: z
      .object(Object.fromEntries(ACTION_KEYS.map((a) => [a, z.boolean().optional()])) as Record<PermissionAction, z.ZodOptional<z.ZodBoolean>>)
      .strict()
      .optional(),
  })
  .strict();
export type StoredPermissions = z.infer<typeof permissionsSchema>;

const all = (l: PermissionLevel) => Object.fromEntries(PERMISSION_AREAS.map((a) => [a, l])) as Permissions;
const FULL_ACTIONS = Object.fromEntries(ACTION_KEYS.map((a) => [a, true])) as Actions;
const DEFAULT_ACTIONS = Object.fromEntries(ACTION_KEYS.map((a) => [a, !OPT_IN_ACTIONS.has(a)])) as Actions;

const FULL_ACCESS_ROLES = new Set(["owner", "admin", "service"]);

export const ROLE_DEFAULT_PERMISSIONS: Record<string, Permissions> = {
  owner: all("write"),
  admin: all("write"),
  service: all("write"),
  // Company settings stay with owners and admins unless a section is granted.
  accountant: { ...all("write"), settings: "read" },
  viewer: all("read"),
};

function parseOverrides(overrides: unknown): StoredPermissions | null {
  const parsed = permissionsSchema.safeParse(overrides ?? {});
  return parsed.success ? parsed.data : null;
}

/** Role defaults overlaid with the member's own overrides. Owners and admins always have everything. */
export function effectivePermissions(role: string, overrides?: unknown): Permissions {
  const base = ROLE_DEFAULT_PERMISSIONS[role] ?? all("none");
  if (FULL_ACCESS_ROLES.has(role)) return base;
  const stored = parseOverrides(overrides);
  if (!stored) return base;
  const result = { ...base };
  for (const area of PERMISSION_AREAS) {
    const v = stored[area];
    if (v) result[area] = v;
  }
  for (const area of FOLLOWS_INVOICES) {
    if (!stored[area]) result[area] = result.invoices;
  }
  return result;
}

const satisfies = (have: PermissionLevel, need: "read" | "write") => (need === "read" ? have !== "none" : have === "write");

/** Which finer actions the member may perform: the flag (stored or role default) and the area level both have to allow it. */
export function effectiveActions(role: string, overrides?: unknown): Actions {
  if (FULL_ACCESS_ROLES.has(role)) return { ...FULL_ACTIONS };
  const levels = effectivePermissions(role, overrides);
  const known = role in ROLE_DEFAULT_PERMISSIONS;
  const flags = parseOverrides(overrides)?.actions ?? {};
  return Object.fromEntries(
    ACTION_KEYS.map((a) => [a, known && (flags[a] ?? DEFAULT_ACTIONS[a]) && satisfies(levels[areaOfAction(a)], PERMISSION_ACTIONS[a])]),
  ) as Actions;
}

/** Whoever a service or controller checks: `req.user` has both fields. */
export interface Actor {
  role?: string;
  permissions?: unknown;
}

export const mayDo = (actor: Actor | undefined, action: PermissionAction) =>
  Boolean(actor?.role) && effectiveActions(actor!.role!, actor!.permissions)[action];

/**
 * Explicit check for actions the route alone doesn't tell apart (an option
 * in the body, a service called from several routes). The guard has
 * usually refused already; this keeps the rule next to the code it protects.
 */
export function assertMayDo(actor: Actor | undefined, action: PermissionAction) {
  if (!mayDo(actor, action)) throw new ForbiddenException({ error: "permission_denied", permission: action });
}

/** One line of "what you will get access to": an area and its level. */
export interface AreaAccess {
  area: PermissionArea;
  level: PermissionLevel;
}

/**
 * What a role plus overrides gives, as display rows (the invitation e-mail
 * and page). Driven by `PERMISSION_AREAS`, so a new or finer area shows up
 * here without touching the callers; `manage` marks the roles that also run
 * the team and company settings. Mirrored by `accessSummary` in
 * apps/frontend/lib/access.ts (parity test: frontend-access-summary.spec.ts).
 */
export function accessSummary(role: string, overrides?: unknown): { manage: boolean; areas: AreaAccess[] } {
  const effective = effectivePermissions(role, overrides);
  return {
    manage: role === "owner" || role === "admin",
    areas: PERMISSION_AREAS.map((area) => ({ area, level: effective[area] })),
  };
}

/** Route prefixes (no `/api/`) and the area they belong to. */
const AREA_PREFIXES: [string, PermissionArea][] = [
  ["v1/invoices", "invoices"],
  ["v1/invoice-templates", "invoices"],
  ["v1/recurring-invoices", "recurring"],
  ["v1/projects", "projects"],
  ["v1/time-entries", "projects"],
  ["v1/contacts", "contacts"],
  ["v1/expenses", "expenses"],
  ["v1/bank-reconciliation", "bank"],
  ["v1/exports", "reports"],
  // Encrypting existing documents in place ("Zašifrovat").
  ["v1/vault/invoices", "invoices"],
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function areaForPath(path: string): PermissionArea | null {
  for (const [prefix, area] of AREA_PREFIXES) {
    if (under(path, prefix)) return area;
  }
  return null;
}

/** What a request needs: an area level and possibly finer actions (in any area). */
export interface Requirement {
  area: PermissionArea;
  level: "read" | "write";
  actions: PermissionAction[];
}

/** `settings` writes whose section the route tells; everything else under `v1/tenants` stays with owners and admins. */
const SETTINGS_ROUTES: [RegExp, PermissionAction][] = [
  [/^v1\/tenants\/me\/(logo|bank-accounts(\/[^/]+)?)$/, "settings.company"],
  [/^v1\/tenants\/me\/number-formats$/, "settings.numbering"],
  [/^v1\/tenants\/me\/card-payments(\/enabled)?$/, "settings.paymentMethods"],
  [/^v1\/tenants\/me\/einvoicing\/register$/, "settings.integrations"],
  [/^v1\/integrations\/webhooks(\/[^/]+\/test)?$/, "settings.integrations"],
  [/^v1\/api-keys(\/[^/]+)?$/, "settings.apiKeys"],
];

/**
 * `PATCH v1/tenants/me` fields by settings section. A field missing here
 * (enabled modules, anything added later) needs an owner or admin.
 */
export const TENANT_FIELD_SECTIONS: Record<string, PermissionAction> = {
  company_name: "settings.company",
  legal_name: "settings.company",
  ico: "settings.company",
  dic: "settings.company",
  dic_vat_payer: "settings.company",
  vat_status: "settings.company",
  tax_advances: "settings.company",
  flat_tax_regime: "settings.company",
  activity_kind: "settings.company",
  address_street: "settings.company",
  address_city: "settings.company",
  address_postal_code: "settings.company",
  address_country: "settings.company",
  email: "settings.company",
  phone: "settings.company",
  website: "settings.company",
  registry_note: "settings.company",
  data_box_id: "settings.company",
  bank_account_number: "settings.company",
  bank_account_bank_code: "settings.company",
  bank_account_iban: "settings.company",
  bank_account_swift: "settings.company",
  public_profile: "settings.company",
  default_locale: "settings.templates",
  default_due_days: "settings.templates",
  default_payment_method: "settings.templates",
  default_note_below: "settings.templates",
  invoice_form_prefs: "settings.templates",
  email_prefs: "settings.templates",
  template_vars: "settings.templates",
  buyer_details_required: "settings.templates",
  payment_methods: "settings.paymentMethods",
};

/** The sections a company-settings patch touches, or null when one of its fields is for owners and admins only. */
export function sectionsForTenantPatch(body: unknown): PermissionAction[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const sections = new Set<PermissionAction>();
  for (const key of Object.keys(body)) {
    const section = Object.prototype.hasOwnProperty.call(TENANT_FIELD_SECTIONS, key) ? TENANT_FIELD_SECTIONS[key] : undefined;
    if (!section) return null;
    sections.add(section);
  }
  return [...sections];
}

/** Invoice writes that are more than creating or editing a draft. */
const INVOICE_ACTION_ROUTES: [RegExp, PermissionAction][] = [
  [/^v1\/invoices\/[^/]+\/(issue|refresh-parties)$/, "invoices.issue"],
  [/^v1\/invoices\/[^/]+\/(send|remind|einvoice|buyer-details-request|public-link(\/rotate)?)$/, "invoices.send"],
  [/^v1\/invoices\/[^/]+\/cancel$/, "invoices.cancel"],
  // Sending (or dropping) an encrypted document's e-mail that waited for its PDF.
  [/^v1\/vault\/invoices\/emails\/[^/]+\/(send|dismiss)$/, "invoices.send"],
];

const EXPORT_FILE = /\.(csv|xml|pdf)$/;

/**
 * What `method` on `path` (normalised: no `/api/`, lowercase, no query)
 * needs, `"admin"` for company administration only owners and admins may
 * change, or null outside the areas. Reads need the area's read level,
 * writes its write level; the actions narrow that further. `body` is only
 * looked at for the company-settings patch, whose fields span sections.
 */
export function requirementFor(method: string, path: string, body?: unknown): Requirement | "admin" | null {
  const write = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  const area = areaForPath(path);
  if (!area) {
    if (path === "v1/tenants/me/number-formats") return { area: "settings", level: "write", actions: ["settings.numbering"] };
    if (!write) return null;
    if (path === "v1/tenants/me" && method.toUpperCase() === "PATCH") {
      const sections = sectionsForTenantPatch(body);
      return sections ? { area: "settings", level: "write", actions: sections } : "admin";
    }
    const route = SETTINGS_ROUTES.find(([re]) => re.test(path));
    return route ? { area: "settings", level: "write", actions: [route[1]] } : null;
  }
  const req: Requirement = { area, level: write ? "write" : "read", actions: [] };
  if (area === "invoices" && write) {
    const route = INVOICE_ACTION_ROUTES.find(([re]) => re.test(path));
    if (route) req.actions.push(route[1]);
    else if (method.toUpperCase() === "DELETE" && /^v1\/invoices\/[^/]+$/.test(path)) req.actions.push("invoices.cancel");
    else req.actions.push("invoices.create");
  } else if (area === "expenses" && write) {
    if (/^v1\/expenses\/einvoices\/incoming\/[^/]+\/(accept|reject)$/.test(path)) req.actions.push("expenses.approve");
    else if (method.toUpperCase() === "DELETE" && /^v1\/expenses\/[^/]+$/.test(path)) req.actions.push("expenses.delete");
    else req.actions.push("expenses.create");
  } else if (area === "bank" && write) {
    // Rules count as setup, like connections; previewing or applying one only matches payments.
    const connections =
      (under(path, "v1/bank-reconciliation/connections") && !/\/[^/]+\/sync$/.test(path)) ||
      (under(path, "v1/bank-reconciliation/rules") && !/\/(preview|apply)$/.test(path));
    req.actions.push(connections ? "bank.connections" : "bank.match");
  } else if (area === "reports" && (EXPORT_FILE.test(path) || write)) {
    req.actions.push("reports.export");
  } else if (area === "recurring" && write) {
    // Every run makes an invoice draft.
    req.actions.push("invoices.create");
  } else if (area === "projects" && write && path === "v1/time-entries/invoice") {
    req.actions.push("invoices.create");
  }
  return req;
}

/** Whether the member's effective access meets `req`. */
export function meetsRequirement(role: string, overrides: unknown, req: Requirement): boolean {
  const levels = effectivePermissions(role, overrides);
  if (!satisfies(levels[req.area], req.level)) return false;
  if (req.actions.length === 0) return true;
  const actions = effectiveActions(role, overrides);
  return req.actions.every((a) => actions[a]);
}
