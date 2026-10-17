'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { inputClass } from '@/components/modal';
import { cn } from '@/lib/utils';

interface Filings {
  year: number;
  basis: 'cash' | 'accrual';
  vatPayer: boolean;
  counts: { invoices: number; expenses: number; missingRates: number };
  dpfo: { flatRate: number | null; rows: Record<string, number> };
  cssz: { insured: boolean; nextMinimumKnown: boolean; rows: Record<string, number> };
  health: {
    profit: number;
    baseFromProfit: number;
    minBase: number;
    base: number;
    premium: number;
    paid: number;
    balance: number;
    nextAdvance: number;
    nextMinimumKnown: boolean;
  };
  forms: { dpfdp: string | null; cssz: boolean };
  insurers: { code: string; name: string }[];
}

const EXPENSE_MODES = ['60', '80', '40', '30', 'actual'] as const;
const DPFO_ROWS = ['r101', 'r102', 'r113', 'r61', 'r56', 'r57', 'r64', 'r65a', 'r71', 'r84', 'r91'] as const;
const DPFO_STRONG = new Set(['r113', 'r71', 'r91']);
const CSSZ_ROWS = ['r24', 'r25', 'r27', 'r28', 'r32', 'r33', 'r34', 'r35', 'r36'] as const;
const CSSZ_STRONG = new Set(['r32', 'r34', 'r36']);
const HEALTH_ROWS = ['profit', 'baseFromProfit', 'minBase', 'base', 'premium', 'paid', 'balance', 'nextAdvance'] as const;
const HEALTH_STRONG = new Set(['premium', 'balance', 'nextAdvance']);
const ERROR_CODES = ['form_not_published', 'year_not_supported', 'invalid_filings_query'] as const;

/**
 * Roční podání for an OSVČ: the DPFO return (EPO XML), the přehled for ČSSZ
 * (ePortál XML) and the values for the health insurer's own form, all from
 * the year's documents. Personal data for the files is typed here, sent in
 * the POST body and never stored. Filing itself is always the user's step.
 */
