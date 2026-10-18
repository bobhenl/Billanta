/**
 * Shared shape and helpers for the company-register lookup ("Načíst z
 * registru"). Used by the dashboard forms (through `/api/contacts/search` and
 * the actions in `company-lookup-actions.ts`) and by public pages without a session
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

/**
 * Half of a register search (backend `RegistryPart`). A name in "auto" or
 * "EU" asks ARES (well under a second) and the Slovak RPO (several seconds),
 * so typeaheads ask for "fast" and "slow" separately and show ARES hits
 * without waiting for RPO.
 */
export type RegistryPart = 'all' | 'fast' | 'slow';

/**
 * Whether a query can have a slow half at all. Looser than the backend's
 * `hasSlowPart` on purpose: a needless request is answered empty at once,
 * a missing one would lose Slovak hits.
 */
export function hasSlowRegistryPart(query: string, registry: CompanyRegistry): boolean {
  const q = query.trim();
  return (registry === 'auto' || registry === 'EU') && q.length >= 3 && !/^\d+$/.test(q);
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

/**
 * Which "Vztah k DPH" the register answer points to, or null when the
 * current choice already fits (or the answer says nothing). Only ever a
 * suggestion: the owner picks. An identified person (§6g ZDPH) is not in the
 * Czech register of payers but VIES lists it, so neither answer moves an
 * identified person on its own except a clear "payer" from the CZ register.
 */
export function suggestedVatStatus(
  check: Pick<VatPayerCheck, 'state'> | null,
  current: 'payer' | 'identified' | 'non_payer'
): 'payer' | 'non_payer' | null {
  if (!check) return null;
  if ((check.state === 'payer' || check.state === 'unreliable') && current !== 'payer') return 'payer';
  if (check.state === 'valid' && current === 'non_payer') return 'payer';
  if ((check.state === 'not_registered' || check.state === 'invalid') && current === 'payer') return 'non_payer';
  return null;
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
