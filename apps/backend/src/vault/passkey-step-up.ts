import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import { BadRequestException, ForbiddenException } from "@nestjs/common";

/**
 * A vault passkey as a step-up method (src/auth/step-up.ts). The browser
 * signs a challenge we handed out with the passkey's private key and user
 * verification (PIN or biometrics); we check that signature here with the
 * public key stored at registration. Plain node:crypto: the two algorithms
 * the browser registers (ES256, RS256) are all we need.
 *
 * What ties an assertion to us and to this attempt:
 *   * clientDataJSON says `webauthn.get`, our challenge and our origin;
 *   * authenticatorData starts with sha256 of our rpId (the site's host,
 *     which is what the browser uses when we pass no rp.id) and has the
 *     user-present and user-verified flags;
 *   * the signature covers authenticatorData || sha256(clientDataJSON);
 *   * a signature counter that is in use only ever goes up (a cloned key).
 * Single use and expiry of the challenge are the caller's job (one DELETE).
 */

export const PASSKEY_ALGS = [-7, -257] as const;
export type PasskeyAlg = (typeof PASSKEY_ALGS)[number];

/** How long a challenge stays valid. Long enough for a PIN, short enough not to matter. */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;

export interface PasskeyAssertion {
  credentialId: string;
  /** All three base64url, straight from `AuthenticatorAssertionResponse`. */
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

export interface StoredPasskey {
  publicKey: string;
  publicKeyAlg: number;
  signCount: number;
}

export interface Expected {
  challenge: string;
  /** e.g. "https://billanta.cz"; the rpId is its host. */
  origin: string;
}

export const b64url = (bytes: Buffer) => bytes.toString("base64url");
const fromB64url = (text: string) => Buffer.from(text, "base64url");
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest();

/** The origin passkeys are used on: the dashboard's own site. */
export function passkeyOrigin(): string {
  return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").origin;
}

/**
 * The public key the browser reported at registration (`getPublicKey()`,
 * SPKI DER). Refused unless it parses and matches the algorithm, so a
 * step-up never depends on a key that can't verify anything.
 */
export function parsePasskeyPublicKey(publicKey: string, alg: number): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: fromB64url(publicKey), format: "der", type: "spki" });
  } catch {
    throw new BadRequestException("passkey_public_key_invalid");
  }
  const ok =
    (alg === -7 && key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1") ||
    (alg === -257 && key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048);
  if (!ok) throw new BadRequestException("passkey_public_key_invalid");
  return key;
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checks one assertion; returns the counter to store. Throws 403 `passkey_step_up_failed` on anything off. */
export function verifyPasskeyAssertion(assertion: PasskeyAssertion, stored: StoredPasskey, expected: Expected): { signCount: number } {
  const fail = () => new ForbiddenException("passkey_step_up_failed");
  const clientDataBytes = fromB64url(assertion.clientDataJSON);
  let clientData: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    clientData = JSON.parse(clientDataBytes.toString("utf8"));
  } catch {
    throw fail();
  }
  if (clientData.type !== "webauthn.get") throw fail();
  if (typeof clientData.challenge !== "string" || !sameText(clientData.challenge, expected.challenge)) throw fail();
  if (clientData.origin !== expected.origin || clientData.crossOrigin === true) throw fail();

  const authData = fromB64url(assertion.authenticatorData);
  if (authData.length < 37) throw fail();
  const rpIdHash = sha256(new URL(expected.origin).hostname);
  if (!timingSafeEqual(authData.subarray(0, 32), rpIdHash)) throw fail();
  const flags = authData[32];
  if (!(flags & FLAG_USER_PRESENT) || !(flags & FLAG_USER_VERIFIED)) throw fail();
  const signCount = authData.readUInt32BE(33);

  const key = parsePasskeyPublicKey(stored.publicKey, stored.publicKeyAlg);
  const signed = Buffer.concat([authData, sha256(clientDataBytes)]);
  // ES256 signatures come DER-encoded, RS256 as PKCS#1 v1.5: node's defaults for each key type.
  let valid = false;
  try {
    valid = verify("sha256", signed, key, fromB64url(assertion.signature));
  } catch {
    valid = false;
  }
  if (!valid) throw fail();

  // Synced passkeys always say 0; a counter in use must grow, or the key was copied.
  if ((signCount !== 0 || stored.signCount !== 0) && signCount <= stored.signCount) throw fail();
  return { signCount };
}
