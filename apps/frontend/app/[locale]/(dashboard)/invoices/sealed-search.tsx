'use client';

import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isSealed } from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { useVault } from '@/components/vault/vault-provider';
import { fuzzyScore } from '@/lib/fuzzy';
import type { InvoiceRow } from '@/lib/invoice-ui';
import { buttonClass } from '@/lib/ui-classes';
import { loadSealedIndex, type SealedIndexEntry } from '@/lib/vault/sealed-index';
import { InvoicesTable } from './invoices-table';

type Props = ComponentProps<typeof InvoicesTable> & { note?: string; item?: string };

const plain = (v: unknown) => (typeof v === 'string' && !isSealed(v) ? v : null);

/** Same rules as the backend's text filters, over the texts this browser opened. */
function matches(row: InvoiceRow, entry: SealedIndexEntry | undefined, note?: string, item?: string): boolean {
  if (!entry) return false;
  const r = row as InvoiceRow & Record<string, unknown>;
  return (row.sealedPending ?? []).every((part) =>
    part === 'note'
      ? Boolean(note) && fuzzyScore(note!, [...entry.notes, plain(r.internalNote), plain(r.noteAbove), plain(r.noteBelow), plain(r.clientResponseNote)]) > 0
      : Boolean(item) && entry.items.some((i) => fuzzyScore(item!, [i.description, i.code]) > 0)
  );
}

/**
 * The invoice list with "Důvěrný režim" in the text filters. The server
 * cannot read encrypted notes and item texts, so it hands back the
 * documents where they might match (`sealedPending`); this browser opens
 * them with the unlocked key and keeps only real matches. Locked vault: those
 * documents stay out, with a hint saying so.
 */
export function SealedSearchTable({ note, item, ...props }: Props) {
  const t = useTranslations('vault.search');
  const { tenantId, vault, key, requestUnlock } = useVault();
  const pending = useMemo(() => props.rows.filter((r) => r.sealedPending?.length), [props.rows]);
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'failed' } | { kind: 'done'; keep: Set<string>; skippedLocked: number }>({ kind: 'idle' });

  useEffect(() => {
    if (!pending.length || !tenantId || !key) return setState({ kind: 'idle' });
    let live = true;
    setState({ kind: 'loading' });
    loadSealedIndex(tenantId, key)
      .then((index) => {
        if (!live) return;
        const keep = new Set(pending.filter((r) => matches(r, index.entries.get(r.id), note, item)).map((r) => r.id));
        setState({ kind: 'done', keep, skippedLocked: index.skippedLocked });
      })
      .catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
  }, [pending, tenantId, key, note, item]);

  if (!pending.length) return <InvoicesTable {...props} />;

  const rows = props.rows.filter((r) => !r.sealedPending?.length || (state.kind === 'done' && state.keep.has(r.id)));
  return (
    <div className="space-y-3">
      {!key ? (
        <Banner
          tone="info"
          action={
            vault ? (
              <button type="button" className={buttonClass.secondary} onClick={() => void requestUnlock()}>
                <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                {t('unlock')}
              </button>
            ) : undefined
          }
        >
          {t('lockedHint', { n: pending.length })}
        </Banner>
      ) : state.kind === 'loading' || state.kind === 'idle' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('searching')}
        </p>
      ) : state.kind === 'failed' ? (
        <Banner tone="warn">{t('failed')}</Banner>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          {t('included')}
          {state.kind === 'done' && state.skippedLocked > 0 && ` ${t('skippedLocked', { n: state.skippedLocked })}`}
        </p>
      )}
      <InvoicesTable {...props} rows={rows} />
    </div>
  );
}
