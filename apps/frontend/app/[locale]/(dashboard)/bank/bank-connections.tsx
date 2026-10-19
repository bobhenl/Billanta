'use client';

import { useEffect, useState, useTransition } from 'react';
import { Building2, Landmark, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Wallet } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { useCanWrite } from '@/components/access-provider';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import {
  connectFio,
  connectPaypal,
  disconnectBank,
  listPsd2Banks,
  setBankConnectionEnabled,
  startPsd2Connection,
  syncBankConnection,
  type BankConnection,
  type Psd2Bank
} from './actions';

const KNOWN_ERRORS = [
  'two_factor_required',
  'plan_required',
  'fio_token_format',
  'fio_token_invalid',
  'bank_sync_too_soon',
  'bank_unavailable',
  'rate_limited',
  'invalid_token',
  'history_locked',
  'unavailable',
  'forbidden',
  'encryption_not_configured',
  'consent_expired',
  'psd2_not_configured',
  'psd2_rejected',
  'psd2_bank_unknown',
  'psd2_country',
  'psd2_pending',
  'psd2_auth_failed',
  'psd2_no_accounts',
  'psd2_state_invalid',
  'paypal_credentials_invalid',
  'paypal_reporting_disabled'
];

/** Renewal is offered this long before the bank consent runs out. */
const EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * "Napojení na banku" — automatic download of incoming payments: Fio over
 * its own API token, other banks over PSD2 (Enable Banking) with a consent
 * given at the bank. The backend syncs on its own; the button syncs now.
 */
