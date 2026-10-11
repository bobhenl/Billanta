'use client';

import { type FormEvent, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface ApiKeyListItem {
  id: string;
  name: string;
  /** e.g. "sk_live_ab12" — first 12 chars of the full key, never the full key itself. */
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * Stand-in for a server-generated key. A real implementation must NEVER
 * generate or hash this client-side — see `POST /api/v1/api-keys`
 * (`apps/backend/src/api-keys/api-keys.service.ts::create`), which mints a
 * cryptographically random key, stores only its SHA-256 hash + a 12-char
 * prefix, and returns the full plaintext key exactly once. This exists
 * purely so the UI has something plausible to render before an
 * authenticated frontend API client exists (no Auth.js session/JWT to
 * attach yet — same placeholder pattern as `expense-form.tsx` and
 * `link-telegram-button.tsx`).
 */
function generateMockKey(): { fullKey: string; keyPrefix: string } {
  const randomPart = Array.from({ length: 32 }, () =>
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.charAt(
      Math.floor(Math.random() * 62)
    )
  ).join('');
  const fullKey = `sk_live_${randomPart}`;
  return { fullKey, keyPrefix: fullKey.slice(0, 12) };
}

/**
 * "API keys" settings page — list + generate + revoke.
 *
 * TODO(backend): wire up real network calls once an authenticated frontend
 * API client exists:
 *   - initial list -> `GET /api/v1/api-keys`
 *   - generate     -> `POST /api/v1/api-keys` (body: { name, scopes: [] })
 *   - revoke       -> `DELETE /api/v1/api-keys/:id`
 * All three endpoints already exist (`apps/backend/src/api-keys/`) — only
 * the frontend's network wiring is mocked here. Everything else (form
 * state, the reveal-once flow, optimistic list updates, copy-to-clipboard)
 * is real, working client state.
 */
export function ApiKeysManager({ initialKeys }: { initialKeys: ApiKeyListItem[] }) {
  const t = useTranslations('settings.apiKeys');
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const [keys, setKeys] = useState<ApiKeyListItem[]>(initialKeys);
  const [name, setName] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGenerating(true);

    // TODO(backend): replace with a real `POST /api/v1/api-keys` call.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const { fullKey, keyPrefix } = generateMockKey();
    const newKey: ApiKeyListItem = {
      id: crypto.randomUUID(),
      name: name.trim(),
      keyPrefix,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      revokedAt: null
    };

    setKeys((current) => [newKey, ...current]);
    setRevealedKey(fullKey);
    setName('');
    setFormOpen(false);
    setGenerating(false);
  }

  async function handleRevoke(id: string) {
    if (!window.confirm(t('confirmRevoke'))) return;
    setRevokingId(id);

    // TODO(backend): replace with a real `DELETE /api/v1/api-keys/:id` call.
    await new Promise((resolve) => setTimeout(resolve, 300));

    setKeys((current) =>
      current.map((key) => (key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key))
    );
    setRevokingId(null);
  }

  async function handleCopy() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      {revealedKey && (
        <div className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-medium">{t('reveal.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('reveal.warning')}</p>

          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">
              {revealedKey}
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
            onClick={() => setRevealedKey(null)}
            className="mt-3 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t('reveal.done')}
          </button>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t('columns.name')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.prefix')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.lastUsed')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.created')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.status')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            )}

            {keys.map((key) => {
              const revoked = key.revokedAt !== null;
              return (
                <tr key={key.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-medium">{key.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {key.keyPrefix}****
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {key.lastUsedAt ? dateFormatter.format(new Date(key.lastUsedAt)) : t('neverUsed')}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {dateFormatter.format(new Date(key.createdAt))}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        revoked ? 'bg-muted text-muted-foreground' : 'bg-success/15 text-success'
                      )}
                    >
                      {revoked ? t('statusRevoked') : t('statusActive')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!revoked && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(key.id)}
                        disabled={revokingId === key.id}
                        className="text-xs font-medium text-destructive underline underline-offset-2 hover:no-underline disabled:cursor-not-allowed disabled:opacity-60"
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

      <div className="mt-6 rounded-lg border border-border p-4">
        {formOpen ? (
          <form onSubmit={handleGenerate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="apiKeyName" className="text-sm font-medium">
                {t('generate.nameLabel')}
              </label>
              <input
                id="apiKeyName"
                name="apiKeyName"
                type="text"
                required
                placeholder={t('generate.namePlaceholder')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
              />
              <p className="text-xs text-muted-foreground">{t('generate.nameHint')}</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={generating || name.trim().length === 0}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? t('generate.generating') : t('generate.submit')}
              </button>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={generating}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                {t('generate.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t('generate.button')}
          </button>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{t('docsHint')}</p>
    </div>
  );
}
