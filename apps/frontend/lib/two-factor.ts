/**
 * Two-factor sign-in storage and checks (server-only). The flow:
 *
 * - `auth.ts` creates every session of a user with 2FA on as
 *   `two_factor_pending`; such a session opens nothing (the dashboard layout
 *   sends it to `/two-factor`, `api-client` mints no backend token).
 * - `/two-factor` checks a code here and flips the session row to verified.
 * - Only a verified session's backend token carries `mfa`, which the
 *   backend's `TwoFactorGuard` asks for on bank connections, API keys,
 *   webhooks and backup destinations.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomInt } from "node:crypto";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { hashSessionToken } from "@/auth";
import { sessions, users } from "./auth-schema";
import { db } from "./db";
import { matchTotp } from "./totp";

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * The TOTP secret is AES-256-GCM encrypted with a key derived from the auth
 * secret, so a database copy alone cannot generate codes. Rotating
 * NEXTAUTH_SECRET therefore also turns every 2FA setup unreadable; users
 * then sign in with a recovery code and set it up again.
 */
function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set — see .env.example");
  return Buffer.from(hkdfSync("sha256", secret, "billanta-2fa", "totp-secret v1", 32));
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptTotpSecret(stored: string): string | null {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normaliseRecoveryCode(code)).digest("hex");
}

/** Ten `xxxx-xxxx` codes (no 0/o/1/l/i to misread) and their hashes for the database. */
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = Array.from({ length: 8 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export interface TwoFactorState {
  enabled: boolean;
  /** A secret was generated but never confirmed with a code. */
  setupStarted: boolean;
  recoveryCodesLeft: number;
}

export async function twoFactorState(userId: string): Promise<TwoFactorState> {
  const [row] = await db
    .select({ secret: users.totpSecret, enabledAt: users.totpEnabledAt, codes: users.totpRecoveryCodes })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    enabled: Boolean(row?.enabledAt),
    setupStarted: Boolean(row?.secret && !row.enabledAt),
    recoveryCodesLeft: row?.codes?.length ?? 0,
  };
}

/**
 * Checks a six-digit code against the stored secret, or (when
 * `allowRecovery`) a recovery code, which is used up. Pass `pendingSetup`
 * to check the not-yet-confirmed secret during setup.
 */
export async function verifyTwoFactorCode(
  userId: string,
  code: string,
  { allowRecovery = true, pendingSetup = false }: { allowRecovery?: boolean; pendingSetup?: boolean } = {},
): Promise<"totp" | "recovery" | null> {
  const [row] = await db
    .select({ secret: users.totpSecret, enabledAt: users.totpEnabledAt, codes: users.totpRecoveryCodes })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.secret || Boolean(row.enabledAt) === pendingSetup) return null;

  const secret = decryptTotpSecret(row.secret);
  const step = secret ? matchTotp(secret, code) : null;
  if (step !== null) {
    // Conditional update: two requests racing with the same code cannot both win.
    const updated = await db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
      .returning({ id: users.id });
    return updated.length > 0 ? "totp" : null;
  }

  if (!allowRecovery || pendingSetup || !row.codes?.length) return null;
  const hash = hashRecoveryCode(code);
  if (!row.codes.includes(hash)) return null;
  await db
    .update(users)
    .set({ totpRecoveryCodes: row.codes.filter((h) => h !== hash) })
    .where(eq(users.id, userId));
  return "recovery";
}

/** The current browser's session cookie (raw token), if any. */
export async function currentSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get("__Secure-authjs.session-token")?.value ?? jar.get("authjs.session-token")?.value ?? null;
}

/** Marks this browser's session as having passed the code check. */
export async function markCurrentSessionVerified(userId: string): Promise<boolean> {
  const token = await currentSessionToken();
  if (!token) return false;
  const updated = await db
    .update(sessions)
    .set({ twoFactorPending: false, twoFactorAt: new Date() })
    .where(and(eq(sessions.sessionToken, hashSessionToken(token)), eq(sessions.userId, userId)))
    .returning({ userId: sessions.userId });
  return updated.length > 0;
}

/** Signs out every other device, e.g. right after 2FA is switched on. */
export async function deleteOtherSessions(userId: string): Promise<void> {
  const token = await currentSessionToken();
  await db
    .delete(sessions)
    .where(token ? and(eq(sessions.userId, userId), ne(sessions.sessionToken, hashSessionToken(token))) : eq(sessions.userId, userId));
}
