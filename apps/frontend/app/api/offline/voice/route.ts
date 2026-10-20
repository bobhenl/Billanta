import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { apiFetchRaw, NotSignedInError } from '@/lib/api-client';
import { checkScope, failure, type SyncResult } from '@/lib/offline-sync-result';

const LANGUAGES = new Set(['cs', 'sk', 'en']);

/**
 * Uploads one voice note from the offline outbox to
 * `POST /api/v1/invoices/voice-drafts`, which transcribes it and creates a
 * `pending_review` draft. A Route Handler rather than a server action
 * because actions cap bodies at 1 MB. Always answers 200 with a
 * `SyncResult`, like the sync actions, so the outbox handles every kind the
 * same way; the queue item id is the `Idempotency-Key`.
 */
export async function POST(request: Request) {
  const key = request.headers.get('idempotency-key');
  const scope = request.headers.get('x-offline-scope');
  if (!key || !scope) return result({ ok: false, kind: 'failed', error: 'bad_request' });

  const check = await checkScope(scope);
  if (check) return result(check);

  try {
    const incoming = await request.formData();
    const audio = incoming.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0) return result({ ok: false, kind: 'failed', error: 'no_file' });
    const locale = String(incoming.get('locale') ?? '');

    const body = new FormData();
    body.set('audio', audio, audio instanceof File ? audio.name : 'voice-note');
    if (LANGUAGES.has(locale)) body.set('language', locale);
    const res = await apiFetchRaw('/api/v1/invoices/voice-drafts', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body
    });
    const invoice = (await res.json()) as { id?: string };
    revalidatePath('/[locale]/(dashboard)/invoices', 'layout');
    return result({ ok: true, id: invoice.id ?? null });
  } catch (error) {
    // Signed out in the meantime: keep the note, the sign-out flow decides whether it is wiped.
    if (error instanceof NotSignedInError) return result({ ok: false, kind: 'retry', error: 'not_signed_in' });
    return result(failure(error));
  }
}

function result(body: SyncResult) {
  return NextResponse.json(body);
}
