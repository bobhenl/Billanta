/**
 * Password rules for signup, reset and Settings → Profile. bcrypt reads only
 * the first 72 bytes and silently ignores the rest, so a longer password
 * would look stronger than it is; refuse it instead. 72 bytes is 72 ASCII
 * characters, fewer with accents.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

export function passwordProblem(password: string): 'too_short' | 'too_long' | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return 'too_long';
  return null;
}
