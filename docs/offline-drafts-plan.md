# Offline drafts (invoices, contacts and voice notes)

The dashboard can be opened and used to write **drafts** without a
connection. Everything that gives a document legal weight – numbering,
issuing, sending, payments – stays on the server and needs a connection.
Offline invoices are always plain drafts; nothing is issued automatically
when they sync. Issuing stays a human click in the dashboard, online.

## What the service worker caches (`public/sw.js`)

| Cache | What | Strategy |
|---|---|---|
| `billanta-static-v1` | `/_next/static/*` (JS, CSS, fonts), `/icon.svg` | network first, the copy is used offline. (In development the same URL changes with every edit; in production the browser's HTTP cache already answers the hashed files.) Trimmed to the newest 400 entries. |
| `billanta-pages-v1` | HTML of `/{locale}/dashboard`, `/{locale}/invoices/new`, `/{locale}/contacts` | network first; the cached copy is used only when the network fails. Stored without the query string. Only `200`, not redirected, `text/html`. |

When a page is stored, the worker also fetches the `/_next/static/…` chunks
that page refers to, so lazily loaded parts of the form work offline too.

Client-side navigation never loads a page's HTML, so after the dashboard has
claimed the scope (below) it asks the worker (`postMessage({type:'warm'})`)
to fetch the three pages. At most every ten minutes per tab.

Every other navigation still goes to the network only and falls back to the
small offline notice, which now links to the two forms. Client-side (RSC)
navigations are not intercepted: when they fail, Next falls back to a full
page load, which the worker then answers from the cache.

The cached pages contain company data (contacts, settings). They are deleted:

- on sign-out from the account menu or the mobile "More" sheet,
- on a company switch,
- when the login page opens (covers server-side sign-outs and expired sessions),
- when a dashboard page loads for a different user or company than the one
  the cache was written for (see *Scope* below).

## The queue (IndexedDB `billanta-offline`, store `outbox`)

```ts
interface OutboxItem {
  id: string;          // crypto.randomUUID(); also the Idempotency-Key
  scope: string;       // `${userId}:${tenantId}`
  kind: 'contact' | 'invoice' | 'voice';
  payload: ContactInput | InvoiceDraftInput | VoiceNotePayload; // contact/invoice: the same input the online server actions take
  label: string;       // shown in the sync list (customer name, first item)
  createdAt: number;
  status: 'pending' | 'conflict' | 'failed';
  error?: string;      // backend snake_case code
  conflict?: { contactId: string; legalName: string }; // the contact that already exists
}

interface VoiceNotePayload {
  audio: Blob;         // stored in IndexedDB as is
  mimeType: string;    // audio/webm, audio/ogg or audio/mp4 (Safari)
  durationMs: number;
  locale: string;      // cs/sk/en, the transcription language hint
}
```

An invoice may refer to a contact that was itself created offline:
`customer: { kind: 'contact', id: 'offline:<item id>' }`. Offline contacts are offered as
one-tap picks in the invoice form, next to the starred customers.

### Scope

The dashboard layout passes `${userId}:${activeTenantId}` to the client.
Only items with that scope are shown or synced. When the scope on page load
differs from the one stored with the queue, every item and the page cache
are deleted before anything is shown. Signing out or switching the company
from the menu asks first when items are still waiting, then clears them.
So drafts never move between accounts or companies on a shared device.

The sync server actions also receive the scope and compare it with the
signed-in user and the active company cookie. A mismatch (the company was
switched in another tab) returns `scope_mismatch` and nothing is sent.

## Sync

Runs when the browser fires `online`, when a dashboard page loads online,
right after an item is queued while online, and on "Try again". One tab at a
time (Web Locks `billanta-outbox`). Items go oldest first, contacts before
invoices, voice notes last.

- **Contact**: `POST /api/v1/contacts` with `Idempotency-Key: <id>` and
  `onDuplicateIco: "conflict"`. On success the item is removed and every
  queued invoice pointing at its `localId` is rewritten to the new contact id.
- **Invoice**: `POST /api/v1/invoices` (status `draft`, no number) with
  `Idempotency-Key: <id>`. An invoice whose offline contact has not synced
  yet waits.
- **Voice note**: the browser posts it as multipart to the Route Handler
  `app/api/offline/voice/route.ts` with the headers `Idempotency-Key: <id>`
  and `X-Offline-Scope` (server actions cap bodies at 1 MB). The handler
  checks the scope like the actions do, forwards the audio to
  `POST /api/v1/invoices/voice-drafts` and answers with the same
  `SyncResult`. The backend has apps/ai-service transcribe it
  (`POST /internal/transcribe`, the ffmpeg + Whisper step the Telegram and
  WhatsApp notes use), runs the tenant's AI invoice suggestion on the
  transcript (its AI mode, daily limit and contact matching) and creates a
  `pending_review` draft with source `ai_voice`, the transcript in the
  internal note. Like a Telegram draft it waits for review in the invoice
  list and is issued by hand. Errors: `voice_unavailable` (no AI service
  configured), `voice_empty` (no speech), `voice_too_large`, `ai_disabled`
  and `ai_key_missing` fail the item with a sentence in the sync list; an
  unreachable AI service or a Whisper failure is a 5xx and retried.
- **Network error**: the item stays `pending`, the run stops, the next
  trigger retries.
- **Backend error** (`4xx` with a code): the item becomes `failed` with the
  code. The user can retry or discard it.

### Idempotency (backend)

New tenant table `idempotency_keys (tenant_id, key, scope, resource_id,
created_at)`, primary key `(tenant_id, key)`, RLS like every tenant table.
Inside the request transaction the backend first inserts the key with
`ON CONFLICT DO NOTHING`. If the row already existed (a retry, or the same
request racing in parallel – the unique index makes the second insert wait
for the first transaction), the stored resource is returned instead of
creating a new one. If the create fails, the transaction rolls back and the
key is free again. Without the header both endpoints behave as before.
Voice drafts use the same table with scope `voice_draft`; a retry after a
lost response returns the draft without a second transcription.

### Conflicts

A contact whose IČO already exists in the company is **not** merged
silently: the backend answers `409 ico_taken` with the existing contact, and
the item becomes `conflict`. The sync list shows both names and offers:

- **Use the existing contact** – the queued contact is dropped, invoices
  waiting for it point at the existing one, then sync continues.
- **Discard** – the queued contact is dropped; invoices waiting for it sync
  without a customer (a draft may have none).

Invoice drafts have no number, so they cannot clash with anything.

## UI

- Header pill: **Offline** while there is no connection; **N waiting to
  sync** when the queue is not empty. Tapping it opens the list with each
  item's state and the conflict / retry / discard actions.
- Invoice form offline: "Save draft" queues it and goes to the dashboard (the
  invoice list is not kept offline). A draft for a customer that is still
  queued is queued too, even online, and synced right away;
  "Save and issue" is disabled with a note that issuing needs a connection.
  Customer search shows that it needs a connection; starred and offline
  customers still work.
- AI panel of a new invoice offline (not quotes: a note always becomes an
  invoice): live dictation and "Fill in" need a connection, so the panel
  shows **Record a voice note** instead (MediaRecorder, 32 kbit/s, at most
  two minutes, so a note stays far below the backend's 5 MB cap). The note
  is queued and the member stays on the form; nothing is filled in on the
  device.
- Contact editor offline: "Save" queues the new contact. Editing an existing
  contact stays online only.

## Not in scope

Editing an existing invoice or contact offline, expenses, attachments, AI
prefill of the form itself (a voice note becomes a separate draft on sync),
ARES lookups and PDF previews offline.

## Configuration

Voice notes need the `ai` compose profile and, in the shared `.env`,
`AI_SERVICE_INTERNAL_TOKEN` (any long random string; the backend sends it
as `X-Internal-Token`, an empty value makes ai-service refuse every call).
The backend reaches the service at `AI_SERVICE_URL`
(`http://ai-service:8000` in `deploy/docker-compose.prod.yml`). Without
them the queued notes fail with `voice_unavailable`.
