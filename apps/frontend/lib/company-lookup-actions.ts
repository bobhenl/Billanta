'use server';

import { apiFetch, ApiError } from '@/lib/api-client';
import { hitFromPrefill, type CompanyHit, type VatPayerCheck } from '@/lib/company-lookup';
import type { AresPrefill } from '@/app/[locale]/(dashboard)/invoices/new/types';

// The typeahead itself is not here but in `fetchContactSearch` (a route): actions run one at a time per tab,
// and the slow Slovak half would hold up every keystroke after it.

/**
 * One company by IČO: RPO first for a Slovak form, ARES otherwise.
 * `transient` (Důvěrný režim, encrypted contacts): only the IČO goes out,
 * and the backend answers without caching or logging the result.
 */
export async function lookupCompanyById(ico: string, country?: string | null, transient = false): Promise<{ ok: true; data: CompanyHit & { isVatPayer: boolean | null } } | { ok: false; error: string }> {
  const digits = ico.replace(/\s+/g, '');
  if (!/^\d{8}$/.test(digits)) return { ok: false, error: 'invalid_ico' };
  try {
    const data = await apiFetch<AresPrefill>('/api/v1/contacts/ares-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ico: digits, ...(transient && { transient: true }), ...(country && /^[A-Za-z]{2}$/.test(country) ? { country: country.toUpperCase() } : {}) })
    });
    return { ok: true, data: { ...hitFromPrefill(data), isVatPayer: data.isVatPayer ?? null } };
  } catch (error) {
    return { ok: false, error: error instanceof ApiError && error.status === 404 ? 'not_found' : 'failed' };
  }
}

/**
 * The customer typeahead with encrypted contacts: one register hit for an
 * exact IČO, nothing for a name (a name would go to the server). Only the
 * IČO goes out and the backend keeps no copy of the answer.
 */
export async function lookupPrefillByIco(ico: string): Promise<AresPrefill | null> {
  const digits = ico.replace(/\s+/g, '');
  if (!/^\d{8}$/.test(digits)) return null;
  try {
    return await apiFetch<AresPrefill>('/api/v1/contacts/ares-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ico: digits, transient: true })
    });
  } catch {
    return null;
  }
}

/** VAT register check for a DIČ (CZ register of VAT payers, VIES for the EU); null when it cannot be told. */
export async function checkVatStatus(dic: string): Promise<VatPayerCheck | null> {
  const value = dic.replace(/[\s.-]/g, '');
  if (value.length < 4 || value.length > 16) return null;
  try {
    return await apiFetch<VatPayerCheck | null>(`/api/v1/contacts/vat-check?dic=${encodeURIComponent(value)}`);
  } catch {
    return null;
  }
}
