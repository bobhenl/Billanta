'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Download, Fingerprint, KeyRound, Loader2, Lock, LockKeyhole, LockOpen, ShieldAlert, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  VAULT_CATEGORIES,
  generateDataKey,
  generateRecoveryCode,
  keyCheck,
  recoveryCodeSecret,
  wrapWithPassword,
  wrapWithRecoveryCode,
  type VaultCategory,
  type VaultKey
} from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { PasswordInput } from '@/components/password-input';
import { toast } from '@/components/toaster';
import { useStepUp } from '@/components/step-up';
import { SealAttachmentsButton } from '@/components/vault/seal-attachments-button';
import { SealContactsButton } from '@/components/vault/seal-contacts-button';
import { SealButton } from '@/components/vault/seal-button';
import { VaultIntegrity } from '@/components/vault/vault-integrity';
import { VaultDeviceKeep, VaultEmailSettings } from '@/components/vault/vault-preferences';
import { useVault } from '@/components/vault/vault-provider';
import { Link, useRouter } from '@/i18n/navigation';
import { SITE_NAME } from '@/lib/site';
import { addVaultWrap, enableVault, removeVaultWrap, replaceRecoveryWrap, updateVaultCategories, updateVaultSettings } from '@/lib/vault/actions';
import { createPasskeyWrap, passkeyPrfSupported } from '@/lib/vault/passkey';
import { rememberVaultKey } from '@/lib/vault/session';
import type { EnabledVault, VaultStatus } from '@/lib/vault/types';
import { unlockErrorKey, unlockVault } from '@/lib/vault/unlock';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const MIN_PASSWORD = 10;

export function ConfidentialManager({ status, role, user }: { status: VaultStatus; role: string | null; user: { id: string; name: string } }) {
  if (status.enabled) return <EnabledView vault={status} role={role} user={user} />;
  return status.planAllowed === false ? <PlanRequired /> : <EnableWizard owner={role === 'owner'} />;
}

