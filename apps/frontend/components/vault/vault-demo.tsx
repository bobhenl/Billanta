'use client';

import { useRef, useState } from 'react';
import { Loader2, LockKeyhole, LockOpen, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { generateDataKey, open, seal, type VaultKey } from '@faktur/cz-compliance';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

export const VAULT_DEMO_ECHO = '/api/v1/public/vault-demo/echo';
const MAX_TEXT = 500;

interface Result {
  typed: string;
  body: string;
  status: number;
  response: string;
  envelope: string | null;
}

/**
 * The live demo on /security/confidential. The sentence is sealed here
 * with a key made for this one page view (it is never sent, and gone on
 * reload), the envelope goes to the echo endpoint as a real request, and
 * the page shows what was typed, the exact body sent and the exact answer.
 */
export function VaultDemo() {
  const t = useTranslations('vaultPublic.demo');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<VaultKey | null>(null);

  const run = async () => {
    const typed = text.trim();
    if (!typed) return;
    setBusy(true);
    setError(null);
    setOpened(null);
    try {
      key.current ??= await generateDataKey();
      const body = JSON.stringify({ envelope: await seal(key.current, typed) });
      const res = await fetch(VAULT_DEMO_ECHO, { method: 'POST', headers: { 'content-type': 'application/json' }, body, cache: 'no-store' });
      const response = await res.text();
      let envelope: string | null = null;
      try {
        envelope = (JSON.parse(response) as { received?: { envelope?: string } }).received?.envelope ?? null;
      } catch {
        // Not JSON (a proxy error page): shown as it came.
      }
      setResult({ typed, body, status: res.status, response, envelope });
      if (res.status === 429) setError(t('rateLimited'));
      else if (!res.ok) setError(t('failed'));
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!result?.envelope || !key.current) return;
    try {
      setOpened(await open(key.current, result.envelope));
    } catch {
      setOpened(null);
      setError(t('failed'));
    }
  };

  const pretty = (raw: string) => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <label htmlFor="vault-demo-text" className="text-sm font-bold">
        {t('label')}
      </label>
      <textarea
        id="vault-demo-text"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
        placeholder={t('placeholder')}
        rows={2}
        maxLength={MAX_TEXT}
        className={cn(inputClass, 'mt-2 w-full resize-y')}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void run()} disabled={busy || !text.trim()} className={buttonClass.primary}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {t('send')}
        </button>
        <span className="text-xs text-muted-foreground">{t('keyNote')}</span>
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-destructive">{error}</p>}

      {result && (
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <Column title={t('typed')} hint={t('typedHint')}>
            <p className="whitespace-pre-wrap break-words text-sm">{result.typed}</p>
          </Column>
          <Column title={t('sent')} hint={t('sentHint', { path: VAULT_DEMO_ECHO })}>
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{result.body}</pre>
          </Column>
          <Column title={t('received', { status: result.status })} hint={t('receivedHint')}>
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{pretty(result.response)}</pre>
          </Column>
        </div>
      )}

      {result?.envelope && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={() => void reopen()} className={buttonClass.secondary}>
            {opened == null ? <LockKeyhole className="h-4 w-4" aria-hidden="true" /> : <LockOpen className="h-4 w-4" aria-hidden="true" />}
            {t('open')}
          </button>
          {opened != null && (
            <span>
              {t('openedAs')} <strong className="break-words">{opened}</strong>
            </span>
          )}
        </div>
      )}

      <div className="mt-5 rounded-xl bg-muted/50 p-4 text-sm">
        <h3 className="font-bold">{t('devtoolsTitle')}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          {(t.raw('devtoolsSteps') as string[]).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Column({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}
