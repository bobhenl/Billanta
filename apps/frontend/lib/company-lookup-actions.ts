'use server';

import { apiFetch, ApiError } from '@/lib/api-client';
import { hitFromPrefill, registryForCountry, type CompanyHit, type VatPayerCheck } from '@/lib/company-lookup';
import type { AresPrefill } from '@/app/[locale]/(dashboard)/invoices/new/types';

/**
 * Signed-in side of the company lookup: the register of the form's country
 * (CZ + SK when unknown), through the contacts API so results share its
 * cache. Never throws; an outage means no hits.
 */
export async function searchCompanyRegistries(query: string, country?: string | null): Promise<CompanyHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await apiFetch<{ ares: AresPrefill[] }>(
      `/api/v1/contacts/search?q=${encodeURIComponent(q.slice(0, 120))}&registry=${encodeURIComponent(registryForCountry(country))}`
    );
    return (res.ares ?? []).slice(0, 8).map(hitFromPrefill);
  } catch {
    return [];
  }
}

/** One company by IČO: RPO first for a Slovak form, ARES otherwise. */
export async function lookupCompanyById(ico: string, country?: string | null): Promise<{ ok: true; data: CompanyHit & { isVatPayer: boolean | null } } | { ok: false; error: string }> {
  const digits = ico.replace(/\s+/g, '');
  if (!/^\d{8}$/.test(digits)) return { ok: false, error: 'invalid_ico' };
  try {
    const data = await apiFetch<AresPrefill>('/api/v1/contacts/ares-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ico: digits, ...(country && /^[A-Za-z]{2}$/.test(country) ? { country: country.toUpperCase() } : {}) })
    });
    return { ok: true, data: { ...hitFromPrefill(data), isVatPayer: data.isVatPayer ?? null } };
  } catch (error) {
    return { ok: false, error: error instanceof ApiError && error.status === 404 ? 'not_found' : 'failed' };
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
