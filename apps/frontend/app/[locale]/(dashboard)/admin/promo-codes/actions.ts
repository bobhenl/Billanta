'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { SettingsResult } from '../../settings/actions';

export interface NewPromoCode {
  code: string;
  kind: 'event' | 'creator' | 'school' | 'other';
  benefit_type: 'trial_days' | 'free_months';
  benefit_plan: 'start' | 'plus' | 'business';
  benefit_value: number;
  max_redemptions: number | null;
  valid_from: string | null;
  valid_until: string | null;
  owner_label: string | null;
  note: string | null;
  /** The creator's or coworking's own referral code: they get referral credit for each company. */
  referral_code: string | null;
  business_preset: string | null;
  default_locale: 'cs' | 'sk' | 'en' | null;
}

async function send(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<SettingsResult> {
  try {
    await apiFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    revalidatePath('/[locale]/(dashboard)/admin/promo-codes', 'page');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

export async function createPromoCode(input: NewPromoCode) {
  return send('/api/v1/admin/promo-codes', 'POST', input);
}

/** Codes are switched off, never deleted: companies that redeemed one keep their attribution. */
export async function setPromoCodeActive(id: string, active: boolean) {
  return send(`/api/v1/admin/promo-codes/${encodeURIComponent(id)}`, 'PATCH', { active });
}
