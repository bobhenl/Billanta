import type { Metadata } from 'next';
import { ArrowLeft, ChevronDown, Download, FileText } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  OSVC_FLAT_EXPENSE_CAPS,
  SK_FLAT_EXPENSE_CAP,
  SK_FLAT_EXPENSE_SHARE,
  taxReturnDeadlines,
  type FlatTaxComparison,
  type TaxReturnBasis,
  type TaxReturnDeadlineKind
} from '@faktur/cz-compliance';
import { Banner } from '@/components/banner';
import { InfoHint } from '@/components/info-hint';
import { settingsGate } from '@/components/settings-gate';
import { Link, redirect } from '@/i18n/navigation';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { formatMoney } from '@/lib/invoice-ui';
import { inAppCalculatorPath } from '@/lib/public-tools';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('taxReturn');
  return { title: t('metaTitle') };
}

/** `GET /api/v1/exports/tax-return-basis`: deadlines as calendar days (YYYY-MM-DD). */
type TaxReturnData = Omit<TaxReturnBasis, 'deadlines'> & {
  companyName: string;
  basis: 'cash' | 'accrual';
  vatPayer: boolean;
  flatTaxRegime: boolean;
  counts: { invoices: number; expenses: number; missingRates: number };
  deadlines: { kind: TaxReturnDeadlineKind; date: string }[];
};

const RATES = ['80', '60', '40', '30'] as const;
const CATEGORIES = ['material', 'services', 'software', 'travel', 'fuel', 'office', 'telecom', 'rent', 'marketing', 'other'];

/** Until June the return for last year is the live one; from July this year's running figures. */
function defaultYear(now: Date): number {
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
}

