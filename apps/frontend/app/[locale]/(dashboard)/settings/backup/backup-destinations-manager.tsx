'use client';

import { type FormEvent, useState } from 'react';
import { toast } from '@/components/toaster';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/info-hint';
import {
  createBackupDestination,
  deleteBackupDestination,
  listBackupDestinations,
  updateBackupDestination
} from './actions';

export type BackupDestinationType = 'google_drive' | 'webhook' | 'sftp' | 'local';
export type BackupSchedule = 'daily' | 'weekly' | 'manual';

export interface BackupDestinationListItem {
  id: string;
  type: BackupDestinationType;
  schedule: BackupSchedule;
  isActive: boolean;
  webhookUrl: string | null;
  googleDriveFolderId: string | null;
  sftpHost?: string | null;
  sftpPort?: number | null;
  sftpUsername?: string | null;
  sftpPath?: string | null;
  /** Our generated key to put in the server's authorized_keys (null with a password). */
  sftpPublicKey?: string | null;
  /** Host key pinned on the first successful upload. */
  sftpHostFingerprint?: string | null;
  /** age public key the files are encrypted for. */
  encryptionRecipient?: string | null;
  /** True when the files are encrypted with a passphrase (never sent back). */
  encryptionPassphrase?: boolean;
  lastRunAt: string | null;
  /** "success", or an error message string when the last run failed. */
  lastRunStatus: string | null;
  createdAt: string;
}

export interface SftpInput {
  host: string;
  port: number;
  username: string;
  path: string;
  password?: string;
}

export type BackupEncryptionInput =
  | { mode: 'none' }
  | { mode: 'key'; recipient: string }
  | { mode: 'passphrase'; passphrase: string };

type EncryptionMode = BackupEncryptionInput['mode'];

const inputClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2';
const primaryButton =
  'inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton =
  'inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent';

const encryptionModeOf = (d: BackupDestinationListItem): EncryptionMode =>
  d.encryptionRecipient ? 'key' : d.encryptionPassphrase ? 'passphrase' : 'none';

