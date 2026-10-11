/**
 * Reimplementation of next-intl v4's `hasLocale()` type-guard helper.
 *
 * `apps/frontend/package.json` pins `next-intl` to the 3.x line
 * (`^3.22.0`, currently resolving to 3.26.5) — `hasLocale` was only added
 * as a top-level export starting in next-intl v4, so `import { hasLocale }
 * from 'next-intl'` does not resolve against the installed version (real
 * `tsc` error: "Module '\"next-intl\"' has no exported member
 * 'hasLocale'"). Upgrading to next-intl v4 pulls in its other breaking API
 * changes, which is out of scope for this fix — this hand-rolled
 * equivalent (same behavior: is `candidate` one of the configured locales)
 * is used instead until a deliberate v4 upgrade happens.
 */
export function hasLocale<Locale extends string>(
  locales: readonly Locale[],
  candidate: unknown,
): candidate is Locale {
  return typeof candidate === "string" && (locales as readonly string[]).includes(candidate);
}
