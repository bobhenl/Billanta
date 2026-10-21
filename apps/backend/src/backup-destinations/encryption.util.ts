import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for `backup_destinations.config_encrypted` (the
 * decrypted Google Drive OAuth refresh token, or webhook HMAC secret — see
 * `drizzle/schema.ts`'s doc comment on that column).
 *
 * ============================================================================
 * WHY AES-256-GCM, NOT A HASH — read before "fixing" this to match
 * `api-keys/api-key.util.ts::hashApiKey`.
 * ============================================================================
 * `api_keys.key_hash` is a ONE-WAY SHA-256 digest because an API key only
 * ever needs to be *verified* (does this presented key match a stored
 * value?), never recovered — see that file's long doc comment. A Google
 * Drive refresh token is fundamentally different: the export job must
 * present the ORIGINAL token back to Google to obtain a fresh access token
 * every time it runs, and a webhook secret must be used as the literal HMAC
 * key when signing an outbound payload (`webhook-signing.util.ts`) — neither
 * use case survives a one-way hash. This needs REVERSIBLE encryption, so
 * AES-256-GCM (a NIST-standard authenticated cipher, available natively via
 * Node's `crypto` module — no extra dependency) is used instead:
 *   - "authenticated" (the GCM part) means decryption also verifies the
 *     ciphertext was not tampered with (via the 16-byte auth tag appended to
 *     it) — a corrupted or hand-edited `config_encrypted` value fails to
 *     decrypt loudly, rather than silently returning garbage that gets
 *     presented to Google or used as an HMAC key;
 *   - a fresh random 12-byte IV (GCM's recommended IV length) is generated
 *     per encryption call and stored ALONGSIDE the ciphertext (IVs are not
 *     secret — only the key is), so encrypting the same plaintext twice
 *     never produces the same stored value, and no IV ever needs to be
 *     reused with the same key (reuse is what would actually break GCM's
 *     security guarantees).
 *
 * The encryption key itself (`BACKUP_CONFIG_ENCRYPTION_KEY`, root
 * `.env.example`) is a 32-byte (256-bit) value the operator generates once
 * (e.g. `openssl rand -hex 32`) and never rotates through this code — key
 * rotation would require re-encrypting every existing row, which is out of
 * scope for this pass and not implemented here.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * Parses `BACKUP_CONFIG_ENCRYPTION_KEY` (expected as a 64-char hex string —
 * 32 raw bytes — e.g. the output of `openssl rand -hex 32`) into a Buffer.
 * Throws loudly on a missing/malformed key rather than silently encrypting
 * with a wrong-length key (Node's `createCipheriv` would itself throw for
 * `aes-256-gcm` given anything but exactly 32 bytes, but this gives a much
 * clearer error message pointing at the actual misconfiguration).
 */
function resolveKey(rawKey: string | undefined): Buffer {
  if (!rawKey) {
    throw new Error(
      "BACKUP_CONFIG_ENCRYPTION_KEY is not set – see .env.example. Generate one with " +
        "`openssl rand -hex 32`.",
    );
  }

  const key = Buffer.from(rawKey, "hex");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `BACKUP_CONFIG_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes as hex ` +
        `(64 hex characters) – got ${key.length} byte(s). Generate one with \`openssl rand -hex 32\`.`,
    );
  }
  return key;
}

/**
 * Encrypts `plaintext` (a refresh token or webhook secret) with
 * `rawKey` (the raw `BACKUP_CONFIG_ENCRYPTION_KEY` env value, hex-encoded).
 * Returns a single string safe to store directly in
 * `backup_destinations.config_encrypted`: `<iv-hex>:<authTag-hex>:<ciphertext-hex>`.
 * A colon-delimited, all-hex format is deliberately simple/greppable/
 * human-inspectable (e.g. in `psql`) without needing a JSON parse, while
 * still being unambiguous (none of the three parts can contain a `:` since
 * hex only uses `[0-9a-f]`).
 */
export function encryptSecret(plaintext: string, rawKey: string | undefined): string {
  const key = resolveKey(rawKey);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

/**
 * Reverses {@link encryptSecret}. Throws if `stored` is malformed (wrong
 * number of parts, invalid hex) or if the auth tag doesn't verify (wrong
 * key, or the ciphertext was tampered with/corrupted) — callers must not
 * catch this and fall back to treating the result as "no secret configured";
 * a decryption failure means the stored value cannot be trusted, full stop.
 */
export function decryptSecret(stored: string, rawKey: string | undefined): string {
  const key = resolveKey(rawKey);
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "Malformed encrypted value: expected '<iv>:<authTag>:<ciphertext>' (all hex) – got " +
        `${parts.length} part(s)`,
    );
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(`Malformed encrypted value: IV must be ${IV_LENGTH_BYTES} bytes`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(`Malformed encrypted value: auth tag must be ${AUTH_TAG_LENGTH_BYTES} bytes`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  decipher.setAuthTag(authTag);

  // Throws (via `.final()`) if the auth tag doesn't match — GCM's tamper
  // detection, see the file's top-of-file doc comment.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
