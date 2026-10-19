'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { SettingsResult } from '../actions';

export interface ListingInput {
  displayName: string;
  bio: string;
  regions: string[];
  remote: boolean;
  services: string[];
  languages: string[];
  priceHint: string;
  contactEmail: string;
  website: string;
}

async function run<T>(path: string, method: string, body: unknown): Promise<SettingsResult<T>> {
  try {
    const data = await apiFetch<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // The referrals page shows the partner request state too.
    revalidatePath('/[locale]/(dashboard)/settings/accountant-profile', 'page');
    revalidatePath('/[locale]/(dashboard)/settings/referrals', 'page');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

export async function saveListing(listing: ListingInput) {
  return run<{ status: string }>('/api/v1/referrals/listing', 'PUT', listing);
}

export async function withdrawListing() {
  return run<{ status: string }>('/api/v1/referrals/listing/withdraw', 'POST', {});
}

/** "Požádat o partnerský program pro účetní": staff approve it together with the listing. */
export async function requestPartnerProgram() {
  return run<{ status: 'pending' | 'approved' }>('/api/v1/referrals/partner-request', 'POST', {});
}
