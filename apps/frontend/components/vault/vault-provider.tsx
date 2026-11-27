'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { wrapWithPassword, type VaultKey } from '@faktur/cz-compliance';
import { Modal } from '@/components/modal';
import { PasswordInput } from '@/components/password-input';
import { useStepUp } from '@/components/step-up';
import { Link } from '@/i18n/navigation';
import { addVaultWrap } from '@/lib/vault/actions';
import { passkeyPrfSupported, unlockWithPasskey } from '@/lib/vault/passkey';
import { cachedVaultKey, forgetVaultKey, loadVaultKey, rememberVaultKey, subscribeVaultKeys } from '@/lib/vault/session';
import type { EnabledVault, VaultStatus } from '@/lib/vault/types';
import { unlockErrorKey, unlockVault } from '@/lib/vault/unlock';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

interface VaultContextValue {
  tenantId: string | null;
  vault: EnabledVault | null;
  key: VaultKey | null;
  /** Opens the unlock dialog; resolves with the key, or null when the member closed it. */
  requestUnlock: () => Promise<VaultKey | null>;
  lock: () => void;
}

const VaultContext = createContext<VaultContextValue>({
  tenantId: null,
  vault: null,
  key: null,
  requestUnlock: async () => null,
  lock: () => {}
});

export const useVault = () => useContext(VaultContext);

/**
 * "Důvěrný režim" for the whole dashboard: the company's vault status (from
 * the layout) and the unlocked key, if this browser has it. One unlock
 * dialog serves every component that needs the key.
 */
export function VaultProvider({ tenantId, status, children }: { tenantId: string | null; status: VaultStatus | null; children: React.ReactNode }) {
  const vault = status?.enabled ? status : null;
  const [key, setKey] = useState<VaultKey | null>(() => (tenantId ? cachedVaultKey(tenantId) : null));
  const [open, setOpen] = useState(false);
  const waiting = useRef<((key: VaultKey | null) => void)[]>([]);

  useEffect(() => {
    if (!tenantId || !vault) return setKey(null);
    let live = true;
    const refresh = () => void loadVaultKey(tenantId).then((k) => live && setKey(k));
    refresh();
    const unsubscribe = subscribeVaultKeys(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [tenantId, vault]);

  const settle = useCallback((result: VaultKey | null) => {
    setOpen(false);
    for (const resolve of waiting.current.splice(0)) resolve(result);
  }, []);

  const requestUnlock = useCallback(() => {
    if (!vault || !tenantId) return Promise.resolve(null);
    if (key) return Promise.resolve(key);
    setOpen(true);
    return new Promise<VaultKey | null>((resolve) => waiting.current.push(resolve));
  }, [vault, tenantId, key]);

  const lock = useCallback(() => {
    if (tenantId) void forgetVaultKey(tenantId);
    setKey(null);
  }, [tenantId]);

  return (
    <VaultContext.Provider value={{ tenantId, vault, key, requestUnlock, lock }}>
      {children}
      {vault && tenantId && (
        <UnlockDialog
          open={open}
          vault={vault}
          onClose={() => settle(null)}
          onUnlocked={async (k) => settle(await rememberVaultKey(tenantId, k))}
        />
      )}
    </VaultContext.Provider>
  );
}

type Method = 'password' | 'recovery' | 'passkey';

/** Password, recovery code or passkey. The recovery code also lets a member set their own vault password. */
export function UnlockDialog({ open, vault, onClose, onUnlocked }: { open: boolean; vault: EnabledVault; onClose: () => void; onUnlocked: (key: VaultKey) => void | Promise<void> }) {
  const t = useTranslations('vault.unlock');
  const tVault = useTranslations('vault');
  const hasPassword = vault.wraps.some((w) => w.kind === 'password');
  const hasPasskey = vault.wraps.some((w) => w.kind === 'passkey');
  const [prf, setPrf] = useState(false);
  const [method, setMethod] = useState<Method>(hasPassword ? 'password' : 'recovery');
  const [secret, setSecret] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Replacing an existing vault password needs a step-up (backend VaultService.addWrap).
  const { withStepUp, stepUpDialog } = useStepUp();

  useEffect(() => {
    void passkeyPrfSupported().then(setPrf);
  }, []);
  useEffect(() => {
    if (!open) {
      setSecret('');
      setNewPassword('');
      setError(null);
    }
  }, [open]);

  const needsNewPassword = method === 'recovery' && !hasPassword;

  const submit = async () => {
    setError(null);
    if (needsNewPassword || (method === 'recovery' && newPassword)) {
      if (newPassword.length < 10) return setError(t('errors.passwordShort'));
    }
    setBusy(true);
    try {
      if (method === 'passkey') {
        const key = await unlockWithPasskey(vault.wraps);
        if (!key) return setError(t('errors.passkeyFailed'));
        await onUnlocked(key);
        return;
      }
      const reWrap = method === 'recovery' && Boolean(newPassword);
      const key = await unlockVault(vault, method, secret, reWrap);
      if (reWrap) {
        const wrap = await wrapWithPassword(key, newPassword);
        const saved = await withStepUp(() => addVaultWrap(wrap));
        if (!saved?.ok) return setError(t('errors.saveFailed'));
      }
      await onUnlocked(key);
    } catch (e) {
      setError(method === 'passkey' ? t('errors.passkeyFailed') : t(unlockErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const methods: Method[] = [...(hasPassword ? (['password'] as const) : []), 'recovery', ...(hasPasskey && prf ? (['passkey'] as const) : [])];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <LockKeyhole className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('title')}
        </span>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonClass.secondary}>
            {t('cancel')}
          </button>
          <button type="button" onClick={submit} disabled={busy || (method !== 'passkey' && !secret.trim())} className={buttonClass.primary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
            {method === 'passkey' ? t('passkeyButton') : t('submit')}
          </button>
        </>
      }
    >
      {stepUpDialog}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        <p className="text-muted-foreground">{t('lead')}</p>
        {methods.length > 1 && (
          <div role="tablist" className="flex flex-wrap gap-1.5">
            {methods.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={method === m}
                onClick={() => {
                  setMethod(m);
                  setSecret('');
                  setError(null);
                }}
                className={cn('rounded-full border px-3 py-1 text-xs font-semibold', method === m ? 'border-primary bg-accent text-primary' : 'border-border text-muted-foreground')}
              >
                {t(`methods.${m}`)}
              </button>
            ))}
          </div>
        )}
        {method === 'password' && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold">{t('password')}</span>
            <PasswordInput value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" autoFocus className={inputClass} />
          </label>
        )}
        {method === 'recovery' && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-semibold">{t('recovery')}</span>
              <input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                className={cn(inputClass, 'font-mono uppercase')}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold">{needsNewPassword ? t('newPasswordRequired') : t('newPasswordOptional')}</span>
              <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
            </label>
          </>
        )}
        {method === 'passkey' && <p className="text-muted-foreground">{t('passkeyLead')}</p>}
        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('settingsHint')}{' '}
          <Link href="/settings/confidential" onClick={onClose} className="font-semibold text-primary hover:underline">
            {tVault('settingsLink')}
          </Link>
        </p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
