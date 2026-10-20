import { isValidIco } from "@faktur/cz-compliance";

/**
 * Who gets the welcome trial (TRIAL_PLAN for trialDays(), plans.ts). The
 * point is that a fresh e-mail must not mean a fresh free Plus:
 *
 *   1. Not at sign-up. A company gets it when it first saves an IČO, counted
 *      from that moment, and only once (a company that already had any
 *      trial, a promo code's too, gets none).
 *   2. The IČO must pass the checksum and exist in ARES / RPO. When the
 *      register is down, nothing is decided; the next save tries again.
 *   3. One trial per IČO ever (trial_icos, outlives the company).
 *   4. One trial per user account and per e-mail (trial_claims, with +tags
 *      and Gmail dots folded), checked for every owner of the company.
 *   5. Never for demo or classroom companies.
 *
 * 1, 2 and 5 are checked here first (welcomeTrialSkip, no database needed);
 * grant_welcome_trial (rls-policies.sql) checks 1 and 3–5 again atomically
 * and is the only writer of the trial tables. A promo code can still start
 * or extend a trial on top (promo-logic.ts).
 */
export type WelcomeTrialOutcome =
  | "granted"
  | WelcomeTrialSkip
  | "not_in_registry"
  | "registry_down"
  | "ico_had_trial"
  | "user_had_trial"
  | "wrong_tenant"
  | "error";

export type WelcomeTrialSkip = "trial_off" | "not_eligible" | "tenant_had_trial" | "no_ico" | "invalid_ico";

export type WelcomeTrialTenant = {
  ico: string | null;
  isDemo: boolean;
  classroomClassId: string | null;
  trialStartedAt: Date | null;
};

/** Why this company can't have the trial before asking the register or the database, or null. */
export function welcomeTrialSkip(t: WelcomeTrialTenant, days: number): WelcomeTrialSkip | null {
  if (days <= 0) return "trial_off";
  if (t.isDemo || t.classroomClassId) return "not_eligible";
  if (t.trialStartedAt) return "tenant_had_trial";
  if (!t.ico) return "no_ico";
  if (!/^\d{8}$/.test(t.ico) || !isValidIco(t.ico)) return "invalid_ico";
  return null;
}
