'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { BankRule, BankRuleBody, RulePreview } from '@/lib/bank-rules';

export type RuleResult<T> = { ok: true; data: T } | { ok: false; error: string };

const rules = '/api/v1/bank-reconciliation/rules';

async function run<T>(path: string, method: string, body?: unknown, revalidate = true): Promise<RuleResult<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method,
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    if (revalidate) revalidatePath('/[locale]/(dashboard)', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

export async function createBankRule(body: BankRuleBody) {
  return run<BankRule>(rules, 'POST', body);
}

export async function updateBankRule(id: string, body: Partial<BankRuleBody>) {
  return run<BankRule>(`${rules}/${encodeURIComponent(id)}`, 'PATCH', body);
}

export async function deleteBankRule(id: string) {
  return run<null>(`${rules}/${encodeURIComponent(id)}`, 'DELETE');
}

export async function reorderBankRules(ids: string[]) {
  return run<BankRule[]>(`${rules}/reorder`, 'POST', { ids });
}

/** What the rule in the form would act on now. Writes nothing, so nothing to revalidate. */
export async function previewBankRule(body: BankRuleBody) {
  return run<RulePreview>(`${rules}/preview`, 'POST', body, false);
}

/** "Použít na existující": auto-match runs first, then the rule acts on what is still unmatched. */
export async function applyBankRule(id: string) {
  return run<{ applied: number; remaining: number; rematched: number }>(`${rules}/${encodeURIComponent(id)}/apply`, 'POST');
}

export async function previewSavedBankRule(id: string) {
  return run<RulePreview>(`${rules}/${encodeURIComponent(id)}/preview`, 'POST', undefined, false);
}
