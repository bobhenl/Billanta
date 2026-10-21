import type { CountryCode, CountryPack } from './types.js';

/**
 * Registered country packs. Each pack lives in `countries/<cc>/index.ts`;
 * registering it here is a separate step, so packs can be built in parallel
 * and wired in once reviewed. CZ and SK still run on the original modules
 * until the migration in docs/expansion/architecture.md phase 1.
 */
export const COUNTRY_PACKS: Readonly<Record<CountryCode, CountryPack>> = {};

export const countryPack = (code: string | null | undefined): CountryPack | undefined =>
  code ? COUNTRY_PACKS[code.toUpperCase()] : undefined;
