import type { TenantSettings } from './tenant';

/**
 * The tax country of the company: `tenants.country`, never the postal
 * address, which may change freely. CZ when unknown, as before the column.
 * Kept apart from lib/tenant.ts, which imports server-only code, so client
 * components can use it.
 */
export function taxCountryOf(tenant: Pick<TenantSettings, 'country' | 'addressCountry'> | null | undefined): string {
  return (tenant?.country || tenant?.addressCountry || 'CZ').trim().toUpperCase();
}
