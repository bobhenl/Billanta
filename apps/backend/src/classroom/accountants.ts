import { PERMISSION_AREAS, type Permissions } from "../tenancy/permissions";
import type { ClassroomTrack } from "./tracks";

/**
 * What a student may do as the accountant of another company of the class
 * (docs/classroom-mode-plan.md §8.2). The accountant role on its own writes
 * everywhere, invoices included, so a client's invoices could be issued or
 * cancelled behind its owner's back. Most exercises want the accountant to
 * check (review) or to book what the client hands over (bookkeeper); full is
 * for the lesson where the accountant runs the company's paperwork.
 */
export const ACCOUNTANT_MODES = ["review", "bookkeeper", "full"] as const;
export type AccountantMode = (typeof ACCOUNTANT_MODES)[number];

const PRESETS: Record<AccountantMode, Permissions | null> = {
  review: Object.fromEntries(PERMISSION_AREAS.map((a) => [a, "read"])) as Permissions,
  bookkeeper: { invoices: "read", contacts: "read", expenses: "write", bank: "write", reports: "write" },
  // The role's own defaults.
  full: null,
};

/** The membership's `permissions` for a mode (null = the accountant role's defaults). */
export function accountantPermissions(mode: AccountantMode): Permissions | null {
  const preset = PRESETS[mode];
  return preset ? { ...preset } : null;
}

/** Basic classes have no expenses, bank or reports to keep: the accountant only checks. */
export function accountantModes(track: ClassroomTrack): AccountantMode[] {
  return track === "basic" ? ["review"] : [...ACCOUNTANT_MODES];
}
