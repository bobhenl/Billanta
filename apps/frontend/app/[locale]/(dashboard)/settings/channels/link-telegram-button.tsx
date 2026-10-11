'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Placeholder Telegram bot username — replace once the real bot (blueprint
 * §6/§10 Phase 5) is registered with BotFather. Only used to build the
 * `https://t.me/<bot>?start=<token>` deep link shown after "generating" a
 * code below.
 */
const TELEGRAM_BOT_USERNAME = 'faktur_bot';

/**
 * Stand-in for a server-generated linking token. A real implementation must
 * NEVER generate this client-side (it has to be single-use, short-lived,
 * and recorded server-side in `channel_links` per blueprint §6) — this
 * exists purely so the UI has something plausible to render before the
 * backend endpoint exists.
 */
function generateMockLinkingToken(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

/**
 * "Link Telegram" action for the channels settings page.
 *
 * TODO(backend): this should call `POST /api/v1/channel-links` to generate
 * a short-lived, single-use linking code/token for the current tenant.
 * That endpoint does not exist yet — the original backend scaffold only
 * has the bot-side `verify` callback (blueprint §6 step 2: sending the code
 * to the bot activates the row), not the dashboard-side "generate a code"
 * endpoint this button needs. Flagging that as a needed backend addition
 * rather than implementing it here.
 *
 * Everything below `handleGenerateCode` is real, working client state
 * (loading → generated, copy-to-clipboard) — only the network call itself
 * is mocked.
 */
export function LinkTelegramButton() {
  const t = useTranslations('settings.channels');
  const [status, setStatus] = useState<'idle' | 'generating' | 'generated'>('idle');
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerateCode() {
    setStatus('generating');

    // TODO(backend): replace with a real `POST /api/v1/channel-links` call.
    // The delay below only simulates network latency for the mocked
    // response so the loading state has something to show.
    await new Promise((resolve) => setTimeout(resolve, 500));

    setToken(generateMockLinkingToken());
    setStatus('generated');
  }

  async function handleCopy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const deepLink = token ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}` : null;

  return (
    <div>
      <button
        type="button"
        onClick={handleGenerateCode}
        disabled={status === 'generating'}
        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === 'generating' ? t('generating') : t('linkTelegram')}
      </button>

      {status === 'generated' && token && deepLink && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">{t('codeInstructions')}</p>

          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm tracking-wider">
              {token}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              {copied ? t('copied') : t('copy')}
            </button>
          </div>

          {/* Absolute external URL, not a locale-aware in-app route — a
              plain <a>, not next-intl's `Link`, is the correct choice here. */}
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t('openInTelegram')}
          </a>

          <p className="mt-2 text-xs text-muted-foreground">{t('expiresNote')}</p>
        </div>
      )}
    </div>
  );
}