export function AnnualFilings() {
  const t = useTranslations('settings.exports.filings');
  const locale = useLocale();
  const now = new Date();
  const [year, setYear] = useState(String(now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear()));
  const [mode, setMode] = useState<(typeof EXPENSE_MODES)[number]>('60');
  const [basis, setBasis] = useState<'cash' | 'accrual'>('cash');
  const [activity, setActivity] = useState<'H' | 'V'>('H');
  const [fromMonth, setFromMonth] = useState('1');
  const [taxAdvances, setTaxAdvances] = useState('');
  const [spouse, setSpouse] = useState(false);
  const [person, setPerson] = useState({ birthNumber: '', taxOffice: '', taxWorkplace: '', ossz: '', variableSymbol: '', dataBox: '' });
  const [insurer, setInsurer] = useState('111');
  const [data, setData] = useState<Filings | null | undefined>(undefined);
  const [busy, setBusy] = useState<'dpfdp' | 'osvc' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const years = Array.from({ length: 4 }, (_, i) => String(now.getFullYear() - i));

  const query: Record<string, string> = { year, expenses: mode, basis, activity };
  if (fromMonth !== '1') query.months = Array.from({ length: 13 - Number(fromMonth) }, (_, i) => Number(fromMonth) + i).join(',');
  if (taxAdvances) query.taxAdvancesPaid = taxAdvances;
  if (spouse) query.spouseCredit = 'true';
  const qs = new URLSearchParams(query).toString();

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      fetch(`/api/files/exports/annual-filings?${qs}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json: Filings | null) => alive && setData(json))
        .catch(() => alive && setData(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [qs]);

  async function download(kind: 'dpfdp' | 'osvc') {
    setBusy(kind);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...query };
      for (const [k, v] of Object.entries(person)) if (v.trim()) body[k] = v.trim();
      const res = await fetch(`/api/files/exports/annual-filings/${kind}.xml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const code = ERROR_CODES.find((c) => text.includes(c));
        setError(code ? t(`errors.${code}`) : t('errors.generic'));
        return;
      }
      const blob = await res.blob();
      const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `${kind}-${year}.xml`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(null);
    }
  }

  const czk = new Intl.NumberFormat(locale, { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
  const line = (key: string, label: string, value: number, strong: boolean, prefix?: string) => (
    <div key={key} className={cn('flex items-baseline justify-between gap-3 py-1.5', strong && 'font-bold')}>
      <span className="text-muted-foreground">
        {prefix && <span className="mr-1 tabular-nums">{prefix}</span>}
        {label}
      </span>
      <span className="tabular-nums">{czk.format(value)}</span>
    </div>
  );
  const personField = (key: keyof typeof person, opts?: { hint?: string; inputMode?: 'numeric' }) => (
    <label className="space-y-1">
      <span className="font-semibold">{opts?.hint ? <InfoHint hint={opts.hint}>{t(`person.${key}`)}</InfoHint> : t(`person.${key}`)}</span>
      <input
        className={inputClass}
        inputMode={opts?.inputMode}
        autoComplete="off"
        value={person[key]}
        onChange={(e) => setPerson((p) => ({ ...p, [key]: e.target.value }))}
      />
    </label>
  );
  const button = 'inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50';
  const insurerName = data?.insurers.find((i) => i.code === insurer)?.name;

  return (
    <section className="rounded-xl border border-border bg-card p-5 print:border-0 print:p-0">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 h-6 w-6 shrink-0 text-primary print:hidden" />
        <div>
          <h2 className="font-bold">{t('title', { year })}</h2>
          <p className="mt-1 text-sm text-muted-foreground print:hidden">{t('hint')}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 print:hidden">
        <label className="space-y-1">
          <span className="font-semibold">{t('year')}</span>
          <select className={inputClass} value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-semibold">{t('expenses')}</span>
          <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            {EXPENSE_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`modes.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-semibold">
            <InfoHint hint={t('basisHint')}>{t('basis')}</InfoHint>
          </span>
          <select className={inputClass} value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
            <option value="cash">{t('basisCash')}</option>
            <option value="accrual">{t('basisAccrual')}</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-semibold">
            <InfoHint hint={t('activityHint')}>{t('activity')}</InfoHint>
          </span>
          <select className={inputClass} value={activity} onChange={(e) => setActivity(e.target.value as typeof activity)}>
            <option value="H">{t('activityMain')}</option>
            <option value="V">{t('activitySecondary')}</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-semibold">{t('fromMonth')}</span>
          <select className={inputClass} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={String(i + 1)}>
                {new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(Date.UTC(2024, i, 15)))}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-semibold">
            <InfoHint hint={t('taxAdvancesHint')}>{t('taxAdvances')}</InfoHint>
          </span>
          <input className={inputClass} inputMode="numeric" value={taxAdvances} onChange={(e) => setTaxAdvances(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" />
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" checked={spouse} onChange={(e) => setSpouse(e.target.checked)} />
          <InfoHint hint={t('spouseHint')}>{t('spouse')}</InfoHint>
        </label>
      </div>

      {data === null && <p className="mt-4 text-sm text-destructive">{t('failed')}</p>}
      {data && (
        <>
          <div className="mt-5 grid gap-4 text-sm md:grid-cols-2">
            <div>
              <h3 className="mb-1 font-semibold">{t('dpfoTitle')}</h3>
              <div className="divide-y divide-border rounded-lg border border-border px-3">
                {DPFO_ROWS.filter((r) => r !== 'r61' || data.dpfo.rows.r61 > 0)
                  .filter((r) => r !== 'r65a' || spouse)
                  .map((r) =>
                    line(r, t(`dpfo.${r}`, { rate: data.dpfo.flatRate ?? 0 }), r === 'r64' || r === 'r65a' ? -data.dpfo.rows[r]! : data.dpfo.rows[r]!, DPFO_STRONG.has(r), t('rowNo', { n: r.slice(1) }))
                  )}
              </div>
            </div>
            <div>
              <h3 className="mb-1 font-semibold">{t('csszTitle')}</h3>
              {data.cssz.insured ? (
                <div className="divide-y divide-border rounded-lg border border-border px-3">
                  {CSSZ_ROWS.map((r) => line(r, t(`cssz.${r}`), data.cssz.rows[r]!, CSSZ_STRONG.has(r), t('rowNo', { n: r.slice(1) })))}
                </div>
              ) : (
                <p className="rounded-lg border border-border p-3 text-muted-foreground">{t('csszNotInsured')}</p>
              )}
              {!data.cssz.nextMinimumKnown && <p className="mt-2 text-xs text-warning">{t('nextUnknown')}</p>}
            </div>
            <div className="md:col-span-2">
              <h3 className="mb-1 font-semibold">{t('healthTitle')}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="divide-y divide-border rounded-lg border border-border px-3">
                  {HEALTH_ROWS.map((r) => line(r, t(`health.${r}`), data.health[r], HEALTH_STRONG.has(r)))}
                </div>
                <div className="space-y-2 text-muted-foreground">
                  <label className="block space-y-1 print:hidden">
                    <span className="font-semibold text-foreground">{t('insurer')}</span>
                    <select className={inputClass} value={insurer} onChange={(e) => setInsurer(e.target.value)}>
                      {data.insurers.map((i) => (
                        <option key={i.code} value={i.code}>
                          {i.code} {i.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="hidden font-semibold text-foreground print:block">
                    {insurer} {insurerName}
                  </p>
                  <p>{t('healthHowTo')}</p>
                </div>
              </div>
            </div>
          </div>
          {data.counts.missingRates > 0 && <p className="mt-2 text-xs text-warning">{t('missingRates', { count: data.counts.missingRates })}</p>}

          <details className="mt-5 rounded-lg border border-border p-3 text-sm print:hidden">
            <summary className="cursor-pointer font-semibold">{t('personTitle')}</summary>
            <p className="mt-2 text-xs text-muted-foreground">{t('personHint')}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {personField('birthNumber', { hint: t('person.birthNumberHint') })}
              {personField('taxOffice', { hint: t('person.taxOfficeHint'), inputMode: 'numeric' })}
              {personField('taxWorkplace', { inputMode: 'numeric' })}
              {personField('ossz', { hint: t('person.osszHint'), inputMode: 'numeric' })}
              {personField('variableSymbol', { hint: t('person.variableSymbolHint'), inputMode: 'numeric' })}
              {personField('dataBox')}
            </div>
          </details>

          <div className="mt-4 flex flex-wrap items-center gap-3 print:hidden">
            <button type="button" className={button} disabled={!data.forms.dpfdp || busy != null} onClick={() => download('dpfdp')}>
              <Download className="h-4 w-4" />
              {data.forms.dpfdp ? t('downloadDpfdp', { form: data.forms.dpfdp }) : t('dpfdpMissing')}
            </button>
            <button type="button" className={button} disabled={!data.forms.cssz || !data.cssz.insured || busy != null} onClick={() => download('osvc')}>
              <Download className="h-4 w-4" />
              {data.forms.cssz ? t('downloadCssz') : t('csszMissing')}
            </button>
            <button type="button" className={button} onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              {t('print')}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground print:hidden">
            <li>
              <a href="https://adisspr.mfcr.cz/pmd/epo/formulare" target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                {t('epoLink')}
              </a>
              {' – '}
              {t('epoHow')}
            </li>
            <li>
              <a href="https://eportal.cssz.cz/" target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                {t('csszLink')}
              </a>
              {' – '}
              {t('csszHow')}
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t('disclaimer')}</p>
        </>
      )}
    </section>
  );
}
