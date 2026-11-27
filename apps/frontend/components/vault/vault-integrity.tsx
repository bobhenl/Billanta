'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonClass } from '@/lib/ui-classes';

export const VAULT_MANIFEST_PATH = '/.well-known/billanta-vault.json';

interface Manifest {
  source: { repo: string | null; path: string; sha256: string };
  build: string | null;
  chunks: { path: string; sha256: string }[];
}

type Outcome = 'match' | 'mismatch' | 'error';

async function sha256(url: string): Promise<string> {
  const body = await (await fetch(url, { cache: 'no-store' })).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', body);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Chunks this very page has loaded, so the visitor can see the manifest is about the code running here. */
function loadedHere(): Set<string> {
  const paths = performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname);
  return new Set(paths);
}

/**
 * The build manifest (scripts/vault-manifest.mjs): the hash of the crypto
 * source and of each built chunk that carries it. "Zkontrolovat" re-hashes
 * the chunks in this browser. Both come from our server, so a match shows
 * the manifest describes what is served, not that the server is honest;
 * that needs the hashes compared with a build of the published source.
 */
export function VaultIntegrity() {
  const t = useTranslations('vaultPublic.integrity');
  const [manifest, setManifest] = useState<Manifest | null | 'missing'>(null);
  const [checks, setChecks] = useState<Record<string, Outcome>>({});
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(VAULT_MANIFEST_PATH, { cache: 'no-store' })
      .then(async (r): Promise<Manifest | 'missing'> => (r.ok ? ((await r.json()) as Manifest) : 'missing'))
      .then((m) => setManifest(m))
      .catch(() => setManifest('missing'));
  }, []);

  const verify = async () => {
    if (!manifest || manifest === 'missing') return;
    setBusy(true);
    setLoaded(loadedHere());
    const next: Record<string, Outcome> = {};
    for (const chunk of manifest.chunks) {
      try {
        next[chunk.path] = (await sha256(chunk.path)) === chunk.sha256 ? 'match' : 'mismatch';
      } catch {
        next[chunk.path] = 'error';
      }
    }
    setChecks(next);
    setBusy(false);
  };

  return (
    <section id="integrity" className="scroll-mt-20 space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('title')}
      </h2>
      <p className="text-xs text-muted-foreground">{t('lead')}</p>
      {manifest === null && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
      {manifest === 'missing' && <p className="text-sm text-muted-foreground">{t('missing')}</p>}
      {manifest && manifest !== 'missing' && (
        <>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="font-semibold">{t('sourceHash', { path: manifest.source.path })}</dt>
              <dd className="break-all font-mono text-muted-foreground">{manifest.source.sha256}</dd>
            </div>
            <div>
              <dt className="font-semibold">{t('repo')}</dt>
              <dd className="text-muted-foreground">
                {manifest.source.repo ? (
                  <a href={manifest.source.repo} rel="noopener" target="_blank" className="break-all underline underline-offset-2">
                    {manifest.source.repo}
                  </a>
                ) : (
                  t('repoPlanned')
                )}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">{t('chunks')}</dt>
              <dd>
                <ul className="space-y-1.5">
                  {manifest.chunks.map((c) => {
                    const outcome = checks[c.path];
                    return (
                      <li key={c.path} className="rounded-lg bg-muted/50 p-2">
                        <span className="block break-all font-mono">{c.path}</span>
                        <span className="block break-all font-mono text-muted-foreground">{c.sha256}</span>
                        {outcome && (
                          <span className={outcome === 'match' ? 'mt-1 flex items-center gap-1 font-semibold text-success' : 'mt-1 flex items-center gap-1 font-semibold text-destructive'}>
                            {outcome === 'match' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                            {t(outcome)}
                            {loaded.has(c.path) && <span className="font-normal text-muted-foreground"> · {t('loadedHere')}</span>}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </dd>
            </div>
          </dl>
          <a href={VAULT_MANIFEST_PATH} className="inline-block text-xs font-semibold underline underline-offset-2">
            {VAULT_MANIFEST_PATH}
          </a>
          <div>
            <button type="button" onClick={() => void verify()} disabled={busy} className={buttonClass.secondary}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('check')}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t('honest')}</p>
        </>
      )}
    </section>
  );
}
