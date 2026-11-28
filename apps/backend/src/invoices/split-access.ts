import { isLinkedPartner } from "../tenancy/linked-partner";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";

/**
 * The partner split is "Po zdanění" data: owners, admins and the members
 * linked to a partner see it (the report is theirs too). Hiding it from a
 * linked partner showed every invoice under the default shares.
 */
export async function seesSplit(req: TenantScopedRequest): Promise<boolean> {
  const user = req.user!;
  if (user.role === "owner" || user.role === "admin") return true;
  return !user.apiKey && (user.role === "accountant" || user.role === "viewer") && isLinkedPartner(req.tenantDb, user.tenantId, user.id);
}

export function withoutSplit<T>(row: T, sees: boolean): T {
  if (sees || !row || typeof row !== "object" || !("partnerShares" in row)) return row;
  return { ...row, partnerShares: null };
}
