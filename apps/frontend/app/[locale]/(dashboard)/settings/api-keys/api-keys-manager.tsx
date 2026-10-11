'use client';

import { type FormEvent, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, Loader2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { cn } from '@/lib/utils';
import { createApiKey, revokeApiKey } from './actions';

export interface ApiKeyListItem {
  id: string;
  name: string;
  /** e.g. "sk_live_ab12" — first 12 chars of the full key, never the full key itself. */
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** `["read"]` = read-only key; empty or `["write"]` = full access. */
  scopes?: string[];
}

function isReadOnlyKey(key: ApiKeyListItem): boolean {
  const scopes = key.scopes ?? [];
  return scopes.length > 0 && !scopes.some((scope) => scope === 'write' || scope.endsWith(':write'));
}

/**
 * Settings → API klíče: list, generate (the full key is shown exactly once)
 * and revoke, against `apps/backend/src/api-keys/`.
 */
export function ApiKeysManager({ initialKeys, apiBase, readOnly }: { initialKeys: ApiKeyListItem[]; apiBase: string; readOnly: boolean }) {
  const t = useTranslations('settings.apiKeys');
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const [keys, setKeys] = useState<ApiKeyListItem[]>(initialKeys);
  const [name, setName] = useState('');
  const [readOnlyKey, setReadOnlyKey] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<'key' | 'curl' | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGenerating(true);
    const result = await createApiKey(name, readOnlyKey);
    setGenerating(false);
    if (!result.ok) {
      toast({ text: t('generateFailed'), tone: 'err' });
      return;
    }
    const { key, ...row } = result.data;
    setKeys((current) => [row, ...current]);
    setRevealedKey(key);
    setName('');
    setReadOnlyKey(false);
    setFormOpen(false);
  }

  async function handleRevoke(id: string) {
    if (!window.confirm(t('confirmRevoke'))) return;
    setRevokingId(id);
    const result = await revokeApiKey(id);
    setRevokingId(null);
    if (!result.ok) {
      toast({ text: t('revokeFailed'), tone: 'err' });
      return;
    }
    setKeys((current) => current.map((key) => (key.id === id ? { ...key, revokedAt: result.data.revokedAt } : key)));
    toast(t('revoked'));
  }

  const curl = `curl ${apiBase}/api/v1/invoices \\\n  -H "Authorization: Bearer ${revealedKey ?? 'sk_live_…'}"`;

  async function copy(text: string, what: 'key' | 'curl') {
    await navigator.clipboard.writeText(text);
    toast(t('reveal.copied'));
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  const revokedCount = keys.filter((k) => k.revokedAt).length;
  const visible = showRevoked ? keys : keys.filter((k) => !k.revokedAt);

  return (
    <div className="mt-6 space-y-5">
      {revealedKey && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-semibold">{t('reveal.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('reveal.warning')}</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm">{revealedKey}</code>
            <button type="button" onClick={() => copy(revealedKey, 'key')} className={buttonClass.secondary}>
              {copied === 'key' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === 'key' ? t('reveal.copied') : t('reveal.copy')}
            </button>
          </div>
          <button type="button" onClick={() => setRevealedKey(null)} className={cn(buttonClass.primary, 'mt-3')}>
            {t('reveal.done')}
          </button>
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <InfoHint hint={t('listHint')} rowClassName="font-semibold">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <KeyRound className="h-4 w-4 text-primary" />
              {t('listTitle')}
            </h2>
          </InfoHint>
          {revokedCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} className="accent-primary" />
              {t('showRevoked', { count: revokedCount })}
            </label>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t('columns.name')}</th>
                <th className="px-4 py-2.5 font-medium">{t('columns.prefix')}</th>
                <th className="px-4 py-2.5 font-medium">{t('columns.lastUsed')}</th>
                <th className="px-4 py-2.5 font-medium">{t('columns.created')}</th>
                <th className="px-4 py-2.5 font-medium">{t('columns.status')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              )}
              {visible.map((key) => {
                const revoked = key.revokedAt !== null;
                return (
                  <tr key={key.id} className={cn('border-b border-border last:border-b-0', revoked && 'opacity-60')}>
                    <td className="px-4 py-3 font-medium">{key.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{key.keyPrefix}••••</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{key.lastUsedAt ? dateFormatter.format(new Date(key.lastUsedAt)) : t('neverUsed')}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{dateFormatter.format(new Date(key.createdAt))}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', revoked ? 'bg-muted text-muted-foreground' : 'bg-success/15 text-success')}>
                        {revoked ? t('statusRevoked') : t('statusActive')}
                      </span>
                      {isReadOnlyKey(key) && (
                        <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{t('readOnlyBadge')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!revoked && !readOnly && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(key.id)}
                          disabled={revokingId === key.id}
                          className="text-xs font-semibold text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {revokingId === key.id ? t('revoking') : t('revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <div className="border-t border-border p-4">
            {formOpen ? (
              <form onSubmit={handleGenerate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <InfoHint hint={t('generate.nameHint')} label={t('generate.nameLabel')}>
                    <label htmlFor="apiKeyName" className="text-sm font-medium">
                      {t('generate.nameLabel')}
                    </label>
                  </InfoHint>
                  <input
                    id="apiKeyName"
                    type="text"
                    required
                    maxLength={255}
                    autoFocus
                    placeholder={t('generate.namePlaceholder')}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={cn(inputClass, 'mt-1.5')}
                  />
                  <InfoHint hint={t('generate.readOnlyHint')} label={t('generate.readOnly')} rowClassName="mt-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={readOnlyKey} onChange={(e) => setReadOnlyKey(e.target.checked)} className="accent-primary" />
                      {t('generate.readOnly')}
                    </label>
                  </InfoHint>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={generating || name.trim().length === 0} className={buttonClass.primary}>
                    {generating && <Loader2 className="h-4 w-4 animate-spin" />}
                    {generating ? t('generate.generating') : t('generate.submit')}
                  </button>
                  <button type="button" onClick={() => setFormOpen(false)} disabled={generating} className={buttonClass.ghost}>
                    {t('generate.cancel')}
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => setFormOpen(true)} className={buttonClass.primary}>
                <Plus className="h-4 w-4" />
                {t('generate.button')}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <InfoHint hint={t('usage.hint')} rowClassName="font-semibold">
          <h2 className="text-sm font-bold">{t('usage.title')}</h2>
        </InfoHint>
        <p className="mt-1 text-sm text-muted-foreground">{t('usage.description')}</p>
        <div className="relative mt-3">
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">{curl}</pre>
          <button type="button" onClick={() => copy(curl, 'curl')} aria-label={t('reveal.copy')} className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-primary">
            {copied === 'curl' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <a href={`${apiBase}/api/docs`} target="_blank" rel="noreferrer" className={cn(buttonClass.ghost, 'mt-2 -ml-3')}>
          <ExternalLink className="h-4 w-4" />
          {t('usage.docs')}
        </a>
      </section>
    </div>
  );
}
