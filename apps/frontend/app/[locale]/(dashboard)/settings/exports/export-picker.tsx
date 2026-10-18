'use client';

import { useState } from 'react';
import { Download, FileCode2, FileSpreadsheet, Receipt, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { inputClass } from '@/components/modal';
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

const FILES = [
  { key: 'invoices', path: 'invoices.csv', icon: FileSpreadsheet },
  { key: 'expenses', path: 'expenses.csv', icon: Receipt },
  { key: 'pohoda', path: 'pohoda.xml', icon: FileCode2 },
  { key: 'moneyS3', path: 'money-s3.xml', icon: FileCode2 }
] as const;

export function ExportPicker({ home = 'CZK' }: { home?: string }) {
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

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-xl border border-border bg-card p-5">
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

      <div className="grid gap-4 sm:grid-cols-3">
        {FILES.map(({ key, path, icon: Icon }) => (
          <a
            key={key}
            href={query ? `/api/files/exports/${path}?${query}` : undefined}
            download
            aria-disabled={!query}
            className={cn(
              'flex flex-col rounded-xl border border-border bg-card p-5 transition-colors',
              query ? 'hover:border-primary hover:shadow-md' : 'pointer-events-none opacity-50'
            )}
          >
            <Icon className="h-7 w-7 text-primary" />
            <span className="mt-3 font-bold">{t(`files.${key}.title`)}</span>
            <span className="mt-1 flex-1 text-xs text-muted-foreground">{t(`files.${key}.hint`, { home, source: home === 'EUR' ? 'ECB' : 'ČNB' })}</span>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
              <Download className="h-4 w-4" />
              {t('download')}
            </span>
          </a>
        ))}
      </div>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-4 text-sm">
        <UserPlus className="h-5 w-5 text-primary" />
        <span className="flex-1 text-muted-foreground">{t('accountantHint')}</span>
        <Link href="/settings/team" className="font-semibold text-primary hover:underline">
          {t('inviteAccountant')} →
        </Link>
      </section>
    </div>
  );
}
