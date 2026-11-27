'use client';

import { useState, useTransition } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { toast } from '@/components/toaster';
import { Link } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { removeEetCertificate, resendEetRecord, saveEetSettings, uploadEetCertificate } from './actions';
import type { EetRecord, EetRecordStatus, EetSettings } from './types';

const STATUS_TONE: Record<EetRecordStatus, string> = {
  confirmed: 'bg-success/10 text-success',
  pending: 'bg-secondary text-muted-foreground',
  overdue: 'bg-warning/15 text-warning',
  rejected: 'bg-destructive/10 text-destructive'
};

function toBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    let binary = '';
    for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
}

/**
 * Settings → EET: the evidenční jednotka and pokladna from DIS+, the
 * pokladní certifikát (.p12, write-only from here), the environment and the
 * switch, then the records sent so far with a manual resend for unanswered ones.
 */
export function EetSettingsForm({ initial, records: initialRecords, canEdit }: { initial: EetSettings; records: EetRecord[]; canEdit: boolean }) {
  const t = useTranslations('settings.eet');
  const locale = useLocale();
  const [settings, setSettings] = useState(initial);
  const [records, setRecords] = useState(initialRecords);
  const [idJednotky, setIdJednotky] = useState(initial.idJednotky ?? '');
  const [idPokl, setIdPokl] = useState(initial.idPokl ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const errorText = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.save_failed'));

  const run = <T,>(action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, done: (data: T) => void) => {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) done(result.data);
      else setError(errorText(result.error));
    });
  };

  const save = (input: Parameters<typeof saveEetSettings>[0]) =>
    run(
      () => saveEetSettings(input),
      (data) => {
        setSettings(data);
        toast(t('saved'));
      }
    );

  const upload = () => {
    if (!file) return;
    run(
      async () => uploadEetCertificate(await toBase64(file), password),
      (data) => {
        setSettings(data);
        setFile(null);
        setPassword('');
        toast(t('certificate.uploaded'));
      }
    );
  };

  const resend = (id: string) =>
    run(
      () => resendEetRecord(id),
      (row) => {
        setRecords((list) => list.map((r) => (r.id === row.id ? row : r)));
        toast(row.status === 'confirmed' ? t('records.confirmedNow') : t('records.stillPending'));
      }
    );

  const cert = settings.certificate;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);
  const dirty = idJednotky.trim() !== (settings.idJednotky ?? '') || idPokl.trim() !== (settings.idPokl ?? '');

  return (
    <div className="space-y-4">
      <Banner tone="info">{t('scope')}</Banner>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="font-bold">{t('certificate.title')}</h2>
        {cert ? (
          <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
            <dt className="text-muted-foreground">{t('certificate.eic')}</dt>
            <dd className="font-mono">{cert.commonName ?? '–'}</dd>
            <dt className="text-muted-foreground">{t('certificate.validity')}</dt>
            <dd>{t('certificate.validRange', { from: date(cert.validFrom), to: date(cert.validTo) })}</dd>
            <dt className="text-muted-foreground">{t('certificate.issuer')}</dt>
            <dd className="break-words">{cert.issuer}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t('certificate.none')}</p>
        )}
        {settings.eicMismatch && (
          <div className="mt-3">
            <Banner tone="warn">{t('certificate.eicMismatch')}</Banner>
          </div>
        )}
        {canEdit && (
          <form
            className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              upload();
            }}
          >
            <input
              type="file"
              accept=".p12,.pfx,application/x-pkcs12"
              aria-label={t('certificate.file')}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className={cn(inputClass, 'min-w-0 py-1.5 text-sm')}
            />
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('certificate.password')}
              aria-label={t('certificate.password')}
              className={cn(inputClass, 'min-w-0')}
            />
            <button type="submit" disabled={pending || !file || !password} className={cn(buttonClass.primary, 'shrink-0')}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {cert ? t('certificate.replace') : t('certificate.upload')}
            </button>
          </form>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t('certificate.storage')}</p>
        {canEdit && cert && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(removeEetCertificate, (data) => setSettings(data))}
            className="mt-2 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
          >
            {t('certificate.remove')}
          </button>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="font-bold">{t('register.title')}</h2>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save({ idJednotky: idJednotky.trim() || null, idPokl: idPokl.trim() || null });
          }}
        >
          <label className="block text-sm">
            <span className="font-semibold">{t('register.idJednotky')}</span>
            <input
              value={idJednotky}
              onChange={(event) => setIdJednotky(event.target.value)}
              inputMode="numeric"
              maxLength={9}
              disabled={!canEdit}
              className={cn(inputClass, 'mt-1 font-mono')}
            />
            <span className="mt-1 block text-xs text-muted-foreground">{t('register.idJednotkyHint')}</span>
          </label>
          <label className="block text-sm">
            <span className="font-semibold">{t('register.idPokl')}</span>
            <input
              value={idPokl}
              onChange={(event) => setIdPokl(event.target.value)}
              maxLength={20}
              disabled={!canEdit}
              className={cn(inputClass, 'mt-1 font-mono')}
            />
            <span className="mt-1 block text-xs text-muted-foreground">{t('register.idPoklHint')}</span>
          </label>
          {canEdit && (
            <div className="sm:col-span-2">
              <button type="submit" disabled={pending || !dirty} className={buttonClass.secondary}>
                {t('register.save')}
              </button>
            </div>
          )}
        </form>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="font-bold">{t('sending.title')}</h2>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={settings.cardInPerson}
            disabled={!canEdit || pending}
            onChange={(event) => save({ cardInPerson: event.target.checked })}
          />
          <span>
            <span className="block font-semibold">{t('sending.cardInPerson')}</span>
            <span className="block text-xs text-muted-foreground">{t('sending.cardInPersonHint')}</span>
          </span>
        </label>
        <fieldset className="text-sm">
          <legend className="font-semibold">{t('sending.environment')}</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {(['playground', 'production'] as const).map((env) => (
              <label key={env} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="eet-environment"
                  checked={settings.environment === env}
                  disabled={!canEdit || pending}
                  onChange={() => save({ environment: env })}
                />
                {t(`sending.${env}`)}
              </label>
            ))}
          </div>
          <span className="mt-1 block text-xs text-muted-foreground">{t('sending.environmentHint')}</span>
        </fieldset>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={settings.enabled}
            disabled={!canEdit || pending}
            onChange={(event) => save({ enabled: event.target.checked })}
          />
          <span>
            <span className="block font-semibold">{t('sending.enabled')}</span>
            <span className="block text-xs text-muted-foreground">{t('sending.enabledHint')}</span>
          </span>
        </label>
      </section>

      {error && <Banner tone="err">{error}</Banner>}

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="font-bold">{t('records.title')}</h2>
        {settings.overdue > 0 && (
          <div className="mt-3">
            <Banner tone="warn">{t('records.overdueWarning', { count: settings.overdue })}</Banner>
          </div>
        )}
        {records.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('records.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_TONE[r.status])}>{t(`records.status.${r.status}`)}</span>
                <span className="font-semibold tabular-nums">{Number(r.celkTrzba).toLocaleString(locale, { style: 'currency', currency: 'CZK' })}</span>
                <span className="text-muted-foreground">{new Date(r.datTrzby).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="text-xs text-muted-foreground">
                  {r.idPokl} / {r.poradCis}
                  {r.environment === 'playground' && ` · ${t('sending.playground')}`}
                </span>
                {r.invoiceId && (
                  <Link href={`/invoices/${r.invoiceId}`} className="text-xs font-semibold text-primary hover:underline">
                    {t('records.invoice')}
                  </Link>
                )}
                <span className="basis-full break-all font-mono text-xs text-muted-foreground">
                  {r.pok ??
                    (r.lastError
                      ? t.has(`records.errors.${r.lastError}`)
                        ? t(`records.errors.${r.lastError}`)
                        : t('records.errors.other', { code: r.lastError })
                      : '')}
                </span>
                {(r.status === 'pending' || r.status === 'overdue') && (
                  <button type="button" disabled={pending} onClick={() => resend(r.id)} className={cn(buttonClass.secondary, 'h-7 px-2 text-xs')}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('records.resend')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
