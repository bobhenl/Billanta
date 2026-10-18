'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from '@/components/toaster';
import { createLinkingCode, unlinkChannel } from './actions';
import { copyText } from '@/lib/clipboard';

/**
 * "Link Telegram": asks the backend for a single-use code (30 min) and shows
 * the `t.me/<bot>?start=<code>` deep link. The bot consumes the code via the
 * AI service; "Hotovo" reloads the list so the new chat appears.
 */
export function LinkTelegramButton({ botUsername }: { botUsername: string }) {
  const t = useTranslations('settings.channels');
  const router = useRouter();
  const locale = useLocale();
  const [status, setStatus] = useState<'idle' | 'generating' | 'generated'>('idle');
  const [code, setCode] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerateCode() {
    setStatus('generating');
    const result = await createLinkingCode('telegram');
    if (!result.ok) {
      toast({ text: result.error, tone: 'err' });
      setStatus(code ? 'generated' : 'idle');
      return;
    }
    setCode({ token: result.data.linkingToken, expiresAt: result.data.expiresAt });
    setStatus('generated');
  }

  async function handleCopy() {
    if (!code) return;
    await copyText(`/start ${code.token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const deepLink = code ? `https://t.me/${botUsername}?start=${code.token}` : null;
  const expiresAt = code ? new Date(code.expiresAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div>
      <button
        type="button"
        onClick={handleGenerateCode}
        disabled={status === 'generating'}
        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'generating' ? t('generating') : status === 'generated' ? t('newCode') : t('linkTelegram')}
      </button>

      {status === 'generated' && code && deepLink && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">{t('codeInstructions')}</p>

          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">
              /start {code.token}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              {copied ? t('copied') : t('copy')}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {/* External URL, so a plain <a> rather than next-intl's Link. */}
            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              {t('openInTelegram')}
            </a>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              {t('done')}
            </button>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">{t('expiresAt', { time: expiresAt })}</p>
        </div>
      )}
    </div>
  );
}

export function UnlinkButton({ id }: { id: string }) {
  const t = useTranslations('settings.channels');
  const [busy, setBusy] = useState(false);

  async function handleUnlink() {
    if (!window.confirm(t('unlinkConfirm'))) return;
    setBusy(true);
    const result = await unlinkChannel(id);
    setBusy(false);
    toast(result.ok ? { text: t('unlinked'), tone: 'ok' } : { text: result.error, tone: 'err' });
  }

  return (
    <button
      type="button"
      onClick={handleUnlink}
      disabled={busy}
      className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
    >
      {t('unlink')}
    </button>
  );
}
