'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from './api-client';
import { checkScope, failure, type SyncResult } from './offline-sync-result';
import { invoiceBody, resolveContact } from '@/app/[locale]/(dashboard)/invoices/new/invoice-body';
import type { Contact, InvoiceDraftInput } from '@/app/[locale]/(dashboard)/invoices/new/types';
import type { ContactInput } from '@/app/[locale]/(dashboard)/contacts/actions';

export type { SyncResult };

/**
 * Sends one queued offline item (voice notes go through
 * `app/api/offline/voice/route.ts` instead: audio is over the 1 MB action limit).
 */
export async function syncOfflineContact(scope: string, key: string, input: ContactInput): Promise<SyncResult> {
  const check = await checkScope(scope);
  if (check) return check;
  try {
    const [created] = await apiFetch<Contact[]>('/api/v1/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ ...input, onDuplicateIco: 'conflict' })
    });
    revalidatePath('/[locale]/(dashboard)/contacts', 'layout');
    return { ok: true, id: created?.id ?? null };
  } catch (error) {
    return failure(error);
  }
}

/** Always a plain draft: no `issue` step here, numbering stays a click in the dashboard. */
export async function syncOfflineInvoice(scope: string, key: string, input: InvoiceDraftInput): Promise<SyncResult> {
  const check = await checkScope(scope);
  if (check) return check;
  if (input.customer?.kind === 'contact' && input.customer.id.startsWith('offline:')) {
    return { ok: false, kind: 'retry', error: 'waiting_for_contact' };
  }
  try {
    const contactId = input.customer ? await resolveContact(input.customer) : null;
    const invoice = await apiFetch<{ id: string }>('/api/v1/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({
        ...invoiceBody(input),
        contact_id: contactId,
        source_ai: false,
        template_id: input.templateId ?? undefined
      })
    });
    revalidatePath('/[locale]/(dashboard)/invoices', 'layout');
    return { ok: true, id: invoice.id };
  } catch (error) {
    return failure(error);
  }
}
