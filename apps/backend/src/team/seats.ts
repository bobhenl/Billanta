import { ACCOUNTANT_SEATS, PLAN_SEATS, planFor, type PaidPlan, type PlanKey } from "../billing/plans";

export interface SeatRefusal {
  /** Which allowance ran out: team members, or the separate accountant one. */
  pool: "members" | "accountants";
  limit: number;
  /** The cheapest plan with room, null when no plan has more. */
  plan: PaidPlan | null;
}

/**
 * Whether one more person with `role` fits. `taken` are the roles of current
 * members and of invitations still waiting, without the person being added
 * or changed, so re-inviting an address or editing a member doesn't count
 * them twice.
 */
export function seatRefusal(plan: PlanKey, taken: string[], role: string): SeatRefusal | null {
  if (role === "accountant") {
    const used = taken.filter((r) => r === "accountant").length;
    return used < ACCOUNTANT_SEATS ? null : { pool: "accountants", limit: ACCOUNTANT_SEATS, plan: null };
  }
  const used = taken.filter((r) => r !== "accountant").length;
  const limit = PLAN_SEATS[plan];
  return used < limit ? null : { pool: "members", limit, plan: planFor(PLAN_SEATS, used + 1) };
}