/** Free/Start: what the mode does and what it costs in features, with an upgrade link instead of the switch. */
function PlanRequired() {
  const t = useTranslations('vault.enable');
  const tPlan = useTranslations('vault.plan');
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <LockKeyhole className="h-4 w-4 text-primary" aria-hidden />
          {t('introTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t('notE2eeNote')}</p>
      </div>
      <Banner tone="info" title={tPlan('title')}>
        <p>{tPlan('body')}</p>
        <Link href="/billing" className={cn(buttonClass.primary, 'mt-3 inline-flex')}>
          {tPlan('upgrade')}
        </Link>
      </Banner>
      <div>
        <h3 className="mb-2 text-sm font-bold">{t('chooseTitle')}</h3>
        <CategoryList selected={[]} />
      </div>
    </div>
  );
}

/** The categories with what each one switches off; planned ones are visible but can't be picked yet. */
function CategoryList({ selected, onToggle }: { selected: VaultCategory[]; onToggle?: (id: VaultCategory) => void }) {
  const t = useTranslations('vault.categories');
  return (
    <ul className="space-y-2">
      {VAULT_CATEGORIES.map((category) => {
        const on = selected.includes(category.id);
        const loses = t.raw(`${category.id}.loses`) as string[];
        // What keeps working, only differently (made in the browser, sent on an explicit click).
        const changes = t.has(`${category.id}.changes`) ? (t.raw(`${category.id}.changes`) as string[]) : [];
        const how = t.has(`${category.id}.how`) ? (t.raw(`${category.id}.how`) as string[]) : [];
        return (
          <li key={category.id} className={cn('rounded-xl border p-3', on ? 'border-primary/40 bg-accent/30' : 'border-border bg-card', !category.available && 'opacity-80')}>
            <label className={cn('flex items-start gap-2.5', category.available && onToggle ? 'cursor-pointer' : 'cursor-default')}>
              <input
                type="checkbox"
                checked={on}
                disabled={!category.available || !onToggle}
                onChange={() => onToggle?.(category.id)}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  {t(`${category.id}.title`)}
                  {category.default && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t('recommended')}</span>}
                  {!category.available && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{t('planned')}</span>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t(`${category.id}.description`)}</span>
                {how.length > 0 && (
                  <>
                    <span className="mt-2 block text-xs font-semibold">{t('howTitle')}</span>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                      {how.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </>
                )}
                <span className="mt-2 block text-xs font-semibold">{t('losesTitle')}</span>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {loses.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {changes.length > 0 && (
                  <>
                    <span className="mt-2 block text-xs font-semibold">{t('changesTitle')}</span>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                      {changes.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </>
                )}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Owner only: choose categories, accept the warnings, set a vault password, write down the recovery code. */
function EnableWizard({ owner }: { owner: boolean }) {
  const t = useTranslations('vault.enable');
  const router = useRouter();
  const { tenantId } = useVault();
  const [step, setStep] = useState<'choose' | 'password' | 'code'>('choose');
  const [categories, setCategories] = useState<VaultCategory[]>(VAULT_CATEGORIES.filter((c) => c.default).map((c) => c.id));
  const [acks, setAcks] = useState({ lost: false, archive: false, features: false });
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [material, setMaterial] = useState<{ key: VaultKey; code: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!owner) {
    return (
      <Banner tone="info" className="mt-4" title={t('offTitle')}>
        {t('ownerOnly')}
      </Banner>
    );
  }

  const toPassword = () => {
    setError(null);
    if (!acks.lost || !acks.archive || !acks.features) return setError(t('errors.acks'));
    setStep('password');
  };

  const toCode = async () => {
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(t('errors.passwordShort', { n: MIN_PASSWORD }));
    if (password !== again) return setError(t('errors.passwordMismatch'));
    setMaterial({ key: await generateDataKey(), code: generateRecoveryCode() });
    setStep('code');
  };

  const sameCode = (() => {
    if (!material) return false;
    try {
      const a = recoveryCodeSecret(typed);
      const b = recoveryCodeSecret(material.code);
      return a.length === b.length && a.every((x, i) => x === b[i]);
    } catch {
      return false;
    }
  })();

  const enable = async () => {
    if (!material || !sameCode) return;
    setBusy(true);
    setError(null);
    try {
      const result = await enableVault({
        keyCheck: await keyCheck(material.key),
        password: await wrapWithPassword(material.key, password),
        recovery: await wrapWithRecoveryCode(material.key, material.code),
        categories
      });
      if (!result.ok) return setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.failed'));
      // The owner just made the key, so this browser starts unlocked.
      if (tenantId) await rememberVaultKey(tenantId, material.key);
      toast({ text: t('done'), tone: 'ok' });
      router.refresh();
    } catch {
      setError(t('errors.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <LockKeyhole className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('introTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t('notE2eeNote')}</p>
      </section>

      {step === 'choose' && (
        <>
          <section>
            <h3 className="text-sm font-bold">{t('chooseTitle')}</h3>
            <p className="mb-2 text-xs text-muted-foreground">{t('chooseLead')}</p>
            <CategoryList selected={categories} onToggle={(id) => setCategories((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]))} />
          </section>
          <section className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
              {t('warningsTitle')}
            </h3>
            {(['lost', 'archive', 'features'] as const).map((k) => (
              <label key={k} className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={acks[k]} onChange={(e) => setAcks((a) => ({ ...a, [k]: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-primary" />
                <span>{t(`warnings.${k}`)}</span>
              </label>
            ))}
          </section>
          {error && <Banner tone="err">{error}</Banner>}
          <button type="button" onClick={toPassword} disabled={!categories.length} className={buttonClass.primary}>
            {t('next')}
          </button>
        </>
      )}

      {step === 'password' && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-bold">{t('passwordTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('passwordLead', { n: MIN_PASSWORD })}</p>
          <label className="block space-y-1">
            <span className="text-xs font-semibold">{t('password')}</span>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold">{t('passwordAgain')}</span>
            <PasswordInput value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" className={inputClass} />
          </label>
          {error && <Banner tone="err">{error}</Banner>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep('choose')} className={buttonClass.secondary}>
              {t('back')}
            </button>
            <button type="button" onClick={() => void toCode()} className={buttonClass.primary}>
              {t('next')}
            </button>
          </div>
        </section>
      )}

      {step === 'code' && material && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-bold">{t('codeTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('codeLead')}</p>
          <p className="select-all break-all rounded-lg bg-secondary px-3 py-3 text-center font-mono text-base font-bold tracking-wider">{material.code}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void navigator.clipboard.writeText(material.code).then(() => toast({ text: t('copied'), tone: 'ok' }))} className={buttonClass.secondary}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              {t('copy')}
            </button>
            <button type="button" onClick={() => downloadText(`${SITE_NAME}-recovery-code.txt`, `${t('codeFileHeader', { site: SITE_NAME })}\n\n${material.code}\n`)} className={buttonClass.secondary}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('download')}
            </button>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-semibold">{t('retype')}</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={cn(inputClass, 'font-mono uppercase')} />
          </label>
          {typed && !sameCode && <p className="text-xs text-muted-foreground">{t('retypeMismatch')}</p>}
          {error && <Banner tone="err">{error}</Banner>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep('password')} disabled={busy} className={buttonClass.secondary}>
              {t('back')}
            </button>
            <button type="button" onClick={() => void enable()} disabled={!sameCode || busy} className={buttonClass.primary}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
              {t('submit')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

/** Asks for the vault password or the recovery code to get a key that can be wrapped again. */
function Reauth({ vault, onKey, label }: { vault: EnabledVault; onKey: (key: VaultKey) => Promise<void>; label: string }) {
  const t = useTranslations('vault.unlock');
  const hasPassword = vault.wraps.some((w) => w.kind === 'password');
  const [method, setMethod] = useState<'password' | 'recovery'>(hasPassword ? 'password' : 'recovery');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onKey(await unlockVault(vault, method, secret, true));
      setSecret('');
    } catch (e) {
      setError(t(unlockErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {hasPassword && (
          <button type="button" onClick={() => setMethod('password')} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', method === 'password' ? 'border-primary bg-accent text-primary' : 'border-border text-muted-foreground')}>
            {t('methods.password')}
          </button>
        )}
        <button type="button" onClick={() => setMethod('recovery')} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', method === 'recovery' ? 'border-primary bg-accent text-primary' : 'border-border text-muted-foreground')}>
          {t('methods.recovery')}
        </button>
      </div>
      {method === 'password' ? (
        <PasswordInput value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t('currentPassword')} autoComplete="off" className={inputClass} />
      ) : (
        <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t('recovery')} autoComplete="off" spellCheck={false} className={cn(inputClass, 'font-mono uppercase')} />
      )}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
      <button type="button" onClick={() => void go()} disabled={busy || !secret.trim()} className={buttonClass.primary}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {label}
      </button>
    </div>
  );
}

function EnabledView({ vault, role, user }: { vault: EnabledVault; role: string | null; user: { id: string; name: string } }) {
  const t = useTranslations('vault.settings');
  const tPlan = useTranslations('vault.plan');
  const router = useRouter();
  const { key, tenantId, requestUnlock, lock } = useVault();
  const manager = role === 'owner' || role === 'admin';
  const [prf, setPrf] = useState(false);
  const [panel, setPanel] = useState<null | 'password' | 'passkey' | 'recovery'>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passkeyLabel, setPasskeyLabel] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Removing or replacing a way in, and switching encryption of new documents off, need a step-up.
  const { withStepUp, stepUpDialog } = useStepUp();
  const passkeys = vault.wraps.filter((w) => w.kind === 'passkey');
  const hasPassword = vault.wraps.some((w) => w.kind === 'password');

  useEffect(() => {
    void passkeyPrfSupported().then(setPrf);
  }, []);

  const report = (ok: boolean, text: string) => {
    toast({ text: ok ? text : t('failed'), tone: ok ? 'ok' : 'err' });
    if (ok) {
      setPanel(null);
      router.refresh();
    }
  };

  const keepUnlocked = async (k: VaultKey) => {
    if (tenantId) await rememberVaultKey(tenantId, k);
  };

  return (
    <div className="mt-4 space-y-4">
      {stepUpDialog}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        {key ? <LockOpen className="h-5 w-5 text-success" aria-hidden="true" /> : <LockKeyhole className="h-5 w-5 text-primary" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{t('onTitle')}</p>
          <p className="text-xs text-muted-foreground">{key ? t('unlockedHere') : t('lockedHere')}</p>
        </div>
        {key ? (
          <button type="button" onClick={lock} className={buttonClass.secondary}>
            <Lock className="h-4 w-4" aria-hidden="true" />
            {t('lock')}
          </button>
        ) : (
          <button type="button" onClick={() => void requestUnlock()} className={buttonClass.primary}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {t('unlock')}
          </button>
        )}
      </section>

      <Banner tone="warn" title={t('archiveTitle')}>
        {t('archiveBody')}{' '}
        <Link href="/settings/exports" className="font-semibold underline underline-offset-2">
          {t('archiveLink')}
        </Link>
      </Banner>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold">{t('sealTitle')}</h2>
        <p className="text-xs text-muted-foreground">{t('sealLead')}</p>
        {vault.planAllowed === false ? (
          <Banner tone="info" title={tPlan('downgradedTitle')}>
            <p>{tPlan('downgradedBody')}</p>
            <Link href="/billing" className="mt-1 inline-block font-semibold underline underline-offset-2">
              {tPlan('upgrade')}
            </Link>
          </Banner>
        ) : (
          <div className="flex flex-wrap gap-2">
            <SealButton scope={{ kind: 'company' }} />
            <SealAttachmentsButton />
            <SealContactsButton />
          </div>
        )}
        {/* Below Plus the default can still be switched off, never on. */}
        {manager && (vault.planAllowed !== false || vault.sealNew) && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              defaultChecked={vault.sealNew}
              onChange={async (e) => {
                const box = e.currentTarget;
                const next = box.checked;
                const r = await withStepUp(() => updateVaultSettings(next));
                if (!r) return void (box.checked = !next);
                report(r.ok, t('saved'));
              }}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              <span className="font-semibold">{t('sealNew')}</span>
              <span className="block text-xs text-muted-foreground">{t('sealNewHint')}</span>
            </span>
          </label>
        )}
      </section>

      {manager && <VaultEmailSettings vault={vault} />}
      <VaultDeviceKeep />

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold">{t('methodsTitle')}</h2>
        <ul className="divide-y divide-border text-sm">
          <li className="flex flex-wrap items-center gap-2 py-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1">{hasPassword ? t('passwordSet') : t('passwordMissing')}</span>
            <button type="button" onClick={() => setPanel(panel === 'password' ? null : 'password')} className={buttonClass.ghost}>
              {hasPassword ? t('changePassword') : t('setPassword')}
            </button>
          </li>
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
              <Fingerprint className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">
                {p.label || t('passkeyUnnamed')}
                {p.stepUp !== undefined && (
                  <span className="block text-xs text-muted-foreground">{p.stepUp ? t('passkeyStepUp') : t('passkeyUnlockOnly')}</span>
                )}
              </span>
              <button
                type="button"
                onClick={async () => {
                  const r = await withStepUp(() => removeVaultWrap(p.id));
                  if (r) report(r.ok, t('passkeyRemoved'));
                }}
                className={buttonClass.ghost}
                aria-label={t('removePasskey')}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
          {prf && (
            <li className="flex flex-wrap items-center gap-2 py-2">
              <Fingerprint className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 text-muted-foreground">{t('passkeyLead')}</span>
              <button type="button" onClick={() => setPanel(panel === 'passkey' ? null : 'passkey')} className={buttonClass.ghost}>
                {t('addPasskey')}
              </button>
            </li>
          )}
        </ul>

        {panel === 'password' && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold">{t('newPassword', { n: MIN_PASSWORD })}</span>
              <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className={inputClass} />
            </label>
            <Reauth
              vault={vault}
              label={t('savePassword')}
              onKey={async (k) => {
                if (newPassword.length < MIN_PASSWORD) return void toast({ text: t('passwordShort', { n: MIN_PASSWORD }), tone: 'err' });
                const wrap = await wrapWithPassword(k, newPassword);
                const r = await withStepUp(() => addVaultWrap(wrap));
                if (!r) return;
                if (r.ok) await keepUnlocked(k);
                setNewPassword('');
                report(r.ok, t('passwordSaved'));
              }}
            />
          </div>
        )}

        {panel === 'passkey' && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{t('passkeyHint')}</p>
            <input value={passkeyLabel} onChange={(e) => setPasskeyLabel(e.target.value)} maxLength={60} placeholder={t('passkeyLabel')} className={inputClass} />
            <Reauth
              vault={vault}
              label={t('addPasskey')}
              onKey={async (k) => {
                let wrap: Awaited<ReturnType<typeof createPasskeyWrap>> = null;
                try {
                  wrap = await createPasskeyWrap(k, user, SITE_NAME);
                } catch {
                  wrap = null;
                }
                if (!wrap) return void toast({ text: t('passkeyNoPrf'), tone: 'err' });
                const label = passkeyLabel.trim() || null;
                // One that can confirm changes is itself a way past them: the backend asks for a step-up first.
                const r = await withStepUp(() => addVaultWrap({ ...wrap, label }));
                if (!r) return;
                setPasskeyLabel('');
                report(r.ok, t('passkeyAdded'));
              }}
            />
          </div>
        )}
      </section>

      {manager && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold">{t('recoveryTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('recoveryLead')}</p>
          {newCode ? (
            <>
              <p className="select-all break-all rounded-lg bg-secondary px-3 py-3 text-center font-mono text-base font-bold tracking-wider">{newCode}</p>
              <p className="text-xs text-muted-foreground">{t('recoveryShownOnce')}</p>
              <button type="button" onClick={() => setNewCode(null)} className={buttonClass.secondary}>
                <Check className="h-4 w-4" aria-hidden="true" />
                {t('recoveryWritten')}
              </button>
            </>
          ) : panel === 'recovery' ? (
            <Reauth
              vault={vault}
              label={t('recoveryNew')}
              onKey={async (k) => {
                setBusy(true);
                const code = generateRecoveryCode();
                const wrap = await wrapWithRecoveryCode(k, code);
                const r = await withStepUp(() => replaceRecoveryWrap(wrap));
                setBusy(false);
                if (!r) return;
                if (r.ok) setNewCode(code);
                report(r.ok, t('recoveryReplaced'));
              }}
            />
          ) : (
            <button type="button" onClick={() => setPanel('recovery')} disabled={busy} className={buttonClass.secondary}>
              {t('recoveryNew')}
            </button>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-bold">{t('categoriesTitle')}</h2>
        <p className="mb-2 text-xs text-muted-foreground">{t('categoriesLead')}</p>
        <CategoryList
          selected={vault.categories}
          // Managers on Plus can add a category later; dropping one only stops encrypting new data.
          onToggle={
            manager && vault.planAllowed !== false
              ? async (id) => {
                  const next = vault.categories.includes(id) ? vault.categories.filter((c) => c !== id) : [...vault.categories, id];
                  if (!next.length) return void toast({ text: t('categoriesMin'), tone: 'err' });
                  if (!next.includes(id) && !window.confirm(t('categoryOffConfirm'))) return;
                  // Dropping a category needs a step-up; adding one does not.
                  const r = await withStepUp(() => updateVaultCategories(next));
                  if (r) report(r.ok, t('saved'));
                }
              : undefined
          }
        />
      </section>

      <VaultIntegrity />
    </div>
  );
}
