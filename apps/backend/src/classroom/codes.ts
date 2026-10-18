import { createHmac, randomInt } from "node:crypto";

/** No 0/O, 1/I/L: read off a projector or a phone photo without guessing. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * "abcd 2345", "ABCD-2345" and "abcd2345" are the same code. Null when it
 * cannot be a code at all.
 */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** "ABCD2345" → "ABCD-2345", as shown and printed. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** The lookup hash of a re-entry code; the database never sees the code itself in clear. */
export function hashCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}
