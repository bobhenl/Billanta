'use client';

import { useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SealedIncomeDoc } from '@faktur/cz-compliance';
import { AnnualEstimate, type EstimateCountry } from '@/components/annual-estimate/annual-estimate';
import { useVault } from '@/components/vault/vault-provider';
import { sealedYearIncome } from '@/lib/vault/sealed-exports';

/** What the card takes from the backend: the year's totals from paid invoices and expenses. */
interface Totals {
  year: number;
  income: number;
  actualExpenses: number;
  social: { paid: number | null };
  health: { paid: number | null };
  vatPayer: boolean;
  counts: { invoices: number; expenses: number; missingRates: number };
  /** Foreign documents at their own rate, or at the year's jednotný kurz (Settings → Faktury → Kurz). */
  rateMode?: 'daily' | 'annual';
  /** Where `paid` came from: the advances in Settings (each month as it applied then), or nothing. */
  paidSource?: Record<'social' | 'health', 'input' | 'settings' | null>;
  /** The plain documents' income before rounding; `income` leaves the sealed ones out. */
  plainIncome?: number;
  /** Documents with sealed amounts (Důvěrný režim), for this browser to open and add. */
  sealedDocs?: SealedIncomeDoc[];
}

/** The sealed documents opened for one year: the full income, or how many stayed shut. */
type Opened = { year: number; income: number | null; counts: Totals['counts']; missing: number };

/**
 * The yearly estimate on the company's own numbers. The backend only sums
 * the year (income, expenses, advances from Settings); the figures are the
 * same shared component and pure functions as the public calculators, under
 * the rules of the company's country.
 */
export function AnnualSummary({ country }: { country: EstimateCountry }) {
  const t = useTranslations('settings.exports.annual');
  const tSealed = useTranslations('vault.amounts');
  const { key, requestUnlock } = useVault();
  const [opened, setOpened] = useState<Opened | null>(null);
  const now = new Date();
  // Before the filing deadlines (spring) the previous year is the interesting one.
  const [year, setYear] = useState(now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear());
  const [data, setData] = useState<Totals | null | undefined>(undefined);
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  useEffect(() => {
    let alive = true;
    // The expense mode does not change the sums, so the card asks once per year.
    fetch(`/api/files/exports/annual-summary?${new URLSearchParams({ year: String(year), expenses: 'actual' })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: Totals | null) => alive && setData(json))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [year]);

  const sealedCount = data?.sealedDocs?.length ?? 0;
  useEffect(() => {
    if (!data || !key || !data.sealedDocs?.length || data.plainIncome == null) return;
    let alive = true;
    const inputs = { vatPayer: data.vatPayer, plainIncome: data.plainIncome, counts: data.counts, sealedDocs: data.sealedDocs };
    sealedYearIncome(key, inputs)
      .then((out) => alive && setOpened({ year: data.year, ...out }))
      .catch(() => alive && setOpened({ year: data.year, income: null, counts: data.counts, missing: data.sealedDocs!.length }));
    return () => {
      alive = false;
    };
  }, [data, key]);
  const open = sealedCount > 0 && opened?.year === data?.year ? opened : null;
  // A year short of its sealed income would understate the estimate, so the card waits for them all.
  const income = sealedCount === 0 ? data?.income : (open?.income ?? undefined);
  const counts = open && open.income != null ? open.counts : data?.counts;

  const fromSettings = (kind: 'social' | 'health') => (data?.paidSource?.[kind] === 'settings' ? data[kind].paid : null);
  const sk = country === 'SK';

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <Calculator className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="font-bold">{t(sk ? 'titleSk' : 'title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(sk ? 'hintSk' : 'hint')}</p>
        </div>
      </div>
      {data === null && <p className="mb-4 text-sm text-destructive">{t('failed')}</p>}
      {data !== undefined && (
        <AnnualEstimate
          country={country}
          years={years}
          defaultYear={year}
          onYearChange={setYear}
          busy={data?.year !== year || (sealedCount > 0 && !!key && !open)}
          defaultsKey={data ? `${data.year}${open?.income != null ? '-opened' : ''}` : 'none'}
          defaults={{
            income,
            actualExpenses: data?.actualExpenses,
            paidSocial: fromSettings('social'),
            paidHealth: fromSettings('health')
          }}
          incomeHint={data && counts ? t(data.vatPayer ? 'incomeHintVat' : 'incomeHint', { invoices: counts.invoices }) : undefined}
          paidNote={t('paidFromSettings')}
          notes={
            data && (
              <>
                {sealedCount > 0 && !key && (
                  <p className="mt-2 text-xs text-warning">
                    {tSealed('reportLocked')}{' '}
                    <button type="button" onClick={() => void requestUnlock()} className="font-semibold text-primary hover:underline">
                      {tSealed('unlock')}
                    </button>
                  </p>
                )}
                {open && open.income == null && <p className="mt-2 text-xs text-destructive">{tSealed('reportUnreadable', { count: open.missing })}</p>}
                {open && open.income != null && <p className="mt-2 text-xs text-muted-foreground">{tSealed('reportIncluded', { count: sealedCount })}</p>}
                {data.rateMode === 'annual' && <p className="mt-2 text-xs text-muted-foreground">{t('uniformRate', { year: data.year })}</p>}
                {counts && counts.missingRates > 0 && <p className="mt-2 text-xs text-warning">{t('missingRates', { count: counts.missingRates, source: sk ? 'ECB' : 'ČNB' })}</p>}
                <p className="mt-2 text-xs text-muted-foreground">{t('disclaimer')}</p>
              </>
            )
          }
          actions={
            sk ? null : (
              <a href="https://adisspr.mfcr.cz/pmd/epo/formulare" target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline">
                {t('epoLink')}
              </a>
            )
          }
        />
      )}
    </section>
  );
}