/** Filename from a `Content-Disposition: attachment; filename="…"` header. */
function filenameFrom(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

function saveBlob(blob: Blob, filename: string): void {
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
 * webhook + add local download + run now + delete, all against
 * `/api/v1/backup-destinations` (owner only, `OwnerOnlyGuard`). Mutations go
 * through `./actions.ts`; "run now" goes through the
 * `/api/backup-destinations/:id/run-now` Route Handler because a `local`
 * destination answers with the SQLite file itself, and Google Drive is a
 * full-page navigation to `/api/backup-destinations/google-drive/authorize`.
 */
export function BackupDestinationsManager({
  initialDestinations,
  readOnly = false
}: {
  initialDestinations: BackupDestinationListItem[];
  readOnly?: boolean;
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
  const [sftpOpen, setSftpOpen] = useState(false);
  const [sftp, setSftp] = useState({ host: '', port: '22', username: '', path: 'billanta-zalohy', password: '' });
  const [sftpSchedule, setSftpSchedule] = useState<BackupSchedule>('daily');
  const [addingSftp, setAddingSftp] = useState(false);
  const [revealedPublicKey, setRevealedPublicKey] = useState<string | null>(null);
  const [encryptingId, setEncryptingId] = useState<string | null>(null);
  const [encryptionMode, setEncryptionMode] = useState<EncryptionMode>('none');
  const [encryptionValue, setEncryptionValue] = useState('');
  const [savingEncryption, setSavingEncryption] = useState(false);

  async function refresh() {
    const result = await listBackupDestinations();
    if (result.ok) setDestinations(result.data);
  }

  async function handleAddWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const result = await createBackupDestination({ type: 'webhook', webhookUrl, schedule: webhookSchedule });
    setSubmitting(false);
    if (!result.ok) {
      toast({ text: result.error, tone: 'err' });
      return;
    }
    const { secret, ...destination } = result.data;
    setDestinations((current) => [destination, ...current]);
    setRevealedSecret(secret ?? null);
    setWebhookUrl('');
    setWebhookSchedule('weekly');
    setFormOpen(false);
  }

  async function handleAddSftp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddingSftp(true);
    const result = await createBackupDestination({
      type: 'sftp',
      schedule: sftpSchedule,
      sftp: {
        host: sftp.host.trim(),
        port: Number(sftp.port) || 22,
        username: sftp.username.trim(),
        path: sftp.path.trim(),
        ...(sftp.password ? { password: sftp.password } : {})
      }
    });
    setAddingSftp(false);
    if (!result.ok) {
      toast({ text: result.error, tone: 'err' });
      return;
    }
    const { secret: _secret, ...destination } = result.data;
    setDestinations((current) => [destination, ...current]);
    setRevealedPublicKey(destination.sftpPublicKey ?? null);
    setSftp({ host: '', port: '22', username: '', path: 'billanta-zalohy', password: '' });
    setSftpOpen(false);
  }

  function openEncryption(destination: BackupDestinationListItem) {
    setEncryptingId(destination.id);
    setEncryptionMode(encryptionModeOf(destination));
    setEncryptionValue(destination.encryptionRecipient ?? '');
  }

  async function handleSaveEncryption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!encryptingId) return;
    const encryption: BackupEncryptionInput =
      encryptionMode === 'key'
        ? { mode: 'key', recipient: encryptionValue.trim() }
        : encryptionMode === 'passphrase'
          ? { mode: 'passphrase', passphrase: encryptionValue }
          : { mode: 'none' };
    setSavingEncryption(true);
    const result = await updateBackupDestination(encryptingId, { encryption });
    setSavingEncryption(false);
    if (!result.ok) {
      toast({ text: result.error, tone: 'err' });
      return;
    }
    setDestinations((current) =>
      current.map((d) =>
        d.id === encryptingId
          ? {
              ...d,
              encryptionRecipient: encryption.mode === 'key' ? encryption.recipient : null,
              encryptionPassphrase: encryption.mode === 'passphrase'
            }
          : d
      )
    );
    toast(t('encryption.saved'));
    setEncryptingId(null);
    setEncryptionValue('');
  }

  function handleConnectGoogleDrive() {
    setConnecting(true);
    window.location.href = `/api/backup-destinations/google-drive/authorize?locale=${encodeURIComponent(locale)}`;
  }

  /** `local` needs no config; the server locks its schedule to `manual`. */
  async function handleAddLocal() {
    setAddingLocal(true);
    const result = await createBackupDestination({ type: 'local' });
    setAddingLocal(false);
    if (!result.ok) {
      toast({ text: result.error, tone: 'err' });
      return;
    }
    const { secret: _secret, ...destination } = result.data;
    setDestinations((current) => [destination, ...current]);
  }

  async function handleRunNow(destination: BackupDestinationListItem) {
    setRunningId(destination.id);
    try {
      const res = await fetch(`/api/backup-destinations/${destination.id}/run-now`, { method: 'POST' });
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && !type.includes('json')) {
        const fallback = `billanta-zaloha-${new Date().toISOString().slice(0, 10)}.db`;
        saveBlob(await res.blob(), filenameFrom(res.headers.get('content-disposition'), fallback));
        toast(t('runDone'));
      } else {
        const body = (await res.json().catch(() => null)) as { status?: string; error?: string; message?: string } | null;
        if (!res.ok) toast({ text: body?.message ?? body?.error ?? t('runFailed'), tone: 'err' });
        else if (body?.status && body.status !== 'success') toast({ text: t('runFailed'), tone: 'err' });
        else toast(t('runDone'));
      }
    } catch {
      toast({ text: t('runFailed'), tone: 'err' });
    }
    await refresh();
    setRunningId(null);
  }

  async function handleSchedule(destination: BackupDestinationListItem, schedule: BackupSchedule) {
    const result = await updateBackupDestination(destination.id, { schedule });
    if (!result.ok) {
      toast({ text: result.error, tone: 'err' });
      return;
    }
    setDestinations((current) => current.map((d) => (d.id === destination.id ? { ...d, schedule } : d)));
  }

  async function handleToggleActive(destination: BackupDestinationListItem) {
    const result = await updateBackupDestination(destination.id, { isActive: !destination.isActive });
    if (!result.ok) {
      toast({ text: result.error, tone: 'err' });
      return;
    }
    setDestinations((current) => current.map((d) => (d.id === destination.id ? { ...d, isActive: !d.isActive } : d)));
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t('confirmDelete'))) return;
    setDeletingId(id);
    const result = await deleteBackupDestination(id);
    setDeletingId(null);
    if (!result.ok) {
      toast({ text: result.error, tone: 'err' });
      return;
    }
    setDestinations((current) => current.filter((destination) => destination.id !== id));
  }

  async function handleCopy(value = revealedSecret) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast(t('reveal.copied'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function typeLabel(type: BackupDestinationType) {
    if (type === 'google_drive') return t('typeGoogleDrive');
    if (type === 'webhook') return t('typeWebhook');
    if (type === 'sftp') return t('typeSftp');
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
              onClick={() => handleCopy()}
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

      {revealedPublicKey && (
        <div className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-medium">{t('sftpKey.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('sftpKey.instructions')}</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
              {revealedPublicKey}
            </code>
            <button
              type="button"
              onClick={() => handleCopy(revealedPublicKey)}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              {copied ? t('reveal.copied') : t('reveal.copy')}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('sftpKey.later')}</p>
          <button type="button" onClick={() => setRevealedPublicKey(null)} className={cn(primaryButton, 'mt-3')}>
            {t('reveal.done')}
          </button>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-sm">
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
                    {destination.type === 'sftp' && destination.sftpHost && (
                      <div className="mt-0.5 max-w-[260px] truncate font-mono text-xs font-normal text-muted-foreground">
                        {destination.sftpUsername}@{destination.sftpHost}
                        {destination.sftpPort && destination.sftpPort !== 22 ? `:${destination.sftpPort}` : ''}:{destination.sftpPath || '~'}
                      </div>
                    )}
                    {destination.type === 'sftp' && (
                      <div
                        className="mt-0.5 max-w-[260px] truncate text-xs font-normal text-muted-foreground"
                        title={destination.sftpHostFingerprint ?? undefined}
                      >
                        {destination.sftpHostFingerprint
                          ? t('sftpFingerprint', { fingerprint: destination.sftpHostFingerprint })
                          : t('sftpFingerprintPending')}
                      </div>
                    )}
                    {(destination.type === 'sftp' || destination.type === 'google_drive') &&
                      encryptionModeOf(destination) !== 'none' && (
                        <span className="mt-1 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {encryptionModeOf(destination) === 'key' ? t('encryption.badgeKey') : t('encryption.badgePassphrase')}
                        </span>
                      )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {readOnly || destination.type === 'local' ? (
                      scheduleLabel(destination.schedule)
                    ) : (
                      <select
                        aria-label={t('columns.schedule')}
                        value={destination.schedule}
                        onChange={(event) => handleSchedule(destination, event.target.value as BackupSchedule)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm outline-none ring-ring focus:ring-2"
                      >
                        <option value="daily">{t('scheduleDaily')}</option>
                        <option value="weekly">{t('scheduleWeekly')}</option>
                        <option value="manual">{t('scheduleManual')}</option>
                      </select>
                    )}
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
                    {!readOnly && (
                    <div className="flex items-center justify-end gap-3">
                      {(destination.type === 'sftp' || destination.type === 'google_drive') && (
                        <button
                          type="button"
                          onClick={() => openEncryption(destination)}
                          className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:no-underline"
                        >
                          {t('encryption.button')}
                        </button>
                      )}
                      {destination.sftpPublicKey && (
                        <button
                          type="button"
                          onClick={() => setRevealedPublicKey(destination.sftpPublicKey ?? null)}
                          className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:no-underline"
                        >
                          {t('sftpKey.show')}
                        </button>
                      )}
                      {destination.type !== 'local' && (
                        <button
                          type="button"
                          onClick={() => handleToggleActive(destination)}
                          className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:no-underline"
                        >
                          {destination.isActive ? t('pause') : t('resume')}
                        </button>
                      )}
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
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      {encryptingId && !readOnly && (
        <form onSubmit={handleSaveEncryption} className="mt-6 flex flex-col gap-3 rounded-lg border border-border p-4">
          <InfoHint hint={t('encryption.hint')} rowClassName="text-sm font-medium">
            {t('encryption.title')}
          </InfoHint>
          <div className="flex flex-wrap gap-4 text-sm">
            {(['none', 'key', 'passphrase'] as const).map((mode) => (
              <label key={mode} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="encryptionMode"
                  value={mode}
                  checked={encryptionMode === mode}
                  onChange={() => {
                    setEncryptionMode(mode);
                    setEncryptionValue('');
                  }}
                />
                {t(`encryption.mode.${mode}`)}
              </label>
            ))}
          </div>
          {encryptionMode === 'key' && (
            <div className="flex flex-col gap-1.5">
              <InfoHint hint={t('encryption.keyHint')} rowClassName="text-sm font-medium">
                <label htmlFor="encryptionRecipient">{t('encryption.keyLabel')}</label>
              </InfoHint>
              <input
                id="encryptionRecipient"
                required
                spellCheck={false}
                autoComplete="off"
                placeholder="age1…"
                value={encryptionValue}
                onChange={(event) => setEncryptionValue(event.target.value)}
                className={cn(inputClass, 'font-mono')}
              />
              <p className="text-xs text-muted-foreground">
                {t('encryption.decryptKey')}{' '}
                <code className="break-all font-mono">age -d -i klic.txt zaloha.db.age &gt; zaloha.db</code>
              </p>
            </div>
          )}
          {encryptionMode === 'passphrase' && (
            <div className="flex flex-col gap-1.5">
              <InfoHint hint={t('encryption.passphraseHint')} rowClassName="text-sm font-medium">
                <label htmlFor="encryptionPassphrase">{t('encryption.passphraseLabel')}</label>
              </InfoHint>
              <input
                id="encryptionPassphrase"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                value={encryptionValue}
                onChange={(event) => setEncryptionValue(event.target.value)}
                className={inputClass}
              />
              <p className="text-xs text-muted-foreground">
                {t('encryption.decryptPassphrase')}{' '}
                <code className="break-all font-mono">age -d zaloha.db.age &gt; zaloha.db</code>
              </p>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingEncryption} className={primaryButton}>
              {savingEncryption ? t('encryption.saving') : t('encryption.save')}
            </button>
            <button type="button" onClick={() => setEncryptingId(null)} className={secondaryButton}>
              {t('addWebhook.cancel')}
            </button>
          </div>
        </form>
      )}

      {!readOnly && (
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-4 sm:col-span-3">
          {sftpOpen ? (
            <form onSubmit={handleAddSftp} className="flex flex-col gap-3">
              <InfoHint hint={t('addSftp.hint')} rowClassName="text-sm font-medium">
                {t('addSftp.title')}
              </InfoHint>
              <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sftpHost" className="text-sm font-medium">{t('addSftp.host')}</label>
                  <input
                    id="sftpHost"
                    required
                    spellCheck={false}
                    placeholder="nas.example.cz"
                    value={sftp.host}
                    onChange={(event) => setSftp({ ...sftp, host: event.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sftpPort" className="text-sm font-medium">{t('addSftp.port')}</label>
                  <input
                    id="sftpPort"
                    type="number"
                    min={1}
                    max={65535}
                    value={sftp.port}
                    onChange={(event) => setSftp({ ...sftp, port: event.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sftpUsername" className="text-sm font-medium">{t('addSftp.username')}</label>
                  <input
                    id="sftpUsername"
                    required
                    spellCheck={false}
                    autoComplete="off"
                    value={sftp.username}
                    onChange={(event) => setSftp({ ...sftp, username: event.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <InfoHint hint={t('addSftp.pathHint')} rowClassName="text-sm font-medium">
                    <label htmlFor="sftpPath">{t('addSftp.path')}</label>
                  </InfoHint>
                  <input
                    id="sftpPath"
                    spellCheck={false}
                    value={sftp.path}
                    onChange={(event) => setSftp({ ...sftp, path: event.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <InfoHint hint={t('addSftp.passwordHint')} rowClassName="text-sm font-medium">
                    <label htmlFor="sftpPassword">{t('addSftp.password')}</label>
                  </InfoHint>
                  <input
                    id="sftpPassword"
                    type="password"
                    autoComplete="new-password"
                    value={sftp.password}
                    onChange={(event) => setSftp({ ...sftp, password: event.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="sftpSchedule" className="text-sm font-medium">{t('addWebhook.scheduleLabel')}</label>
                  <select
                    id="sftpSchedule"
                    value={sftpSchedule}
                    onChange={(event) => setSftpSchedule(event.target.value as BackupSchedule)}
                    className={inputClass}
                  >
                    <option value="daily">{t('scheduleDaily')}</option>
                    <option value="weekly">{t('scheduleWeekly')}</option>
                    <option value="manual">{t('scheduleManual')}</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={addingSftp || !sftp.host.trim() || !sftp.username.trim()}
                  className={primaryButton}
                >
                  {addingSftp ? t('addWebhook.submitting') : t('addWebhook.submit')}
                </button>
                <button type="button" onClick={() => setSftpOpen(false)} disabled={addingSftp} className={secondaryButton}>
                  {t('addWebhook.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">{t('addSftp.description')}</p>
              <button type="button" onClick={() => setSftpOpen(true)} className={primaryButton}>
                {t('addSftp.button')}
              </button>
            </>
          )}
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="mb-3 text-sm text-muted-foreground">{t('connectGoogleDrive.description')}</p>
          <button
            type="button"
            onClick={handleConnectGoogleDrive}
            disabled={connecting}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connecting ? t('connectGoogleDrive.connecting') : t('connectGoogleDrive.button')}
          </button>
        </div>

        <div className="rounded-lg border border-border p-4">
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

        <div className="rounded-lg border border-border p-4">
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
      )}
    </div>
  );
}
