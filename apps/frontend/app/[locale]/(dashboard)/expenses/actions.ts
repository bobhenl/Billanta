'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { Expense } from '@/lib/expense-ui';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Body of `POST/PATCH /api/v1/expenses` (see the backend's `createExpenseSchema`). */
export interface ExpenseInput {
  supplierContactId?: string | null;
  supplierNameRaw?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  description?: string;
  amount?: number;
  vatRate?: number;
  currency?: string;
  expenseDate?: string;
  dueDate?: string | null;
  paidAt?: string | null;
  category?: string | null;
  documentNumber?: string | null;
  variableSymbol?: string | null;
  receiptFileUrl?: string | null;
  note?: string | null;
}

async function run<T>(path: string, init: RequestInit): Promise<ActionResult<T>> {
  try {
    const data = await apiFetch<T>(path, init);
    revalidatePath('/[locale]/(dashboard)/expenses', 'layout');
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

export async function createExpense(input: ExpenseInput) {
  return run<Expense>('/api/v1/expenses', json('POST', input));
}

export async function updateExpense(id: string, input: ExpenseInput) {
  return run<Expense>(`/api/v1/expenses/${id}`, json('PATCH', input));
}

export async function setExpensePaid(id: string, paidAt: string | null) {
  return run<Expense>(`/api/v1/expenses/${id}`, json('PATCH', { paidAt }));
}

export async function deleteExpense(id: string) {
  return run<undefined>(`/api/v1/expenses/${id}`, { method: 'DELETE' });
}

function backendMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body) as { message?: unknown; error?: unknown };
      const message = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? body.error;
      if (typeof message === 'string') return message;
    } catch {
      // not JSON — fall through
    }
    return `HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}
