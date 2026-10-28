import type { CountryCode, CountryPack } from './types.js';
import { AE } from './ae/index.js';
import { AT } from './at/index.js';
import { AU } from './au/index.js';
import { BE } from './be/index.js';
import { BG } from './bg/index.js';
import { BH } from './bh/index.js';
import { CA } from './ca/index.js';
import { CH } from './ch/index.js';
import { CY } from './cy/index.js';
import { DE } from './de/index.js';
import { DK } from './dk/index.js';
import { EE } from './ee/index.js';
import { ES } from './es/index.js';
import { FI } from './fi/index.js';
import { FR } from './fr/index.js';
import { GB } from './gb/index.js';
import { GR } from './gr/index.js';
import { HK } from './hk/index.js';
import { HR } from './hr/index.js';
import { HU } from './hu/index.js';
import { IE } from './ie/index.js';
import { IS } from './is/index.js';
import { IT } from './it/index.js';
import { JP } from './jp/index.js';
import { LI } from './li/index.js';
import { LT } from './lt/index.js';
import { LU } from './lu/index.js';
import { LV } from './lv/index.js';
import { MT } from './mt/index.js';
import { NL } from './nl/index.js';
import { NO } from './no/index.js';
import { NZ } from './nz/index.js';
import { OM } from './om/index.js';
import { PL } from './pl/index.js';
import { PT } from './pt/index.js';
import { QA } from './qa/index.js';
import { RO } from './ro/index.js';
import { SA } from './sa/index.js';
import { SE } from './se/index.js';
import { SG } from './sg/index.js';
import { SI } from './si/index.js';
import { TH } from './th/index.js';
import { US } from './us/index.js';

/**
 * Registered country packs. Each pack lives in `countries/<cc>/index.ts`.
 * Being registered does not open a country: which ones a company can pick
 * is `ACTIVE_COUNTRIES` in tenant-country.ts, and which ones the welcome
 * screen even mentions is the caller's switch (`onboardingCountries`).
 * CZ and SK still run on the original modules until the migration in
 * docs/expansion/architecture.md phase 1.
 */
export const COUNTRY_PACKS: Readonly<Record<CountryCode, CountryPack>> = Object.fromEntries(
  [AE, AT, AU, BE, BG, BH, CA, CH, CY, DE, DK, EE, ES, FI, FR, GB, GR, HK, HR, HU, IE, IS, IT, JP, LI, LT, LU, LV, MT, NL, NO, NZ, OM, PL, PT, QA, RO, SA, SE, SG, SI, TH, US].map((p) => [p.code, p])
);

export const countryPack = (code: string | null | undefined): CountryPack | undefined =>
  code ? COUNTRY_PACKS[code.toUpperCase()] : undefined;
