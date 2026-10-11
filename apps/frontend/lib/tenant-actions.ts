'use server';

import { cookies, type UnsafeUnwrappedCookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ACTIVE_TENANT_COOKIE, ApiError, apiFetch, fetchMyCompanies, type CurrentTenant } from './api-client';
import { TOS_VERSION } from './tos';

export type TenantActionResult = { ok: true; id: string } | { ok: false; error: string };

const ONE_YEAR_S = 60 * 60 * 24 * 365;

function rememberActive(id: string) {
  (cookies() as unknown as UnsafeUnwrappedCookies).set(ACTIVE_TENANT_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_S
  });
}

/** Makes `id` the active company — only one the signed-in user belongs to. */
export async function switchTenant(id: string): Promise<TenantActionResult> {
  const { tenants } = await fetchMyCompanies();
  if (!tenants.some((t) => t.id === id)) return { ok: false, error: 'not_member' };
  rememberActive(id);
  revalidatePath('/', 'layout');
  return { ok: true, id };
}

/** Creates another company owned by the signed-in user and switches to it. */
export async function createTenant(companyName: string, tosAccepted: boolean): Promise<TenantActionResult> {
  const name = companyName.trim();
  if (!name) return { ok: false, error: 'name_required' };
  if (name.length > 200) return { ok: false, error: 'name_too_long' };
  if (!tosAccepted) return { ok: false, error: 'tos_required' };
  try {
    // JWT-only endpoint; the X-Tenant-Id apiFetch adds is ignored there.
    const created = await apiFetch<CurrentTenant>('/api/v1/me/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyName: name, tosVersion: TOS_VERSION })
    });
    rememberActive(created.id);
    revalidatePath('/', 'layout');
    return { ok: true, id: created.id };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && error.body.includes('tenant_limit')) {
      return { ok: false, error: 'tenant_limit' };
    }
    return { ok: false, error: 'generic' };
  }
}
