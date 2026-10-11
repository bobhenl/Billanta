import { z } from "zod";

/**
 * Per-member access by area of the app. A member's role is a preset that
 * gives defaults; owners/admins can then fine-tune individual areas (stored
 * as `tenant_memberships.permissions`, null = role defaults).
 */
export const PERMISSION_AREAS = ["invoices", "contacts", "expenses", "bank", "reports"] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];
export type PermissionLevel = "none" | "read" | "write";
export type Permissions = Record<PermissionArea, PermissionLevel>;

const level = z.enum(["none", "read", "write"]);
export const permissionsSchema = z
  .object(Object.fromEntries(PERMISSION_AREAS.map((a) => [a, level.optional()])) as Record<PermissionArea, z.ZodOptional<typeof level>>)
  .strict();

const all = (l: PermissionLevel) => Object.fromEntries(PERMISSION_AREAS.map((a) => [a, l])) as Permissions;

export const ROLE_DEFAULT_PERMISSIONS: Record<string, Permissions> = {
  owner: all("write"),
  admin: all("write"),
  service: all("write"),
  accountant: all("write"),
  viewer: all("read"),
};

/** Role defaults overlaid with the member's own overrides. Owners and admins always have everything. */
export function effectivePermissions(role: string, overrides?: unknown): Permissions {
  const base = ROLE_DEFAULT_PERMISSIONS[role] ?? all("none");
  if (role === "owner" || role === "admin" || role === "service") return base;
  const parsed = permissionsSchema.safeParse(overrides ?? {});
  if (!parsed.success) return base;
  const result = { ...base };
  for (const area of PERMISSION_AREAS) {
    const v = parsed.data[area];
    if (v) result[area] = v;
  }
  return result;
}

/** Route prefixes (no `/api/`) and the area they belong to. */
const AREA_PREFIXES: [string, PermissionArea][] = [
  ["v1/invoices", "invoices"],
  ["v1/invoice-templates", "invoices"],
  ["v1/recurring-invoices", "invoices"],
  // Time is billed work: same access as invoices.
  ["v1/projects", "invoices"],
  ["v1/time-entries", "invoices"],
  ["v1/contacts", "contacts"],
  ["v1/expenses", "expenses"],
  ["v1/bank-reconciliation", "bank"],
  ["v1/exports", "reports"],
];

export function areaForPath(path: string): PermissionArea | null {
  for (const [prefix, area] of AREA_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return area;
  }
  return null;
}
