import { ForbiddenException } from "@nestjs/common";
import type { AuditChange } from "../../drizzle/schema";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";

/**
 * Step-up: changes that weaken a protection (Confidential mode, vault key
 * wraps, an invoice lock, who sees which clients and invoices) need a proof
 * from the last few minutes on top of the session: the TOTP code when the
 * person has two-factor sign-in on, otherwise their password. Someone who
 * only knows the login password, or sits at an unlocked laptop, then cannot
 * quietly open things up.
 *
 * The frontend checks the proof and keeps it in the same signed re-auth
 * cookie that opens locked invoices (`apps/frontend/lib/invoice-unlock.ts`);
 * each backend JWT carries its time as `sa` and the method as `sm`. The
 * backend decides freshness itself, so a token minted earlier cannot stretch
 * the window.
 */
export const STEP_UP_WINDOW_MINUTES = 5;

const WINDOW_MS = STEP_UP_WINDOW_MINUTES * 60 * 1000;
/** Allowance for the frontend's clock running a little ahead of ours. */
const CLOCK_SKEW_MS = 30 * 1000;

export const STEP_UP_METHODS = ["totp", "recovery", "password", "recent_sign_in"] as const;
export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

type StepUpUser = Pick<AuthenticatedUser, "stepUpAt" | "stepUpMethod">;

export function hasFreshStepUp(user: StepUpUser | undefined, now = Date.now()): boolean {
  const at = user?.stepUpAt;
  if (typeof at !== "number" || !user?.stepUpMethod) return false;
  return at <= now + CLOCK_SKEW_MS && now - at <= WINDOW_MS;
}

/** 403 `step_up_required` unless the caller proved themselves a moment ago; returns how. */
export function assertStepUp(user: StepUpUser | undefined, now = Date.now()): StepUpMethod {
  if (!hasFreshStepUp(user, now)) throw new ForbiddenException("step_up_required");
  return user!.stepUpMethod!;
}

/** The audit line that says the change was confirmed, and with what. */
export function stepUpChange(method: StepUpMethod): AuditChange {
  return { field: "stepUp", from: null, to: method };
}
