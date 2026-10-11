'use client';

import { type FormEvent, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type BackupDestinationType = 'google_drive' | 'webhook' | 'local';
export type BackupSchedule = 'daily' | 'weekly' | 'manual';

export interface BackupDestinationListItem {
  id: string;
  type: BackupDestinationType;
  schedule: BackupSchedule;
  isActive: boolean;
  webhookUrl: string | null;
  googleDriveFolderId: string | null;
  lastRunAt: string | null;
  /** "success", or an error message string when the last run failed. */
  lastRunStatus: string | null;
  createdAt: string;
}

/**
 * Stand-in for a server-generated webhook secret. A real implementation
 * must NEVER generate this client-side — see `POST /api/v1/backup-
 * destinations` (`apps/backend/src/backup-destinations/backup-destinations
 * .service.ts::create`), which mints a cryptographically random secret,
 * stores only its AES-256-GCM-encrypted form (`encryption.util.ts`), and
 * returns the plaintext secret exactly once. Same placeholder shape as
 * `settings/api-keys/api-keys-manager.tsx`'s `generateMockKey`.
 */
function generateMockWebhookSecret(): string {
  const randomPart = Array.from({ length: 48 }, () =>
    '0123456789abcdef'.charAt(Math.floor(Math.random() * 16))
  ).join('');
  return randomPart;
}

/**
 * Triggers a REAL browser file download — this is the one deliberately
 * real-not-mocked UI action on this page, and even it only fakes the
 * NETWORK call, not the download mechanics themselves: a real
 * `POST /api/v1/backup-destinations/:id/run-now` against a `type: 'local'`
 * destination (`apps/backend/src/backup-destinations/backup-destinations
 * .controller.ts::runNow`) returns the actual generated SQLite file
 * (`sqlite-export.service.ts`) as the response body with
 * `Content-Disposition: attachment`; a real implementation would `fetch()`
 * that endpoint, take the response as a `Blob`, and save it exactly the way
 * this function does with a synthesized placeholder blob instead. Same
 * "mock the data, keep the user-facing mechanics real" split as
 * `handleCopy`'s real clipboard write of a mocked webhook secret elsewhere
 * on this page — TODO(backend): swap the placeholder `Blob` below for the
 * real fetched response once the session-to-backend-JWT bridge exists.
 */
function triggerMockLocalDownload(destinationId: string): void {
  const datePart = new Date().toISOString().slice(0, 10);
  const filename = `faktur-backup-local-${destinationId.slice(0, 8)}-${datePart}.db`;

  // SQLite's real magic header, so a curious tenant who inspects the
  // downloaded (mock) file sees something plausible rather than empty text.
  const blob = new Blob(['SQLite format 3\0'], { type: 'application/vnd.sqlite3' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * "Backup destinations" settings page — list + connect Google Drive + add
 * webhook + add local download + run now + delete.
 *
 * TODO(backend): wire up real network calls once an authenticated frontend
 * API client exists — every one of these endpoints already exists for real
 * (`apps/backend/src/backup-destinations/`), only this component's network
 * wiring is mocked:
 *   - initial list  -> `GET /api/v1/backup-destinations`
 *   - add webhook   -> `POST /api/v1/backup-destinations` (body: { type: 'webhook', webhookUrl, schedule })
 *   - add local     -> `POST /api/v1/backup-destinations` (body: { type: 'local', schedule: 'manual' })
 *   - connect Drive -> real full-page navigation to
 *                       `GET /api/v1/backup-destinations/google-drive/authorize`
 *                       (a 302 redirect chain through Google's consent screen and back —
 *                       this can't be a plain `fetch`/`<a href>` today because that route
 *                       requires the dashboard's bearer JWT + X-Tenant-Id header, which a
 *                       simple browser navigation has no way to attach without the same
 *                       session-to-backend-JWT bridge every other mocked action here is
 *                       waiting on)
 *   - update        -> `PATCH /api/v1/backup-destinations/:id`
 *   - delete        -> `DELETE /api/v1/backup-destinations/:id`
 *   - run now        -> `POST /api/v1/backup-destinations/:id/run-now` (for a `type: 'local'`
 *                        destination, a real backend response here IS the SQLite file itself —
 *                        see `triggerMockLocalDownload`'s doc comment)
 * Everything else (form state, the reveal-once flow, optimistic list
 * updates, copy-to-clipboard, the running/deleting per-row busy states, the
 * local-download browser mechanics) is real, working client state — same
 * split as `ApiKeysManager`.
 */
export function BackupDestinationsManager({
  initialDestinations
}: {
  initialDestinations: BackupDestinationListItem[];
}) {
  const t = useTranslations('settings.backup');
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const [destinations, setDestinations] = useState<BackupDestinationListItem[]>(initialDestinations);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSchedule, setWebhookSchedule] = useState<BackupSchedule>('weekly');
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [addingLocal, setAddingLocal] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleAddWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    // TODO(backend): replace with a real `POST /api/v1/backup-destinations` call.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const secret = generateMockWebhookSecret();
    const newDestination: BackupDestinationListItem = {
      id: crypto.randomUUID(),
      type: 'webhook',
      schedule: webhookSchedule,
      isActive: true,
      webhookUrl: webhookUrl.trim(),
      googleDriveFolderId: null,
      lastRunAt: null,
      lastRunStatus: null,
      createdAt: new Date().toISOString()
    };

    setDestinations((current) => [newDestination, ...current]);
    setRevealedSecret(secret);
    setWebhookUrl('');
    setWebhookSchedule('weekly');
    setFormOpen(false);
    setSubmitting(false);
  }

  async function handleConnectGoogleDrive() {
    setConnecting(true);

    // TODO(backend): once the session-to-backend-JWT bridge exists, this
    // should be a real full-page navigation (`window.location.href = ...`)
    // to `GET /api/v1/backup-destinations/google-drive/authorize` — see this
    // component's doc comment for why a plain link can't do that yet.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const newDestination: BackupDestinationListItem = {
      id: crypto.randomUUID(),
      type: 'google_drive',
      schedule: 'weekly',
      isActive: true,
      webhookUrl: null,
      googleDriveFolderId: null,
      lastRunAt: null,
      lastRunStatus: null,
      createdAt: new Date().toISOString()
    };
    setDestinations((current) => [newDestination, ...current]);
    setConnecting(false);
  }

  /**
   * `local` destinations need no OAuth/URL config — see this file's
   * `BackupDestinationType` doc via `create-backup-destination.dto.ts` on
   * the backend for why: there is nothing to authenticate against, the
   * "destination" is just the tenant's own browser. `schedule` is always
   * `'manual'` (enforced server-side by that same DTO) since there is no way
   * to push a file to a browser download on a timer.
   */
  async function handleAddLocal() {
    setAddingLocal(true);

    // TODO(backend): replace with a real `POST /api/v1/backup-destinations`
    // call (body: { type: 'local', schedule: 'manual' }).
    await new Promise((resolve) => setTimeout(resolve, 500));

    const newDestination: BackupDestinationListItem = {
      id: crypto.randomUUID(),
      type: 'local',
      schedule: 'manual',
      isActive: true,
      webhookUrl: null,
      googleDriveFolderId: null,
      lastRunAt: null,
      lastRunStatus: null,
      createdAt: new Date().toISOString()
    };
    setDestinations((current) => [newDestination, ...current]);
    setAddingLocal(false);
  }

  async function handleRunNow(destination: BackupDestinationListItem) {
    setRunningId(destination.id);

    // TODO(backend): replace with a real `POST /api/v1/backup-destinations/:id/run-now` call.
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (destination.type === 'local') {
      // Real browser download — see `triggerMockLocalDownload`'s doc
      // comment for why only the underlying bytes are mocked, not the
      // download mechanics.
      triggerMockLocalDownload(destination.id);
    }

    setDestinations((current) =>
      current.map((d) =>
        d.id === destination.id
          ? { ...d, lastRunAt: new Date().toISOString(), lastRunStatus: 'success' }
          : d
      )
    );
    setRunningId(null);
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('confirmDelete'))) return;
    setDeletingId(id);

    // TODO(backend): replace with a real `DELETE /api/v1/backup-destinations/:id` call.
    await new Promise((resolve) => setTimeout(resolve, 300));

    setDestinations((current) => current.filter((destination) => destination.id !== id));
    setDeletingId(null);
  }

  async function handleCopy() {
    if (!revealedSecret) return;
    await navigator.clipboard.writeText(revealedSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function typeLabel(type: BackupDestinationType) {
    if (type === 'google_drive') return t('typeGoogleDrive');
    if (type === 'webhook') return t('typeWebhook');
    return t('typeLocal');
  }

  function scheduleLabel(schedule: BackupSchedule) {
    if (schedule === 'daily') return t('scheduleDaily');
    if (schedule === 'weekly') return t('scheduleWeekly');
    return t('scheduleManual');
  }

  return (
    <div>
      {revealedSecret && (
        <div className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-medium">{t('reveal.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('reveal.warning')}</p>

          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">
              {revealedSecret}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              {copied ? t('reveal.copied') : t('reveal.copy')}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setRevealedSecret(null)}
            className="mt-3 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t('reveal.done')}
          </button>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t('columns.type')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.schedule')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.lastRun')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.status')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {destinations.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            )}

            {destinations.map((destination) => {
              const lastRunFailed =
                destination.lastRunStatus !== null && destination.lastRunStatus !== 'success';
              return (
                <tr key={destination.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-medium">
                    {typeLabel(destination.type)}
                    {destination.type === 'webhook' && destination.webhookUrl && (
                      <div className="mt-0.5 truncate text-xs font-normal text-muted-foreground">
                        {destination.webhookUrl}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {scheduleLabel(destination.schedule)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {destination.lastRunAt ? dateFormatter.format(new Date(destination.lastRunAt)) : t('neverRun')}
                  </td>
                  <td className="px-4 py-3">
                    {destination.lastRunAt ? (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                          lastRunFailed
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-success/15 text-success'
                        )}
                        title={lastRunFailed ? (destination.lastRunStatus ?? undefined) : undefined}
                      >
                        {lastRunFailed ? t('lastRunFailed') : t('lastRunSuccess')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {destination.isActive ? t('statusActive') : t('statusInactive')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => handleRunNow(destination)}
                        disabled={runningId === destination.id}
                        className="text-xs font-medium text-primary underline underline-offset-2 hover:no-underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {runningId === destination.id ? t('runningNow') : t('runNow')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(destination.id)}
                        disabled={deletingId === destination.id}
                        className="text-xs font-medium text-destructive underline underline-offset-2 hover:no-underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingId === destination.id ? t('deleting') : t('delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 rounded-lg border border-border p-4">
          <p className="mb-3 text-sm text-muted-foreground">{t('connectGoogleDrive.button')}</p>
          <button
            type="button"
            onClick={handleConnectGoogleDrive}
            disabled={connecting}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connecting ? t('connectGoogleDrive.connecting') : t('connectGoogleDrive.button')}
          </button>
        </div>

        <div className="flex-1 rounded-lg border border-border p-4">
          <p className="mb-3 text-sm text-muted-foreground">{t('addLocal.description')}</p>
          <button
            type="button"
            onClick={handleAddLocal}
            disabled={addingLocal}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addingLocal ? t('addLocal.adding') : t('addLocal.button')}
          </button>
        </div>

        <div className="flex-1 rounded-lg border border-border p-4">
          {formOpen ? (
            <form onSubmit={handleAddWebhook} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="webhookUrl" className="text-sm font-medium">
                  {t('addWebhook.urlLabel')}
                </label>
                <input
                  id="webhookUrl"
                  name="webhookUrl"
                  type="url"
                  required
                  placeholder={t('addWebhook.urlPlaceholder')}
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                />
                <p className="text-xs text-muted-foreground">{t('addWebhook.urlHint')}</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="webhookSchedule" className="text-sm font-medium">
                  {t('addWebhook.scheduleLabel')}
                </label>
                <select
                  id="webhookSchedule"
                  name="webhookSchedule"
                  value={webhookSchedule}
                  onChange={(event) => setWebhookSchedule(event.target.value as BackupSchedule)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                >
                  <option value="daily">{t('scheduleDaily')}</option>
                  <option value="weekly">{t('scheduleWeekly')}</option>
                  <option value="manual">{t('scheduleManual')}</option>
                </select>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={submitting || webhookUrl.trim().length === 0}
                  className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? t('addWebhook.submitting') : t('addWebhook.submit')}
                </button>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  {t('addWebhook.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              {t('addWebhook.button')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
