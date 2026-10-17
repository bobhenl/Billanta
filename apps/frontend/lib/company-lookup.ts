/**
 * Shared shape and helpers for the company-register lookup ("Načíst z
 * registru"). Used by the dashboard forms (through server actions in
 * `company-lookup-actions.ts`) and by public pages without a session
 * (through `/api/public/company-lookup` or a link-scoped route). No server or
 * client-only imports, so both sides can use it.
 */
import type { CompanyRegistry } from '@/components/registry-picker';

// Same list as COMPANY_REGISTRIES in registry-picker.tsx, repeated so server code never imports a client module.
const REGISTRIES: readonly string[] = ['CZ', 'SK', 'EU', 'DE', 'AT', 'IT', 'PL', 'FR', 'GB', 'NO', 'FI', 'DK', 'CH', 'US'];

/** One company from a public register, in the shape a form fills in. */
export interface CompanyHit {
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  /** ARES, RPO, VIES, FR … */
  source: string | null;
  regNumber?: string | null;
}

const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

/**
 * Which register to ask for a country picked in the form (same rule as the
 * backend's `registryForCountry`): Czechia or nothing picked = CZ + SK
 * together, a country with its own register = that one, the rest of the EU =
 * VIES, anything else = CZ + SK.
 */
export function registryForCountry(country: string | null | undefined): CompanyRegistry {
  const c = (country ?? '').trim().toUpperCase();
  if (!c || c === 'CZ') return 'auto';
  if (REGISTRIES.includes(c)) return c as CompanyRegistry;
  return EU.has(c) ? 'EU' : 'auto';
}

/** The register's own prefill shape (contacts API) to a hit. */
export function hitFromPrefill(p: {
  legalName: string;
  ico: string | null;
  dic: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
  source?: string | null;
  regNumber?: string | null;
}): CompanyHit {
  return {
    name: p.legalName,
    ico: p.ico || null,
    dic: p.dic,
    street: p.addressStreet,
    city: p.addressCity,
    postalCode: p.addressPostalCode,
    country: p.addressCountry,
    source: p.source ?? (p.addressCountry === 'SK' ? 'RPO' : 'ARES'),
    regNumber: p.regNumber ?? null
  };
}

/** Outcome of the VAT register check (backend `VatPayerCheck`, without the bank accounts on public pages). */
export type VatPayerState = 'payer' | 'unreliable' | 'not_registered' | 'valid' | 'invalid' | 'unknown';
export interface VatPayerCheck {
  vatId: string;
  state: VatPayerState;
  source: 'ADIS' | 'VIES' | null;
  name: string | null;
  bankAccounts?: string[];
}
