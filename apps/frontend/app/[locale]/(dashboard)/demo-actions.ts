'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import { DEMO_TRANSFER_COOKIE } from '@/lib/demo-session';

export type DemoTransferResult = { ok: true; contacts: number; invoices: number; expenses: number } | { ok: false; error: string };

/**
 * Brings what the visitor made in the demo into this (new) company, as
 * drafts. The cookie goes once the token is spent or unusable; a server or
 * network failure keeps it, so the card can be tried again.
 */
export async function claimDemoTransfer(): Promise<DemoTransferResult> {
  const jar = await cookies();
  const token = jar.get(DEMO_TRANSFER_COOKIE)?.value;
  if (!token) return { ok: false, error: 'demo_transfer_invalid' };
  try {
    const result = await apiFetch<{ contacts: number; invoices: number; expenses: number }>('/api/v1/demo/transfer/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    jar.delete(DEMO_TRANSFER_COOKIE);
    revalidatePath('/', 'layout');
    return { ok: true, ...result };
  } catch (error) {
    // Only the owner or an admin may fill the company; anyone else can't use it either.
    if (error instanceof ApiError && error.status < 500) jar.delete(DEMO_TRANSFER_COOKIE);
    return { ok: false, error: backendMessage(error) };
  }
}

export async function dismissDemoTransfer(): Promise<void> {
  (await cookies()).delete(DEMO_TRANSFER_COOKIE);
}