export function BankConnections({
  connections,
  psd2
}: {
  connections: BankConnection[];
  psd2: { available: boolean; countries: string[] };
}) {
  const t = useTranslations('bank.connections');
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Read-only still sees which accounts are connected and when they last synced.
  const canEdit = useCanWrite('bank');
  const [mode, setMode] = useState<null | 'choose' | 'fio' | 'psd2' | 'paypal'>(null);
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [country, setCountry] = useState(psd2.countries[0] ?? 'CZ');
  const locale = useLocale();
  const countryName = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const [banks, setBanks] = useState<Psd2Bank[] | null>(null);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [bankName, setBankName] = useState('');
  const [psuType, setPsuType] = useState<'business' | 'personal'>('business');
  const [paypalId, setPaypalId] = useState('');
  const [paypalSecret, setPaypalSecret] = useState('');
  const [sandbox, setSandbox] = useState(false);

  const errorText = (code: string) => (KNOWN_ERRORS.includes(code) ? t(`errors.${code}`) : t('errors.generic', { code }));

  useEffect(() => {
    if (mode !== 'psd2') return;
    let cancelled = false;
    setBanks(null);
    setBanksError(null);
    setBankName('');
    listPsd2Banks(country).then((result) => {
      if (cancelled) return;
      if (result.ok) setBanks(result.banks);
      else setBanksError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, country]);

  function run(id: string, action: () => Promise<void>) {
    setBusyId(id);
    startTransition(async () => {
      await action();
      setBusyId(null);
      router.refresh();
    });
  }

  const sync = (id: string) =>
    run(id, async () => {
      const result = await syncBankConnection(id);
      if (!result.ok) toast({ text: errorText(result.error), tone: 'err' });
      else if (result.pending) toast({ text: t('syncPending'), tone: 'ok' });
      else toast({ text: result.total ? t('synced', { total: result.total, matched: result.matched }) : t('syncedNothing'), tone: 'ok' });
    });

  const connect = () =>
    run('new', async () => {
      const result = await connectFio(token, label);
      if (!result.ok) {
        toast({ text: errorText(result.error), tone: 'err' });
        return;
      }
      toast({ text: t('connected'), tone: 'ok' });
      setToken('');
      setLabel('');
      setMode(null);
    });

  const connectPaypalAccount = () =>
    run('new', async () => {
      const result = await connectPaypal({ clientId: paypalId, secret: paypalSecret, sandbox, label });
      if (!result.ok) {
        toast({ text: errorText(result.error), tone: 'err' });
        return;
      }
      toast({ text: t('paypal.connected'), tone: 'ok' });
      setPaypalId('');
      setPaypalSecret('');
      setSandbox(false);
      setLabel('');
      setMode(null);
    });

  /** Leaves for the bank's consent screen; the bank returns to /bank/psd2-callback. */
  const goToBank = (key: string, input: Parameters<typeof startPsd2Connection>[0]) => {
    setBusyId(key);
    startTransition(async () => {
      const result = await startPsd2Connection(input);
      if (!result.ok) {
        toast({ text: errorText(result.error), tone: 'err' });
        setBusyId(null);
        return;
      }
      window.location.assign(result.url);
    });
  };

  const renew = (c: BankConnection) =>
    goToBank(c.id, { bankName: c.bankName ?? '', country: c.bankCountry ?? 'CZ', psuType: 'business', reconnectId: c.id });

  const toggle = (c: BankConnection) =>
    run(c.id, async () => {
      const result = await setBankConnectionEnabled(c.id, !c.enabled);
      if (!result.ok) toast({ text: errorText(result.error), tone: 'err' });
    });

  const remove = (c: BankConnection) => {
    if (!window.confirm(t(c.provider === 'enable_banking' ? 'psd2.disconnectConfirm' : 'disconnectConfirm'))) return;
    run(c.id, async () => {
      const result = await disconnectBank(c.id);
      if (!result.ok) toast({ text: errorText(result.error), tone: 'err' });
    });
  };

  const inputClass =
    'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
  const softButton = 'rounded-full bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-accent hover:text-primary disabled:opacity-60';
  const primaryButton =
    'inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60';

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InfoHint hint={psd2.available ? t('psd2.hint') : t('hint')} label={t('title')}>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Landmark className="h-4 w-4 text-primary" />
            {t('title')}
          </h2>
        </InfoHint>
        {canEdit && mode === null && (
          <button type="button" onClick={() => setMode('choose')} className={cn(primaryButton, 'px-3.5')}>
            <Plus className="h-3.5 w-3.5" />
            {t('connectBank')}
          </button>
        )}
      </div>

      {connections.length === 0 && mode === null && (
        <p className="mt-2 text-sm text-muted-foreground">{psd2.available ? t('psd2.empty') : t('empty')}</p>
      )}

      {mode === 'choose' && (
        <div className="mt-3">
          <p className="text-xs font-semibold">{t('chooseProvider')}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {(
              [
                psd2.available && { key: 'psd2', icon: Building2, title: t('providers.psd2.title'), text: t('providers.psd2.text') },
                { key: 'fio', icon: Landmark, title: t('providers.fio.title'), text: t('providers.fio.text') },
                { key: 'paypal', icon: Wallet, title: t('providers.paypal.title'), text: t('providers.paypal.text') }
              ].filter(Boolean) as { key: 'psd2' | 'fio' | 'paypal'; icon: typeof Landmark; title: string; text: string }[]
            ).map(({ key, icon: Icon, title, text }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className="flex flex-col items-start gap-1 rounded-lg border border-border bg-background p-3 text-left hover:border-primary hover:bg-accent/40"
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  <Icon className="h-4 w-4 text-primary" />
                  {title}
                </span>
                <span className="text-xs text-muted-foreground">{text}</span>
              </button>
            ))}
          </div>
          {!psd2.available && <p className="mt-2 text-[11px] text-muted-foreground">{t('otherBanks')}</p>}
          <button type="button" onClick={() => setMode(null)} className="mt-2 rounded-full bg-muted px-4 py-1.5 text-xs font-semibold hover:bg-accent">
            {t('cancel')}
          </button>
        </div>
      )}

      {connections.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {connections.map((c) => {
            const expired = c.status === 'expired';
            const expiresAt = c.consentExpiresAt ? new Date(c.consentExpiresAt) : null;
            const expiringSoon = !expired && expiresAt !== null && expiresAt.getTime() - Date.now() < EXPIRY_WARNING_MS;
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {c.label || c.bankName || (c.provider === 'paypal' ? 'PayPal' : 'Fio banka')}
                    {c.label && c.bankName && <span className="ml-2 text-xs font-normal text-muted-foreground">{c.bankName}</span>}
                    {c.accountNumber && <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{c.accountNumber}</span>}
                    {!c.enabled && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t('paused')}</span>
                    )}
                    {expired && (
                      <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">{t('psd2.expired')}</span>
                    )}
                  </div>
                  <div className={cn('text-xs', c.lastError ? 'text-destructive' : 'text-muted-foreground')}>
                    {c.lastError
                      ? errorText(c.lastError)
                      : c.lastSyncedAt
                        ? t('lastSynced', { when: format.relativeTime(new Date(c.lastSyncedAt)) })
                        : t('neverSynced')}
                    {expiresAt && !expired && (
                      <span className={cn('ml-1', expiringSoon ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                        · {t('psd2.consentUntil', { date: format.dateTime(expiresAt, { dateStyle: 'medium' }) })}
                      </span>
                    )}
                  </div>
                </div>
                {canEdit && (
                <div className="flex items-center gap-1.5">
                  {(expired || expiringSoon) && (
                    <button type="button" disabled={pending || !c.bankName} onClick={() => renew(c)} className={primaryButton}>
                      {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      {t('psd2.renew')}
                    </button>
                  )}
                  {!expired && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => sync(c.id)}
                      className={expiringSoon ? cn(softButton, 'inline-flex items-center gap-1.5') : primaryButton}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', busyId === c.id && 'animate-spin')} />
                      {t('sync')}
                    </button>
                  )}
                  {!expired && (
                    <button type="button" disabled={pending} onClick={() => toggle(c)} className={softButton}>
                      {c.enabled ? t('pause') : t('resume')}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={t('disconnect')}
                    title={t('disconnect')}
                    onClick={() => remove(c)}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mode === 'psd2' && (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[7rem_1fr_12rem] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            goToBank('new', { bankName, country, psuType, label });
          }}
        >
          <label className="text-xs font-semibold">
            {t('psd2.country')}
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={cn(inputClass, 'mt-1.5')}>
              {psd2.countries.map((code) => (
                <option key={code} value={code}>
                  {countryName(code)}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs font-semibold">
            <InfoHint hint={t('psd2.bankHint')} label={t('psd2.bank')}>
              <label htmlFor="psd2-bank">{t('psd2.bank')}</label>
            </InfoHint>
            <select
              id="psd2-bank"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              required
              disabled={!banks}
              className={cn(inputClass, 'mt-1.5')}
            >
              <option value="">{banks ? t('psd2.pickBank') : banksError ? errorText(banksError) : t('psd2.loadingBanks')}</option>
              {banks?.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <label className="text-xs font-semibold">
            {t('label')}
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder={t('psd2.labelPlaceholder')}
              className={cn(inputClass, 'mt-1.5')}
            />
          </label>
          <fieldset className="flex flex-wrap items-center gap-3 text-xs sm:col-span-3">
            <legend className="sr-only">{t('psd2.accountType')}</legend>
            <span className="font-semibold">{t('psd2.accountType')}</span>
            {(['business', 'personal'] as const).map((type) => (
              <label key={type} className="inline-flex items-center gap-1.5">
                <input type="radio" name="psuType" checked={psuType === type} onChange={() => setPsuType(type)} className="accent-primary" />
                {t(type === 'business' ? 'psd2.business' : 'psd2.personal')}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <button
              type="submit"
              disabled={pending || !bankName}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {busyId === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {t('psd2.continue')}
            </button>
            <button type="button" onClick={() => setMode(null)} className="rounded-full bg-muted px-4 py-2 text-sm font-semibold hover:bg-accent">
              {t('cancel')}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground sm:col-span-3">{t('psd2.note')}</p>
        </form>
      )}

      {mode === 'paypal' && (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_12rem] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            connectPaypalAccount();
          }}
        >
          <div className="text-xs font-semibold">
            <InfoHint hint={t('paypal.credentialsHint')} label={t('paypal.clientId')}>
              <label htmlFor="paypal-id">{t('paypal.clientId')}</label>
            </InfoHint>
            <input
              id="paypal-id"
              value={paypalId}
              onChange={(e) => setPaypalId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              required
              className={cn(inputClass, 'mt-1.5 font-mono')}
            />
          </div>
          <label className="text-xs font-semibold">
            {t('paypal.secret')}
            <input
              value={paypalSecret}
              onChange={(e) => setPaypalSecret(e.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              required
              className={cn(inputClass, 'mt-1.5 font-mono')}
            />
          </label>
          <label className="text-xs font-semibold">
            {t('label')}
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="PayPal" className={cn(inputClass, 'mt-1.5')} />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs sm:col-span-3">
            <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} className="accent-primary" />
            <InfoHint hint={t('paypal.sandboxHint')} label={t('paypal.sandbox')}>
              <span>{t('paypal.sandbox')}</span>
            </InfoHint>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <button
              type="submit"
              disabled={pending || paypalId.trim().length < 10 || paypalSecret.trim().length < 10}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {busyId === 'new' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('connect')}
            </button>
            <button type="button" onClick={() => setMode(null)} className="rounded-full bg-muted px-4 py-2 text-sm font-semibold hover:bg-accent">
              {t('cancel')}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground sm:col-span-3">{t('paypal.note')}</p>
        </form>
      )}

      {mode === 'fio' && (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <div className="text-xs font-semibold">
            <InfoHint hint={t('tokenHint')} label={t('token')}>
              <label htmlFor="fio-token">{t('token')}</label>
            </InfoHint>
            <input
              id="fio-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              required
              placeholder={t('tokenPlaceholder')}
              className={cn(inputClass, 'mt-1.5 font-mono')}
            />
          </div>
          <label className="text-xs font-semibold">
            {t('label')}
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={t('labelPlaceholder')} className={cn(inputClass, 'mt-1.5')} />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || token.trim().length !== 64}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {busyId === 'new' && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('connect')}
            </button>
            <button type="button" onClick={() => setMode(null)} className="rounded-full bg-muted px-4 py-2 text-sm font-semibold hover:bg-accent">
              {t('cancel')}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground sm:col-span-3">{psd2.available ? t('psd2.otherBanksAvailable') : t('otherBanks')}</p>
        </form>
      )}
    </section>
  );
}
