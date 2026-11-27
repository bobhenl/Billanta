'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/toaster';
import { useVault } from '@/components/vault/vault-provider';
import { useRouter } from '@/i18n/navigation';
import { updateVaultSettings } from '@/lib/vault/actions';
import { keepOnDevice, keptOnDevice, subscribeVaultKeys } from '@/lib/vault/session';
import { VAULT_EMAIL_MODES, type EnabledVault, type VaultEmailMode } from '@/lib/vault/types';

/** Owner/admin: what sending an encrypted document does about the PDF. */
export function VaultEmailSettings({ vault }: { vault: EnabledVault }) {
  const t = useTranslations('vault.emailSettings');
  const router = useRouter();
  const [mode, setMode] = useState<VaultEmailMode>(vault.emailMode ?? 'link_now');

  const save = async (input: { emailMode?: VaultEmailMode; autoSendPdf?: boolean }) => {
    const r = await updateVaultSettings(input);
    toast({ text: r.ok ? t('saved') : t('failed'), tone: r.ok ? 'ok' : 'err' });
    if (r.ok) router.refresh();
    return r.ok;
  };

  return (
    <section id="emails" className="scroll-mt-20 space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-bold">{t('title')}</h2>
      <p className="text-xs text-muted-foreground">{t('lead')}</p>
      <fieldset className="space-y-2">
        <legend className="sr-only">{t('title')}</legend>
        {VAULT_EMAIL_MODES.map((m) => (
          <label key={m} className="flex items-start gap-2.5 text-sm">
            <input
              type="radio"
              name="vault-email-mode"
              value={m}
              checked={mode === m}
              onChange={async () => {
                const before = mode;
                setMode(m);
                if (!(await save({ emailMode: m }))) setMode(before);
              }}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              <span className="font-semibold">{t(`mode.${m}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`modeHint.${m}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode !== 'link_only' && (
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            defaultChecked={vault.autoSendPdf ?? false}
            onChange={(e) => void save({ autoSendPdf: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span>
            <span className="font-semibold">{t('autoSend')}</span>
            <span className="block text-xs text-muted-foreground">{t('autoSendHint')}</span>
          </span>
        </label>
      )}
      {mode !== 'link_only' && <p className="text-xs text-muted-foreground">{t('passThrough')}</p>}
    </section>
  );
}

/** Every member, per device: keep the unlocked key here without the 12-hour expiry. */
export function VaultDeviceKeep() {
  const t = useTranslations('vault.device');
  const { key, tenantId, requestUnlock } = useVault();
  const [kept, setKept] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const read = () => void keptOnDevice(tenantId).then(setKept);
    read();
    return subscribeVaultKeys(read);
  }, [tenantId]);

  const toggle = async (on: boolean) => {
    if (!tenantId) return;
    if (on && !key && !(await requestUnlock())) return;
    const ok = await keepOnDevice(tenantId, on);
    toast({ text: ok ? (on ? t('on') : t('off')) : t('failed'), tone: ok ? 'ok' : 'err' });
  };

  return (
    <section id="device" className="scroll-mt-20 space-y-3 rounded-xl border border-border bg-card p-4">
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" checked={kept} onChange={(e) => void toggle(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
        <span>
          <span className="font-semibold">{t('title')}</span>
          <span className="block text-xs text-muted-foreground">{t('hint')}</span>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">{t('risk')}</p>
    </section>
  );
}
