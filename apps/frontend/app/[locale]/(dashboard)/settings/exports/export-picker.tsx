'use client';

import { useState } from 'react';
import { Download, FileCode2, FileSpreadsheet, Receipt, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { FeatureBadge } from '@/components/plan-lock';
import { DecryptedExport } from '@/components/vault/decrypted-export';
import { useVault } from '@/components/vault/vault-provider';
import { toast } from '@/components/toaster';
import { isAmountsSealedRefusal, saveText, sealedAccountingXml, sealedInvoicesCsv } from '@/lib/vault/sealed-exports';
import type { VaultKey } from '@faktur/cz-compliance';
import type { FeatureUsage } from '@/lib/usage';
import { inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

type Mode = 'month' | 'quarter' | 'year' | 'range';
const pad = (n: number) => String(n).padStart(2, '0');

/** Period → the backend's `?month=` or `?from=&to=` (to inclusive). */
function periodQuery(mode: Mode, month: string, quarter: string, year: string, from: string, to: string): string | null {
  if (mode === 'month') return /^\d{4}-\d{2}$/.test(month) ? `month=${month}` : null;
  if (mode === 'range') return from && to && from <= to ? `from=${from}&to=${to}` : null;
  const y = Number(year);
  if (!y) return null;
  if (mode === 'year') return `from=${y}-01-01&to=${y}-12-31`;
  const lastMonth = Number(quarter) * 3;
  const lastDay = new Date(y, lastMonth, 0).getDate();
  return `from=${y}-${pad(lastMonth - 2)}-01&to=${y}-${pad(lastMonth)}-${pad(lastDay)}`;
}

/** The same period as plain days, for the export built in the browser. */
function periodRange(query: string | null): { from: string; to: string } | null {
  if (!query) return null;
  const params = new URLSearchParams(query);
  const month = params.get('month');
  if (month) {
    const [y, m] = month.split('-').map(Number);
    return { from: `${month}-01`, to: `${month}-${pad(new Date(y!, m!, 0).getDate())}` };
  }
  const from = params.get('from');
  const to = params.get('to');
  return from && to ? { from, to } : null;
}

/** The server's file-name label for the period: `2026-03`, or `2026-01-01_2026-03-31`. */
function periodLabel(query: string): string {
  const params = new URLSearchParams(query);
  return params.get('month') ?? `${params.get('from')}_${params.get('to')}`;
}

const FILES = [
  { key: 'invoices', path: 'invoices.csv', icon: FileSpreadsheet },
  { key: 'expenses', path: 'expenses.csv', icon: Receipt },
  { key: 'pohoda', path: 'pohoda.xml', icon: FileCode2, gated: true },
  { key: 'moneyS3', path: 'money-s3.xml', icon: FileCode2, gated: true }
] as const;

/** A file the browser builds itself when the server refuses it over sealed amounts. */
interface SealedFile {
  /** The server's file-name stem. */
  fallback: string;
  ext: string;
  type: string;
  /** The inputs route with the start of its query. */
  inputs: string;
  build: (key: VaultKey, inputs: any) => Promise<{ body: string | null; missing: number }>;
}

/** `accounting` is the Pohoda/Money S3 plan access; CSV is on every plan. */
export function ExportPicker({ home = 'CZK', accounting }: { home?: string; accounting?: FeatureUsage | null }) {
  const t = useTranslations('settings.exports');
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastQuarter = Math.floor(now.getMonth() / 3) || 4;
  const [mode, setMode] = useState<Mode>('month');
  const [month, setMonth] = useState(`${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`);
  const [quarter, setQuarter] = useState(String(lastQuarter));
  const [year, setYear] = useState(String(lastQuarter === 4 && now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear()));
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const query = periodQuery(mode, month, quarter, year, from, to);
  const years = Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i));
  const tSealed = useTranslations('vault.amounts');
  const { key: vaultKey, requestUnlock } = useVault();

  /**
   * The invoice CSV and the accountant's XML are fetched rather than
   * linked: with sealed amounts the server refuses them and this browser
   * builds them from the server's rows plus the amounts it opens.
   */
  const SEALED: Partial<Record<(typeof FILES)[number]['key'], SealedFile>> = {
    invoices: { fallback: 'faktury', ext: 'csv', type: 'text/csv;charset=utf-8', inputs: 'invoices-csv-inputs?', build: sealedInvoicesCsv },
    pohoda: { fallback: 'pohoda', ext: 'xml', type: 'application/xml;charset=utf-8', inputs: 'accounting-inputs?format=pohoda&', build: sealedAccountingXml },
    moneyS3: { fallback: 'money-s3', ext: 'xml', type: 'application/xml;charset=utf-8', inputs: 'accounting-inputs?format=money-s3&', build: sealedAccountingXml }
  };

  async function download(event: React.MouseEvent<HTMLAnchorElement>, path: string, file: SealedFile) {
    if (!query) return;
    event.preventDefault();
    try {
      const res = await fetch(`/api/files/exports/${path}?${query}`);
      if (!(await isAmountsSealedRefusal(res))) {
        if (!res.ok) throw new Error(String(res.status));
        const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${file.fallback}.${file.ext}`;
        saveText(name, await res.blob(), file.type);
        return;
      }
      const k = vaultKey ?? (await requestUnlock());
      if (!k) {
        toast({ text: tSealed('exportLocked'), tone: 'info' });
        return;
      }
      const inputs = await fetch(`/api/files/exports/${file.inputs}${query}`);
      if (!inputs.ok) throw new Error(String(inputs.status));
      const out = await file.build(k, await inputs.json());
      if (out.body == null) {
        toast({ text: tSealed('exportUnreadable', { count: out.missing }), tone: 'err' });
        return;
      }
      saveText(`${file.fallback}-${periodLabel(query)}.${file.ext}`, out.body, file.type);
    } catch {
      toast({ text: t('vat.failed'), tone: 'err' });
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="font-bold">{t('period')}</h2>
        <div className="mt-3 inline-flex flex-wrap rounded-full border border-border bg-muted/40 p-0.5 text-sm">
          {(['month', 'quarter', 'year', 'range'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn('rounded-full px-3 py-1 font-semibold', mode === m ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {t(`modes.${m}`)}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {mode === 'month' && <input type="month" className={cn(inputClass, 'w-auto')} value={month} onChange={(e) => setMonth(e.target.value)} />}
          {(mode === 'quarter' || mode === 'year') && (
            <select className={cn(inputClass, 'w-auto')} value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          )}
          {mode === 'quarter' && (
            <select className={cn(inputClass, 'w-auto')} value={quarter} onChange={(e) => setQuarter(e.target.value)}>
              {['1', '2', '3', '4'].map((q) => (
                <option key={q} value={q}>
                  {t('quarter', { q })}
                </option>
              ))}
            </select>
          )}
          {mode === 'range' && (
            <>
              <input type="date" className={cn(inputClass, 'w-auto')} value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="self-center text-muted-foreground">–</span>
              <input type="date" className={cn(inputClass, 'w-auto')} value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
        </div>
      </section>

      <FeatureBadge usage={accounting} className="-mb-2 justify-end" />
      <div className="grid gap-3 sm:grid-cols-2">
        {FILES.map(({ key, path, icon: Icon, ...file }) => {
          const open = !!query && !('gated' in file && accounting?.access === 'locked');
          return (
          <a
            key={key}
            href={open ? `/api/files/exports/${path}?${query}` : undefined}
            onClick={SEALED[key] ? (event) => download(event, path, SEALED[key]!) : undefined}
            download
            aria-disabled={!open}
            className={cn(
              'flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors',
              open ? 'hover:border-primary hover:shadow-md' : 'pointer-events-none opacity-50'
            )}
          >
            <Icon className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{t(`files.${key}.title`)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t(`files.${key}.hint`, { home, source: home === 'EUR' ? 'ECB' : 'ČNB' })}</span>
            </span>
            <Download className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-label={t('download')} />
          </a>
          );
        })}
      </div>

      <DecryptedExport range={periodRange(query)} />

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-4 text-sm">
        <UserPlus className="h-5 w-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-muted-foreground">{t('accountantHint')}</span>
        <Link href="/settings/team" className="font-semibold text-primary hover:underline">
          {t('inviteAccountant')} →
        </Link>
      </section>
    </div>
  );
}
