'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { Contact } from '../invoices/new/types';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Star or unstar a customer; returns the stored value, or null on failure. */
export async function setContactStarred(id: string, starred: boolean): Promise<boolean | null> {
  try {
    const row = await apiFetch<{ isStarred: boolean }>(`/api/v1/contacts/${encodeURIComponent(id)}/star`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred })
    });
    return row.isStarred;
  } catch {
    return null;
  }
}

/** Turns the customer portal on or renews its link (enabled), or turns it off; returns the new link segment. */
export async function setContactPortal(id: string, enabled: boolean): Promise<ActionResult<string | null>> {
  try {
    const row = await apiFetch<{ portalToken: string | null; portalLink: string | null }>(`/api/v1/contacts/${encodeURIComponent(id)}/portal`, { method: enabled ? 'POST' : 'DELETE' });
    return { ok: true, data: row.portalLink };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'unknown' };
  }
}

/** The custom name in front of the portal key; null goes back to the customer's name. The key does not change. */
export async function setContactPortalName(id: string, slug: string | null) {
  return run<{ portalSlug: string | null; portalLink: string | null; portalLinkDefault: string | null }>(
    `/api/v1/contacts/${encodeURIComponent(id)}/portal`,
    json('PATCH', { slug })
  );
}

export interface ContactInput {
  legalName?: string;
  ico?: string | null;
  dic?: string | null;
  email?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string;
  isVatPayer?: boolean | null;
  isPerson?: boolean;
  aresVerified?: boolean;
  color?: string | null;
  internalNote?: string | null;
}

async function run<T>(path: string, init: RequestInit): Promise<ActionResult<T>> {
  try {
    const data = await apiFetch<T>(path, init);
    revalidatePath('/[locale]/(dashboard)/contacts', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

export async function createContact(input: ContactInput) {
  const result = await run<Contact[]>('/api/v1/contacts', json('POST', input));
  return result.ok ? ({ ok: true, data: result.data[0] } as const) : result;
}

export async function updateContact(id: string, input: ContactInput) {
  return run<Contact>(`/api/v1/contacts/${id}`, json('PATCH', input));
}

export async function deleteContact(id: string) {
  return run<undefined>(`/api/v1/contacts/${id}`, { method: 'DELETE' });
}

/** Company data from ARES for an IČO (no save). */
export async function lookupAres(ico: string) {
  try {
    const data = await apiFetch<Omit<ContactInput, 'aresVerified'> & { legalName: string }>('/api/v1/contacts/ares-lookup', json('POST', { ico }));
    return { ok: true, data } as const;
  } catch (error) {
    return { ok: false, error: error instanceof ApiError && error.status === 404 ? 'not_found' : backendMessage(error) } as const;
  }
}

function backendMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body) as { message?: unknown; error?: unknown };
      const code = typeof body.error === 'string' && /^[a-z_]+$/.test(body.error) ? body.error : null;
      if (code) return code;
      const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      if (typeof message === 'string') return message;
    } catch {
      // not JSON
    }
    return `HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface AddressSuggestion {
  street: string;
  city: string;
  postalCode: string;
  label: string;
}

/** Address typeahead — RÚIAN via ARES for CZ, OpenStreetMap elsewhere; failures just mean no suggestions. */
export async function searchAddresses(q: string, country = 'CZ'): Promise<AddressSuggestion[]> {
  try {
    return await apiFetch<AddressSuggestion[]>(
      `/api/v1/contacts/addresses?q=${encodeURIComponent(q)}&country=${encodeURIComponent(country || 'CZ')}`
    );
  } catch {
    return [];
  }
}