const day = (ymd: string, locale: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
const dayOf = (d: Date, locale: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);

/**
 * "Podklady pro daňové přiznání": the tax year's own figures laid out for
 * the income tax return, on every plan. The numbers come from the backend
 * (the company's paid invoices and expenses), the rates and limits from
 * @faktur/cz-compliance for that exact year. A basis, not tax advice.
 */
export default async function TaxReturnPage({ searchParams }: { searchParams: Promise<{ year?: string; rate?: string }> }) {
  const gate = await settingsGate('exports');
  if (gate) return gate;
  const t = await getTranslations('taxReturn');
  const tCat = await getTranslations('expenses.category');
  const locale = await getLocale();
  const sp = await searchParams;
  const now = new Date();
  const thisYear = now.getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  const asked = Number(sp.year);
  const year = years.includes(asked) ? asked : defaultYear(now);
  const rate = (RATES as readonly string[]).includes(sp.rate ?? '') ? (sp.rate as (typeof RATES)[number]) : '60';
  const query = `year=${year}&rate=${rate}`;

  let r: TaxReturnData;
  try {
    r = await apiFetch<TaxReturnData>(`/api/v1/exports/tax-return-basis?${query}`);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return (
      <Banner tone={error instanceof NoTenantError ? 'info' : 'err'} className="mt-6">
        {t(error instanceof NoTenantError ? 'noTenant' : error instanceof ApiError && error.status === 503 ? 'ratesUnavailable' : 'loadError')}
      </Banner>
    );
  }

  const sk = r.country === 'SK';
  const money = (n: number | null | undefined) => (n == null ? '–' : formatMoney(n, r.currency, locale));
  const category = (c: string | null) => (c == null ? t('uncategorised') : CATEGORIES.includes(c) ? tCat(c) : c);
  const href = (over: { year?: number; rate?: string }) => `/reports/tax-return?year=${over.year ?? year}${sk ? '' : `&rate=${over.rate ?? rate}`}`;
  const running = year === thisYear;
  const flatTax: FlatTaxComparison | null = r.flatTax;
  const flatTaxOption = flatTax?.options.find((o) => o.kind === 'flat_tax') ?? null;
  const czDeadlines = taxReturnDeadlines('CZ', year);
  const skDeadlines = taxReturnDeadlines('SK', year);
  const czk = (n: number) => formatMoney(n, 'CZK', locale);
  const eur = (n: number) => formatMoney(n, 'EUR', locale);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('back')}
      </Link>
      <h1 className="mt-2 flex items-start gap-2 text-2xl font-extrabold tracking-tight">
        <FileText className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <span>{t(sk ? 'titleSk' : 'title', { year })}</span>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('notAdvice')}</p>

      {/* Year and the downloads on one bar. Links, not a form: the page is a server component. */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentLinks label={t('yearLabel')} items={years.map((y) => ({ key: String(y), label: String(y), href: href({ year: y }), current: y === year }))} />
        <div className="flex flex-wrap gap-2">
          <a href={`/api/files/exports/tax-return-basis.pdf?${query}`} className={cn(buttonClass.primary, 'h-10')}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('downloadPdf')}
          </a>
          {/* The CSV is the secondary download; on a phone just its format name, so both fit beside the years. */}
          <a href={`/api/files/exports/tax-return-basis.csv?${query}`} aria-label={t('downloadCsv')} className={cn(buttonClass.secondary, 'h-10')}>
            <Download className="h-4 w-4" aria-hidden="true" />
            <span className="sm:hidden">CSV</span>
            <span className="hidden sm:inline">{t('downloadCsv')}</span>
          </a>
        </div>
      </div>
      {running && (
        <Banner tone="warn" className="mt-4">
          {t('runningYear', { year })}
        </Banner>
      )}

      {/* Income and expenses */}
      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t(r.basis === 'accrual' ? 'incomeAccrual' : 'income')}</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{money(r.income)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('invoiceCount', { count: r.counts.invoices })}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t('actualExpenses')}</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{money(r.actualExpenses)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('expenseCount', { count: r.counts.expenses })}</p>
        </div>
      </section>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(r.basis === 'accrual' ? 'basisAccrual' : 'basisCash')} {t(r.vatPayer ? 'vatPayerYes' : 'vatPayerNo')}
        {r.counts.missingRates > 0 && <> {t('missingRates', { count: r.counts.missingRates })}</>}
      </p>

      <Section title={t('categoriesTitle')}>
        {r.categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noExpenses')}</p>
        ) : (
          <dl className="divide-y divide-border text-sm">
            {r.categories.map((c) => (
              <Row key={c.category ?? ''} label={category(c.category)} value={money(c.amount)} />
            ))}
            <Row label={t('actualExpenses')} value={money(r.actualExpenses)} strong />
          </dl>
        )}
      </Section>

      {r.legalEntity ? (
        <Banner tone="info" className="mt-6">
          {t(sk ? 'legalEntitySk' : 'legalEntity')}
        </Banner>
      ) : (
        <>
          <Section title={t(sk ? 'flatTitleSk' : 'flatTitle')} lead={t(sk ? 'flatLeadSk' : 'flatLead')}>
            {/* All four rate rules behind one (i): choosing a rate needs them side by side. */}
            {!sk && (
              <div className="mb-3 space-y-1.5">
                {/* Label above the control, so on touch the opened list gets the full width. */}
                <InfoHint
                  label={t('rateLabel')}
                  hint={
                    <ul className="space-y-1">
                      {RATES.map((x) => (
                        <li key={x}>{t(`rates.${x}`)}</li>
                      ))}
                    </ul>
                  }
                >
                  <span className="text-sm font-semibold text-muted-foreground">{t('rateLabel')}</span>
                </InfoHint>
                <SegmentLinks label={t('rateLabel')} items={RATES.map((x) => ({ key: x, label: `${x} %`, href: href({ rate: x }), current: x === rate }))} />
              </div>
            )}
            <dl className="divide-y divide-border text-sm">
              {r.flatExpenses.map((f) => (
                <Row
                  key={f.rate}
                  label={t('flatRow', { rate: f.rate, cap: money(f.cap) })}
                  value={f.capped ? `${money(f.amount)} (${t('capped')})` : money(f.amount)}
                  strong={f.rate === r.chosen?.rate}
                />
              ))}
              <Row label={t('actualExpenses')} value={money(r.actualExpenses)} />
            </dl>
            {r.chosen && <p className="mt-3 rounded-lg bg-secondary p-3 text-sm font-semibold">{t(`better.${r.chosen.better}`, { rate: r.chosen.rate })}</p>}
          </Section>

          {r.params && r.options ? (
            <Section title={t('estimateTitle')} lead={t(sk ? 'estimateLeadSk' : 'estimateLead')}>
              {/* Two money columns beside wrapped labels; on a very narrow phone the table scrolls in its own box. */}
              <div className="overflow-x-auto">
                <div className="grid min-w-[18rem] grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-2 text-sm">
                  <span />
                  {r.options.map((o) => (
                    <span key={o.kind} className="text-right text-xs font-bold text-muted-foreground">
                      {t(`option.${o.kind}`)}
                    </span>
                  ))}
                  {(['expenses', 'profit', 'tax', 'social', 'health', 'total'] as const).map((k) => (
                    <EstimateRow key={k} label={t(sk && (k === 'social' || k === 'health') ? `${k}Sk` : k)} values={r.options!.map((o) => money(o[k]))} strong={k === 'total'} />
                  ))}
                </div>
              </div>
              {sk && <p className="mt-3 text-xs text-muted-foreground">{t('skInsuranceNote')}</p>}
            </Section>
          ) : (
            <Banner tone="info" className="mt-6">
              {t('noParams', { year })}
            </Banner>
          )}

          {/* Paušální daň: Czech sole traders only (§ 2a ZDP); Slovakia has none. */}
          {!sk && flatTax && flatTaxOption && (
            <Section title={t('flatTaxTitle')} lead={t('flatTaxLead')}>
              {flatTaxOption.available ? (
                <p className="text-sm">
                  {t('flatTaxBand', { band: flatTaxOption.band ?? 0, total: money(flatTaxOption.total) })}
                </p>
              ) : (
                <p className="text-sm">{t(`flatTaxNo.${flatTaxOption.reason ?? 'no_data'}`)}</p>
              )}
              <p className="mt-3 rounded-lg bg-secondary p-3 text-sm font-semibold">{t(`best.${flatTax.best}`)}</p>
              {r.flatTaxRegime && <p className="mt-3 text-sm text-muted-foreground">{t('inFlatTaxRegime')}</p>}
              <Link href={inAppCalculatorPath('flat-tax')!} className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
                {t('flatTaxCalculator')} →
              </Link>
            </Section>
          )}
        </>
      )}

      <Section title={t('deadlinesTitle')}>
        <dl className="divide-y divide-border text-sm">
          {r.deadlines.map((d) => (
            <Row key={d.kind} label={t(`deadline.${r.country}.${d.kind}`)} value={day(d.date, locale)} />
          ))}
        </dl>
      </Section>

      {/* The two systems side by side: the user often knows one and works in the other. Reference, so folded. */}
      <Section title={t('diffTitle')} folded>
        <div className="grid gap-x-3 gap-y-2 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)]">
          <span className="hidden sm:block" />
          <span className="hidden font-bold sm:block">{t('diff.cz')}</span>
          <span className="hidden font-bold sm:block">{t('diff.sk')}</span>
          <DiffRow
            label={t('diff.flatLabel')}
            cz={t('diff.flatCz', {
              caps: (Object.entries(OSVC_FLAT_EXPENSE_CAPS) as [string, number][])
                .sort((a, b) => Number(b[0]) - Number(a[0]))
                .map(([k, v]) => `${k} % (${czk(v)})`)
                .join(', ')
            })}
            sk={t('diff.flatSk', { rate: Math.round(SK_FLAT_EXPENSE_SHARE * 100), cap: eur(SK_FLAT_EXPENSE_CAP) })}
            czHead={t('diff.cz')}
            skHead={t('diff.sk')}
          />
          <DiffRow
            label={t('diff.deadlineLabel')}
            cz={t('diff.deadlineCz', { paper: dayOf(czDeadlines[0]!.date, locale), electronic: dayOf(czDeadlines[1]!.date, locale), advisor: dayOf(czDeadlines[2]!.date, locale) })}
            sk={t('diff.deadlineSk', { paper: dayOf(skDeadlines[0]!.date, locale), extended: dayOf(skDeadlines[1]!.date, locale) })}
            czHead={t('diff.cz')}
            skHead={t('diff.sk')}
          />
          <DiffRow label={t('diff.insuranceLabel')} cz={t('diff.insuranceCz')} sk={t('diff.insuranceSk')} czHead={t('diff.cz')} skHead={t('diff.sk')} />
          <DiffRow label={t('diff.flatTaxLabel')} cz={t('diff.flatTaxCz')} sk={t('diff.flatTaxSk')} czHead={t('diff.cz')} skHead={t('diff.sk')} />
          <DiffRow label={t('diff.formLabel')} cz={t('diff.formCz')} sk={t('diff.formSk')} czHead={t('diff.cz')} skHead={t('diff.sk')} />
        </div>
      </Section>

      <Section title={t('notesTitle')}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {!r.legalEntity && <li>{t(sk ? 'noteInsuranceSk' : 'noteInsurance')}</li>}
          {!r.legalEntity && r.params && <li>{t(sk ? 'noteEstimateSk' : 'noteEstimate')}</li>}
          <li>{t('noteData')}</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, lead, folded, children }: { title: string; lead?: string; folded?: boolean; children: React.ReactNode }) {
  if (folded)
    return (
      <details className="group mt-6 rounded-xl border border-border bg-card p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold [&::-webkit-details-marker]:hidden">
          {title}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        {lead && <p className="mt-1 text-sm text-muted-foreground">{lead}</p>}
        <div className="mt-3">{children}</div>
      </details>
    );
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      {/* The legal background of a section sits behind an (i); the figures are what the page is for. */}
      {lead ? (
        <InfoHint hint={lead}>
          <h2 className="font-bold">{title}</h2>
        </InfoHint>
      ) : (
        <h2 className="font-bold">{title}</h2>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A segmented control for a server page: each option is a link that changes the query. */
function SegmentLinks({ label, items }: { label: string; items: { key: string; label: string; href: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex w-fit max-w-full rounded-lg border border-border bg-secondary p-0.5">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.current ? 'page' : undefined}
          className={cn(
            'flex min-h-9 items-center rounded-md px-3 text-sm font-semibold tabular-nums transition-colors',
            i.current ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-2', strong && 'font-bold')}>
      <dt className="min-w-0">{label}</dt>
      <dd className="shrink-0 text-right tabular-nums">{value}</dd>
    </div>
  );
}

function EstimateRow({ label, values, strong }: { label: string; values: string[]; strong?: boolean }) {
  return (
    <>
      <span className={cn('min-w-0', strong && 'font-bold')}>{label}</span>
      {values.map((v, i) => (
        <span key={i} className={cn('text-right tabular-nums', strong && 'font-bold')}>
          {v}
        </span>
      ))}
    </>
  );
}

/** One difference: three columns from sm up, stacked with the country names on a phone. */
function DiffRow({ label, cz, sk, czHead, skHead }: { label: string; cz: string; sk: string; czHead: string; skHead: string }) {
  return (
    <>
      <span className="mt-2 font-semibold sm:mt-0">{label}</span>
      <span>
        <span className="font-semibold sm:hidden">{czHead}: </span>
        {cz}
      </span>
      <span>
        <span className="font-semibold sm:hidden">{skHead}: </span>
        {sk}
      </span>
    </>
  );
}
