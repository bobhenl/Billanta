'use client';

import { type FormEvent, type ReactNode, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from '@/components/toaster';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/info-hint';
import { copyText } from '@/lib/clipboard';
import { buttonClass, inputClass } from '@/lib/ui-classes';
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
 * "Backup destinations" settings page – list + connect Google Drive + add
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
      toast({ text: result.error === 'two_factor_required' ? t('twoFactorRequired') : result.error, tone: 'err' });
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
      toast({ text: result.error === 'two_factor_required' ? t('twoFactorRequired') : result.error, tone: 'err' });
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
      toast({ text: result.error === 'two_factor_required' ? t('twoFactorRequired') : result.error, tone: 'err' });
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
      toast({ text: result.error === 'two_factor_required' ? t('twoFactorRequired') : result.error, tone: 'err' });
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
      toast({ text: result.error === 'two_factor_required' ? t('twoFactorRequired') : result.error, tone: 'err' });
      return;
    }
    setDestinations((current) => current.map((d) => (d.id === destination.id ? { ...d, schedule } : d)));
  }

  async function handleToggleActive(destination: BackupDestinationListItem) {
    const result = await updateBackupDestination(destination.id, { isActive: !destination.isActive });
    if (!result.ok) {
      toast({ text: result.error === 'two_factor_required' ? t('twoFactorRequired') : result.error, tone: 'err' });
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
      toast({ text: result.error === 'two_factor_required' ? t('twoFactorRequired') : result.error, tone: 'err' });
      return;
    }
    setDestinations((current) => current.filter((destination) => destination.id !== id));
  }

  async function handleCopy(value = revealedSecret) {
    if (!value) return;
    await copyText(value);
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

  const scheduleOptions = (
    <>
      <option value="daily">{t('scheduleDaily')}</option>
      <option value="weekly">{t('scheduleWeekly')}</option>
      <option value="manual">{t('scheduleManual')}</option>
    </>
  );
  const linkButton = 'text-xs font-semibold text-muted-foreground hover:text-primary disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="mt-6 space-y-6">
      {revealedSecret && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-bold">{t('reveal.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('reveal.warning')}</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm">
              {revealedSecret}
            </code>
            <button type="button" onClick={() => handleCopy()} className={cn(buttonClass.secondary, 'shrink-0')} title={t('reveal.copy')} aria-label={t('reveal.copy')}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="hidden sm:inline">{copied ? t('reveal.copied') : t('reveal.copy')}</span>
            </button>
          </div>
          <button type="button" onClick={() => setRevealedSecret(null)} className={cn(buttonClass.primary, 'mt-3')}>
            {t('reveal.done')}
          </button>
        </div>
      )}

      {revealedPublicKey && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-bold">{t('sftpKey.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('sftpKey.instructions')}</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs">
              {revealedPublicKey}
            </code>
            <button type="button" onClick={() => handleCopy(revealedPublicKey)} className={cn(buttonClass.secondary, 'shrink-0')} title={t('reveal.copy')} aria-label={t('reveal.copy')}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="hidden sm:inline">{copied ? t('reveal.copied') : t('reveal.copy')}</span>
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('sftpKey.later')}</p>
          <button type="button" onClick={() => setRevealedPublicKey(null)} className={cn(buttonClass.primary, 'mt-3')}>
            {t('reveal.done')}
          </button>
        </div>
      )}

      {/* A card list rather than a table: four columns plus five actions never fit a phone. */}
      <section className="rounded-xl border border-border bg-card">
        {destinations.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground sm:p-5">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {destinations.map((destination) => {
              const lastRunFailed = destination.lastRunStatus !== null && destination.lastRunStatus !== 'success';
              const encryption = encryptionModeOf(destination);
              const where =
                destination.type === 'webhook'
                  ? destination.webhookUrl
                  : destination.type === 'sftp' && destination.sftpHost
                    ? `${destination.sftpUsername}@${destination.sftpHost}${destination.sftpPort && destination.sftpPort !== 22 ? `:${destination.sftpPort}` : ''}:${destination.sftpPath || '~'}`
                    : null;
              return (
                <li key={destination.id} className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">{typeLabel(destination.type)}</p>
                      {where && (
                        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={where}>
                          {where}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 text-xs font-semibold',
                        !destination.lastRunAt ? 'text-muted-foreground' : lastRunFailed ? 'text-destructive' : 'text-success'
                      )}
                      title={lastRunFailed ? (destination.lastRunStatus ?? undefined) : undefined}
                    >
                      <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
                      {destination.lastRunAt
                        ? lastRunFailed
                          ? t('lastRunFailed')
                          : t('lastRunSuccess')
                        : destination.isActive
                          ? t('statusActive')
                          : t('statusInactive')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('columns.lastRun')}: {destination.lastRunAt ? dateFormatter.format(new Date(destination.lastRunAt)) : t('neverRun')}
                    {encryption !== 'none' && ` · ${encryption === 'key' ? t('encryption.badgeKey') : t('encryption.badgePassphrase')}`}
                  </p>
                  {destination.type === 'sftp' && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={destination.sftpHostFingerprint ?? undefined}>
                      {destination.sftpHostFingerprint
                        ? t('sftpFingerprint', { fingerprint: destination.sftpHostFingerprint })
                        : t('sftpFingerprintPending')}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {readOnly || destination.type === 'local' ? (
                      <span className="text-sm text-muted-foreground">{scheduleLabel(destination.schedule)}</span>
                    ) : (
                      <select
                        aria-label={t('columns.schedule')}
                        value={destination.schedule}
                        onChange={(event) => handleSchedule(destination, event.target.value as BackupSchedule)}
                        className={cn(inputClass, 'h-9 w-auto py-1')}
                      >
                        {scheduleOptions}
                      </select>
                    )}
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleRunNow(destination)}
                          disabled={runningId === destination.id}
                          className={cn(linkButton, 'text-primary')}
                        >
                          {runningId === destination.id ? t('runningNow') : t('runNow')}
                        </button>
                        {(destination.type === 'sftp' || destination.type === 'google_drive') && (
                          <button type="button" onClick={() => openEncryption(destination)} className={linkButton}>
                            {t('encryption.button')}
                          </button>
                        )}
                        {destination.sftpPublicKey && (
                          <button type="button" onClick={() => setRevealedPublicKey(destination.sftpPublicKey ?? null)} className={linkButton}>
                            {t('sftpKey.show')}
                          </button>
                        )}
                        {destination.type !== 'local' && (
                          <button type="button" onClick={() => handleToggleActive(destination)} className={linkButton}>
                            {destination.isActive ? t('pause') : t('resume')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(destination.id)}
                          disabled={deletingId === destination.id}
                          className={cn(linkButton, 'hover:text-destructive')}
                        >
                          {deletingId === destination.id ? t('deleting') : t('delete')}
                        </button>
                      </>
                    )}
                  </div>
                  {encryptingId === destination.id && !readOnly && (
                    <form onSubmit={handleSaveEncryption} className="mt-4 space-y-3 border-t border-border pt-4">
                      <InfoHint hint={t('encryption.hint')} rowClassName="text-sm font-bold">
                        {t('encryption.title')}
                      </InfoHint>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
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
                        <Field id="encryptionRecipient" label={t('encryption.keyLabel')} hint={t('encryption.keyHint')}>
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
                            {t('encryption.decryptKey')} <code className="break-all font-mono">age -d -i klic.txt zaloha.db.age &gt; zaloha.db</code>
                          </p>
                        </Field>
                      )}
                      {encryptionMode === 'passphrase' && (
                        <Field id="encryptionPassphrase" label={t('encryption.passphraseLabel')} hint={t('encryption.passphraseHint')}>
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
                            {t('encryption.decryptPassphrase')} <code className="break-all font-mono">age -d zaloha.db.age &gt; zaloha.db</code>
                          </p>
                        </Field>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" disabled={savingEncryption} className={buttonClass.primary}>
                          {savingEncryption ? t('encryption.saving') : t('encryption.save')}
                        </button>
                        <button type="button" onClick={() => setEncryptingId(null)} className={buttonClass.secondary}>
                          {t('addWebhook.cancel')}
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!readOnly && (
        <section className="rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-4 py-3 font-bold sm:px-5">{t('addTitle')}</h2>
          <ul className="divide-y divide-border">
            {/* Google Drive and the local download need no setup, so they lead. */}
            <li className="p-4 sm:p-5">
              <AddRow title={t('typeGoogleDrive')} description={t('connectGoogleDrive.description')}>
                <button type="button" onClick={handleConnectGoogleDrive} disabled={connecting} className={buttonClass.secondary}>
                  {connecting ? t('connectGoogleDrive.connecting') : t('connectGoogleDrive.button')}
                </button>
              </AddRow>
            </li>
            <li className="p-4 sm:p-5">
              <AddRow title={t('typeLocal')} description={t('addLocal.description')}>
                <button type="button" onClick={handleAddLocal} disabled={addingLocal} className={buttonClass.secondary}>
                  {addingLocal ? t('addLocal.adding') : t('addLocal.button')}
                </button>
              </AddRow>
            </li>
            <li className="p-4 sm:p-5">
              {sftpOpen ? (
                <form onSubmit={handleAddSftp} className="space-y-3">
                  <InfoHint hint={t('addSftp.hint')} rowClassName="font-bold">
                    {t('addSftp.title')}
                  </InfoHint>
                  <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                    <Field id="sftpHost" label={t('addSftp.host')}>
                      <input
                        id="sftpHost"
                        required
                        spellCheck={false}
                        placeholder="nas.example.cz"
                        value={sftp.host}
                        onChange={(event) => setSftp({ ...sftp, host: event.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field id="sftpPort" label={t('addSftp.port')}>
                      <input
                        id="sftpPort"
                        type="number"
                        min={1}
                        max={65535}
                        value={sftp.port}
                        onChange={(event) => setSftp({ ...sftp, port: event.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="sftpUsername" label={t('addSftp.username')}>
                      <input
                        id="sftpUsername"
                        required
                        spellCheck={false}
                        autoComplete="off"
                        value={sftp.username}
                        onChange={(event) => setSftp({ ...sftp, username: event.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field id="sftpPath" label={t('addSftp.path')} hint={t('addSftp.pathHint')}>
                      <input
                        id="sftpPath"
                        spellCheck={false}
                        value={sftp.path}
                        onChange={(event) => setSftp({ ...sftp, path: event.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field id="sftpPassword" label={t('addSftp.password')} hint={t('addSftp.passwordHint')}>
                      <input
                        id="sftpPassword"
                        type="password"
                        autoComplete="new-password"
                        value={sftp.password}
                        onChange={(event) => setSftp({ ...sftp, password: event.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field id="sftpSchedule" label={t('addWebhook.scheduleLabel')}>
                      <select
                        id="sftpSchedule"
                        value={sftpSchedule}
                        onChange={(event) => setSftpSchedule(event.target.value as BackupSchedule)}
                        className={inputClass}
                      >
                        {scheduleOptions}
                      </select>
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={addingSftp || !sftp.host.trim() || !sftp.username.trim()} className={buttonClass.primary}>
                      {addingSftp ? t('addWebhook.submitting') : t('addWebhook.submit')}
                    </button>
                    <button type="button" onClick={() => setSftpOpen(false)} disabled={addingSftp} className={buttonClass.secondary}>
                      {t('addWebhook.cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <AddRow title={t('typeSftp')} description={t('addSftp.description')}>
                  <button type="button" onClick={() => setSftpOpen(true)} className={buttonClass.secondary}>
                    {t('addSftp.button')}
                  </button>
                </AddRow>
              )}
            </li>
            <li className="p-4 sm:p-5">
              {formOpen ? (
                <form onSubmit={handleAddWebhook} className="space-y-3">
                  <p className="font-bold">{t('addWebhook.title')}</p>
                  <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                    <Field id="webhookUrl" label={t('addWebhook.urlLabel')} hint={t('addWebhook.urlHint')}>
                      <input
                        id="webhookUrl"
                        name="webhookUrl"
                        type="url"
                        required
                        placeholder={t('addWebhook.urlPlaceholder')}
                        value={webhookUrl}
                        onChange={(event) => setWebhookUrl(event.target.value)}
                        className={inputClass}
                      />
                    </Field>
                    <Field id="webhookSchedule" label={t('addWebhook.scheduleLabel')}>
                      <select
                        id="webhookSchedule"
                        name="webhookSchedule"
                        value={webhookSchedule}
                        onChange={(event) => setWebhookSchedule(event.target.value as BackupSchedule)}
                        className={inputClass}
                      >
                        {scheduleOptions}
                      </select>
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={submitting || webhookUrl.trim().length === 0} className={buttonClass.primary}>
                      {submitting ? t('addWebhook.submitting') : t('addWebhook.submit')}
                    </button>
                    <button type="button" onClick={() => setFormOpen(false)} disabled={submitting} className={buttonClass.secondary}>
                      {t('addWebhook.cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <AddRow title={t('typeWebhook')} description={t('addWebhook.description')}>
                  <button type="button" onClick={() => setFormOpen(true)} className={buttonClass.secondary}>
                    {t('addWebhook.button')}
                  </button>
                </AddRow>
              )}
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}

/** One way to add a destination: name and one line on the left, its button on the right (stacked on phones). */
function AddRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Label above the control and the optional (i) beside the label, so fields side by side line up. */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      {hint ? (
        <InfoHint hint={hint} rowClassName="text-sm font-medium">
          <label htmlFor={id}>{label}</label>
        </InfoHint>
      ) : (
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
      )}
      {children}
    </div>
  );
}
