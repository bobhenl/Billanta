'use client';

import { useState } from 'react';
import { FileJson, FileSpreadsheet, Loader2, LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isSealed, type VaultKey } from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { useVault } from '@/components/vault/vault-provider';
import { buttonClass } from '@/lib/ui-classes';
import { fetchAllVaultDocuments, openOrNull } from '@/lib/vault/sealed-index';
import type { VaultDocument } from '@/lib/vault/types';

const COLUMNS = [
  'documentType',
  'invoiceNumber',
  'status',
  'issueDate',
  'taxableSupplyDate',
  'dueDate',
  'paidAt',
  'contactName',
  'contactIco',
  'variableSymbol',
  'currency',
  'totalWithoutVat',
  'totalVat',
  'total',
  'noteAbove',
  'noteBelow',
  'internalNote',
  'itemDescription',
  'itemCode',
  'quantity',
  'unit',
  'unitPrice',
  'vatRate',
  'discountPercent'
] as const;

/** Same cell rules as the server's CSV exports: `;`, decimal comma, quoted when needed, no formula injection. */
function cell(value: string | number | null | undefined): string {
  if (value == null) return '';
  let text = typeof value === 'number' ? String(value).replace('.', ',') : value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const day = (v: string | null) => (v ? v.slice(0, 10) : '');

function toCsv(docs: VaultDocument[], header: string[]): string {
  const lines = [header.map(cell).join(';')];
  for (const d of docs) {
    const head = [d.documentType, d.invoiceNumber, d.status, day(d.issueDate), day(d.taxableSupplyDate), day(d.dueDate), day(d.paidAt), d.contactName, d.contactIco, d.variableSymbol, d.currency, d.totalWithoutVat, d.totalVat, d.total, d.noteAbove, d.noteBelow, d.internalNote];
    const items = d.items.length ? d.items : [null];
    for (const i of items) {
      const tail = i ? [i.description, i.code, i.quantity, i.unit, i.unitPrice, i.vatRate, i.discountPercent] : ['', '', '', '', '', '', ''];
      lines.push([...head, ...tail].map(cell).join(';'));
    }
  }
  // BOM: Excel otherwise reads the UTF-8 file as cp1250 and mangles diacritics.
  return `﻿${lines.join('\r\n')}\r\n`;
}

function save(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * "Export s dešifrovanými texty": the period's documents with every envelope
 * opened in this browser and saved straight to the member's disk. The file
 * is built here; the server only ever sends ciphertext for it and never
 * sees the result.
 */
export function DecryptedExport({ range }: { range: { from: string; to: string } | null }) {
  const t = useTranslations('vault.export');
  const { vault, key, requestUnlock } = useVault();
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null);
  const [result, setResult] = useState<{ tone: 'ok' | 'err' | 'warn'; text: string } | null>(null);
  if (!vault) return null;

  const openAll = async (k: VaultKey, docs: VaultDocument[]) => {
    let unreadable = 0;
    const text = async (v: string | null) => {
      if (!v || !isSealed(v)) return v;
      const opened = await openOrNull(k, v);
      if (opened === null) unreadable++;
      return opened ?? t('unreadable');
    };
    const opened: VaultDocument[] = [];
    for (const d of docs) {
      opened.push({
        ...d,
        noteAbove: await text(d.noteAbove),
        noteBelow: await text(d.noteBelow),
        internalNote: await text(d.internalNote),
        items: await Promise.all(d.items.map(async (i) => ({ ...i, description: (await text(i.description)) ?? '' })))
      });
    }
    return { opened, unreadable };
  };

  const run = async (format: 'csv' | 'json') => {
    if (!range) return;
    setResult(null);
    const k = key ?? (await requestUnlock());
    if (!k) return;
    setBusy(format);
    try {
      const { documents, skippedLocked } = await fetchAllVaultDocuments({ sealedOnly: false, ...range });
      const { opened, unreadable } = await openAll(k, documents);
      const name = `billanta-${range.from}-${range.to}`;
      if (format === 'csv') save(`${name}.csv`, toCsv(opened, COLUMNS.map((c) => t(`columns.${c}`))), 'text/csv;charset=utf-8');
      else save(`${name}.json`, `${JSON.stringify({ from: range.from, to: range.to, documents: opened }, null, 2)}\n`, 'application/json');
      const notes = [skippedLocked > 0 && t('skippedLocked', { n: skippedLocked }), unreadable > 0 && t('unreadableCount', { n: unreadable })].filter(Boolean).join(' ');
      setResult({ tone: notes ? 'warn' : 'ok', text: `${t('done', { n: opened.length })}${notes ? ` ${notes}` : ''}` });
    } catch {
      setResult({ tone: 'err', text: t('failed') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-bold">
        <LockKeyhole className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('lead')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass.secondary} disabled={!range || busy !== null} onClick={() => void run('csv')}>
          {busy === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
          {busy === 'csv' ? t('working') : t('csv')}
        </button>
        <button type="button" className={buttonClass.secondary} disabled={!range || busy !== null} onClick={() => void run('json')}>
          {busy === 'json' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileJson className="h-4 w-4" aria-hidden="true" />}
          {busy === 'json' ? t('working') : t('json')}
        </button>
      </div>
      {!key && <p className="mt-2 text-xs text-muted-foreground">{t('needsUnlock')}</p>}
      {result && (
        <Banner tone={result.tone} className="mt-3">
          {result.text}
        </Banner>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('accountingNote')}</p>
    </section>
  );
}
