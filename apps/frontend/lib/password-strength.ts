/**
 * A rough password strength score for the meter under a new-password field
 * (0 = too weak … 4 = strong). Not zxcvbn: a few kilobytes of rules that
 * catch what people actually type (short, one kind of character, a common
 * word, a run like "aaaa" or "1234"). It only advises; the hard rule is
 * `passwordProblem` in lib/password.ts.
 */
export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

const COMMON = [
  'password', 'heslo', 'heslo123', 'qwerty', 'qwertz', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon',
  'abc123', 'football', 'sunshine', 'princess', 'billanta', 'faktura', 'faktury', 'ahoj', 'matrix'
];

function hasRun(password: string): boolean {
  const s = password.toLowerCase();
  for (let i = 0; i + 3 < s.length; i++) {
    const c = [0, 1, 2, 3].map((k) => s.charCodeAt(i + k));
    const same = c.every((x) => x === c[0]);
    const up = c.every((x, k) => x === c[0]! + k);
    const down = c.every((x, k) => x === c[0]! - k);
    if (same || up || down) return true;
  }
  return false;
}

export function passwordStrength(password: string): PasswordStrength {
  if (password.length < 8) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  let score = password.length >= 16 ? 3 : password.length >= 12 ? 2 : 1;
  if (classes >= 3) score += 1;
  if (classes === 1) score -= 1;
  const lower = password.toLowerCase();
  if (COMMON.some((w) => lower.includes(w))) score -= 2;
  if (hasRun(password)) score -= 1;
  return Math.max(0, Math.min(4, score)) as PasswordStrength;
}
