/**
 * ABA routing transit number: nine digits, weights 3-7-1 repeated, sum
 * divisible by 10. The first two digits are a Federal Reserve district
 * (00–12), a thrift (21–32), an electronic-only number (61–72) or traveller's
 * cheques (80). https://www.frbservices.org/resources/routing-number-directory
 */
export function validateAbaRouting(value: string): boolean {
  const d = value.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(d)) return false;
  const p = Number(d.slice(0, 2));
  if (!((p >= 0 && p <= 12) || (p >= 21 && p <= 32) || (p >= 61 && p <= 72) || p === 80)) return false;
  const w = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i % 3]!;
  return sum % 10 === 0;
}

/**
 * A domestic account as `routing account` (space, slash or colon between) or
 * a routing number alone. Account numbers have no national format; banks use
 * 4 to 17 digits, so only the length is checked.
 */
export function validateUsAccount(value: string): boolean {
  const parts = value.trim().split(/[\s/:]+/).filter(Boolean);
  if (parts.length === 1) return validateAbaRouting(parts[0]!);
  if (parts.length !== 2) return false;
  return validateAbaRouting(parts[0]!) && /^\d{4,17}$/.test(parts[1]!.replace(/-/g, ''));
}
