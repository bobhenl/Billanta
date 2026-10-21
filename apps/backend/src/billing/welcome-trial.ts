import { createHash } from "node:crypto";
import { czechAccountToIban, isValidIco, normalizeIban } from "@faktur/cz-compliance";

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
 *   6. Abuse signals (trialSignals): a bank account, e-mail or phone another
 *      trial company had, or a sign-up IP shared with two other trial
 *      companies in the last 30 days. A hit withholds the trial, or ends a
 *      running one when the company adds such a bank account later; the
 *      account itself keeps working on Free. Customers are never compared.
 *   7. A saved card (CARD_TRIAL_DAYS, behind TRIAL_CARD_EXTENSION) makes the
 *      trial 30 days from its start, once per card and per company, and
 *      clears 6 and a used IČO from 3 (not 4). Nothing is charged.
 *
 * 1, 2 and 5 are checked here first (welcomeTrialSkip, no database needed);
 * the SQL (grant_welcome_trial, refresh_trial_signals, extend_trial_with_card
 * in rls-policies.sql) checks 1 and 3–7 atomically against every company
 * and is the only reader and writer of the trial tables. This file only
 * normalises and hashes the company's own values. A promo code can still
 * start or extend a trial on top (promo-logic.ts).
 */
export type WelcomeTrialOutcome =
  | "granted"
  | WelcomeTrialSkip
  | "not_in_registry"
  | "registry_down"
  | "ico_had_trial"
  | "user_had_trial"
  | TrialSignalHit
  | "wrong_tenant"
  | "error";

/** Which signal withheld the trial. Logged only; the UI never says which. */
export type TrialSignalHit = "signal_bank" | "signal_contact" | "signal_ip";

export type CardTrialOutcome =
  | "extended"
  | "already_extended"
  | "card_used"
  | "user_had_trial"
  | "trial_over"
  | "no_ico"
  | "invalid_ico"
  | "not_in_registry"
  | "registry_down"
  | "not_eligible"
  | "trial_off"
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

export type TrialSignalKind = "bank" | "email" | "phone" | "ip";
export type TrialSignal = { kind: TrialSignalKind; hash: string };

const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/**
 * One spelling per bank account: the IBAN. A domestic CZ number needs its
 * bank code to become one; without it there is nothing reliable to compare.
 * The migration backfills IBANs with the same rule (upper case, no spaces).
 */
export function bankKey(account: string | null | undefined, bankCode?: string | null): string | null {
  if (!account?.trim()) return null;
  const iban = normalizeIban(account);
  if (IBAN_SHAPE.test(iban)) return iban;
  return czechAccountToIban(account, bankCode);
}

/** Same folding as trial_email_key (0051): +tags dropped, Gmail dots too. */
export function emailKey(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  const [local, domain] = e.split("@") as [string, string];
  const user = local.split("+")[0]!;
  if (domain === "gmail.com" || domain === "googlemail.com") return `${user.replace(/\./g, "")}@gmail.com`;
  return `${user}@${domain}`;
}

/**
 * Digits with the country prefix: "+420 777 123 456", "00420777123456" and
 * "777 123 456" (a CZ company) all become 420777123456. A national SK number
 * keeps its leading 0 off ("0905 123 456" -> 421905123456).
 */
export function phoneKey(phone: string | null | undefined, country: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else {
    const prefix = country === "SK" ? "421" : country === "CZ" || !country ? "420" : null;
    if (!prefix) return null;
    digits = prefix + digits.replace(/^0/, "");
  }
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/**
 * IPv4 as written; IPv6 cut to its /64, because a home or mobile line gets a
 * whole /64 and changes the rest freely.
 */
export function ipKey(ip: string | null | undefined): string | null {
  const v = ip?.trim().toLowerCase();
  if (!v) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v;
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/.exec(v);
  if (mapped) return mapped[1]!;
  if (!/^[0-9a-f:]+$/.test(v) || !v.includes(":")) return null;
  const [head, tail] = v.split("::") as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return null;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** sha256 of "kind:value", the form trial_signals keeps (and the backfill in 0084 writes). */
export function signalHash(kind: TrialSignalKind, value: string): string {
  return createHash("sha256").update(`${kind}:${value}`, "utf8").digest("hex");
}

export type TrialSignalSource = {
  country: string | null;
  banks: { account: string | null; bankCode?: string | null }[];
  emails: (string | null)[];
  phones: (string | null)[];
  ips: (string | null)[];
};

/** The company's own identifiers, normalised, hashed and deduplicated, for the SQL. */
export function trialSignals(src: TrialSignalSource): TrialSignal[] {
  const out = new Map<string, TrialSignal>();
  const add = (kind: TrialSignalKind, value: string | null) => {
    if (!value) return;
    const hash = signalHash(kind, value);
    out.set(`${kind}:${hash}`, { kind, hash });
  };
  for (const b of src.banks) add("bank", bankKey(b.account, b.bankCode));
  for (const e of src.emails) add("email", emailKey(e));
  for (const p of src.phones) add("phone", phoneKey(p, src.country));
  for (const ip of src.ips) add("ip", ipKey(ip));
  return [...out.values()];
}

/** Hash of Stripe's card fingerprint for trial_cards; the fingerprint itself is never stored. */
export function cardHash(fingerprint: string): string {
  return createHash("sha256").update(`card:${fingerprint}`, "utf8").digest("hex");
}
