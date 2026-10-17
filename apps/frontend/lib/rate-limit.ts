/**
 * In-memory fixed-window limiter for the auth endpoints (sign-in, register,
 * password reset). Per process, which is fine for one frontend instance; with
 * several replicas each one counts on its own, so the limits get looser, not
 * broken. Keys are namespaced by the caller, e.g. `login:ip:1.2.3.4`.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_TRACKED_KEYS = 50_000;

function sweep(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/** Counts one attempt for `key`; false once more than `limit` happened within `windowMs`. */
export function takeToken(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (windows.size >= MAX_TRACKED_KEYS) sweep(now);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

/** Forgets `key`, e.g. after a successful sign-in. */
export function resetTokens(key: string) {
  windows.delete(key);
}

const MINUTE = 60_000;

/** Limits per action: attempts allowed within the window. */
export const AUTH_LIMITS = {
  loginPerEmail: { limit: 10, windowMs: 15 * MINUTE },
  loginPerIp: { limit: 50, windowMs: 15 * MINUTE },
  registerPerIp: { limit: 5, windowMs: 60 * MINUTE },
  forgotPerIp: { limit: 10, windowMs: 15 * MINUTE },
  forgotPerEmail: { limit: 3, windowMs: 60 * MINUTE },
  resetPerIp: { limit: 20, windowMs: 15 * MINUTE },
  // A million six-digit codes: ten tries per quarter hour makes guessing hopeless.
  twoFactorPerUser: { limit: 10, windowMs: 15 * MINUTE }
} as const;

export function allow(key: string, rule: { limit: number; windowMs: number }): boolean {
  return takeToken(key, rule.limit, rule.windowMs);
}
