'use client';

import { useEffect, useState, useTransition } from 'react';
import { Lightbulb, Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { formatMoney } from '@/lib/invoice-ui';
import { formatKc, type NetIncomeLine, type NetIncomeReport, type NetIncomeTip, type PeriodKind, type Shares, type TaxPartner, type PartnerMember } from '@/lib/net-income';
import { cn } from '@/lib/utils';
import { setInvoicePartnerShares } from './actions';
import { partnerColors, partnerTags, SharesPicker } from './shares-picker';
import { TaxModelEditor } from './tax-model-editor';

/** The lines the year's actual payments can replace; each gets a badge once any of them is entered. */
const ACTUAL_KEYS = ['incomeTax', 'social', 'health', 'refund'] as const;

const ROWS: { key: keyof NetIncomeLine; strong?: boolean; minus?: boolean }[] = [
  { key: 'income', strong: true },
  { key: 'flatExpenses', minus: true },
  { key: 'base' },
  { key: 'taxBeforeCredits' },
  { key: 'credits', minus: true },
  { key: 'incomeTax' },
  { key: 'social' },
  { key: 'health' },
  { key: 'refund' },
  { key: 'taxes', strong: true },
  { key: 'sharedExpenses', minus: true },
  { key: 'net', strong: true }
];

export function NetIncomeView({
  report,
  kind,
  canEdit,
  canSplit,
  members
}: {
  report: NetIncomeReport;
  kind: PeriodKind;
  canEdit: boolean;
  canSplit: boolean;
  members: PartnerMember[];
}) {
  const t = useTranslations('netIncome');
  const locale = useLocale();
  const kc = (n: number) => formatKc(n, locale);
  const { result, model, settings } = report;
  const many = result.partners.length > 1;
  const nameOf = (p: Pick<TaxPartner, 'name'>, i: number) => p.name || (many ? t('partnerFallback', { n: i + 1 }) : t('partnerMe'));
  const totals = result.totals;
  const actual = result.actual;
  // The doplatek / vrácení row only shows once it is entered.
  const rows = ROWS.filter((r) => r.key !== 'refund' || actual?.refund);
  const badge = (key: keyof NetIncomeLine) => {
    if (!actual || !(ACTUAL_KEYS as readonly string[]).includes(key)) return null;
    const real = actual[key as (typeof ACTUAL_KEYS)[number]];
    return (
      <span className={cn('ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold', real ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground')}>
        {t(real ? 'actual.badgeActual' : 'actual.badgeEstimate')}
      </span>
    );
  };
  const monthName = (m: number) => new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(report.period.year, m - 1, 1));

  return (
    <>
      {report.missingRates > 0 && (
        <Banner tone="warn" className="mt-4">
          {t('missingRates', { count: report.missingRates })}
        </Banner>
      )}

      <Tips report={report} nameOf={nameOf} canEdit={canEdit} />

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label={t('cards.income')} value={kc(totals.income)} />
        <Card label={t('cards.taxes')} value={kc(totals.taxes)} />
        <Card label={t('cards.afterTaxes')} value={kc(totals.income - totals.taxes)} />
        <Card label={t('cards.net')} value={kc(totals.net)} accent />
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <InfoHint hint={t(`creditsHint.${kind}`)} rowClassName="font-bold">
            {t(many ? 'table.titlePartners' : 'table.title')}
          </InfoHint>
        </div>
        {/* Wide with several partners: the table scrolls in its own box, never the page. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 bg-card px-4 py-2 font-semibold">{t('table.metric')}</th>
                {result.partners.map((p, i) => (
                  <th key={p.id} className="px-3 py-2 text-right font-semibold normal-case">
                    <span className="block text-sm text-foreground">{nameOf(p, i)}</span>
                    <span className="tabular-nums">{t('table.share', { percent: p.sharePercent })}</span>
                  </th>
                ))}
                {many && <th className="px-4 py-2 text-right font-semibold">{t('table.total')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={cn('border-t border-border', r.strong && 'font-bold', r.key === 'net' && 'text-primary')}>
                  <th scope="row" className="sticky left-0 bg-card px-4 py-2 text-left font-[inherit]">
                    {t(`table.${r.key}`)}
                    {badge(r.key)}
                  </th>
                  {result.partners.map((p) => (
                    <td key={p.id} className="px-3 py-2 text-right tabular-nums">
                      {r.minus && p[r.key] ? `− ${kc(p[r.key])}` : kc(p[r.key])}
                    </td>
                  ))}
                  {many && <td className="px-4 py-2 text-right tabular-nums">{r.minus && totals[r.key] ? `− ${kc(totals[r.key])}` : kc(totals[r.key])}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {t('formula', {
            flat: settings.flat_expense_percent,
            tax: settings.income_tax_percent,
            socialBase: settings.social_base_percent,
            socialRate: settings.social_rate_percent,
            healthBase: settings.health_base_percent,
            healthRate: settings.health_rate_percent
          })}{' '}
          {many && result.taxScope === 'one_person' && `${t('onePersonNote')} `}
          {actual && `${t(result.months < 12 ? 'actual.noteProrated' : 'actual.note', { year: report.period.year })} `}
          {t('estimateNote')}
        </p>
      </section>

      {report.byMonth && (
        <section className="mt-6 rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <InfoHint hint={t('months.hint')} rowClassName="font-bold">
              {t('months.title')}
            </InfoHint>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">{t('months.month')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('months.income')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('months.taxes')}</th>
                  <th className="px-4 py-2 text-right font-semibold">{t('months.net')}</th>
                </tr>
              </thead>
              <tbody>
                {report.byMonth.map((m) => (
                  <tr key={m.month} className={cn('border-t border-border', m.income === 0 && 'text-muted-foreground')}>
                    <td className="px-4 py-2 capitalize">{monthName(m.month)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kc(m.income)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kc(m.taxes)}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{kc(m.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <IncomeList report={report} canSplit={canSplit && many} nameOf={nameOf} kind={kind} />

      <TaxModelEditor initial={model} readOnly={!canEdit} year={report.period.year} members={members} activity={report.activity ?? null} />
    </>
  );
}

const DISMISSED_KEY = 'billanta.netIncomeTips.dismissed';
const tipKey = (tip: NetIncomeTip, year: number) => `${year}:${tip.code}:${'partnerId' in tip ? (tip.partnerId ?? '') : ''}`;

/** Opens the settings panel and scrolls to the field the tip is about. */
function openSettings(targetId: string) {
  const details = document.getElementById('tax-model');
  if (details instanceof HTMLDetailsElement) details.open = true;
  requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/** Hints computed by the backend for this model and period; each one can be hidden (per browser). */
function Tips({ report, nameOf, canEdit }: { report: NetIncomeReport; nameOf: (p: Pick<TaxPartner, 'name'>, i: number) => string; canEdit: boolean }) {
  const t = useTranslations('netIncome.tips');
  const locale = useLocale();
  const year = report.period.year;
  // Read after mount: the server render cannot see localStorage, and a mismatch would flash.
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]'));
    } catch {
      setDismissed([]);
    }
  }, []);
  if (!dismissed) return null;
  const tips = report.tips.filter((tip) => !dismissed.includes(tipKey(tip, year)));
  if (!tips.length) return null;

  const dismiss = (tip: NetIncomeTip) => {
    const next = [...dismissed, tipKey(tip, year)].slice(-200);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private mode: hidden for this visit only.
    }
  };
  const partnerName = (id: string | null) => {
    const i = report.model.partners.findIndex((p) => p.id === id);
    return i >= 0 ? nameOf(report.model.partners[i]!, i) : '';
  };
  const textOf = (tip: NetIncomeTip) => {
    switch (tip.code) {
      case 'year_settings_missing':
        return tip.from != null ? t('yearMissing', { year, from: tip.from }) : t('yearMissingDefault', { year });
      case 'partner_no_credits':
        return tip.partnerId ? t('noCredits', { name: partnerName(tip.partnerId) }) : t('noCreditsOne');
      case 'flat_cap_reached':
        return tip.partnerId ? t('capReached', { name: partnerName(tip.partnerId) }) : t('capReachedOne');
      case 'high_tax_band': {
        const limit = formatKc(tip.limit, locale);
        return tip.partnerId ? t('highBand', { name: partnerName(tip.partnerId), limit }) : t('highBandOne', { limit });
      }
      case 'single_earner':
        return t('singleEarner', { name: partnerName(tip.partnerId) });
    }
  };
  // A partner's credits sit in their row; everything else (rates, cap, scope, the one taxpayer's credits) in the year block.
  const targetOf = (tip: NetIncomeTip) => (tip.code === 'partner_no_credits' && tip.partnerId ? `partner-${tip.partnerId}` : 'net-income-settings');

  return (
    <section className="mt-5 rounded-xl border border-border bg-card" aria-labelledby="net-income-tips">
      <h2 id="net-income-tips" className="flex items-center gap-2 border-b border-border px-4 py-3 font-bold">
        <Lightbulb className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('title')}
      </h2>
      <ul className="divide-y divide-border">
        {tips.map((tip) => (
          <li key={tipKey(tip, year)} className="flex items-start gap-2 px-4 py-2.5 text-sm">
            <p className="min-w-0 flex-1">
              {textOf(tip)}{' '}
              {canEdit && tip.code !== 'high_tax_band' && (
                <button type="button" className="font-semibold text-primary underline" onClick={() => openSettings(targetOf(tip))}>
                  {t(tip.code === 'year_settings_missing' ? 'openYear' : 'open')}
                </button>
              )}
            </p>
            <button type="button" className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={t('dismiss')} onClick={() => dismiss(tip)}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('mt-1 truncate text-xl font-extrabold tabular-nums sm:text-2xl', accent && 'text-primary')}>{value}</p>
    </div>
  );
}

/** The period's income, like the rows of the spreadsheet, each with who it belongs to. */
function IncomeList({
  report,
  canSplit,
  nameOf,
  kind
}: {
  report: NetIncomeReport;
  canSplit: boolean;
  nameOf: (p: Pick<TaxPartner, 'name'>, i: number) => string;
  kind: PeriodKind;
}) {
  const t = useTranslations('netIncome');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const partners = report.model.partners.map((p, i) => ({ ...p, name: nameOf(p, i) }));
  const day = (ymd: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
  const tags = partnerTags(partners);
  const colors = partnerColors(partners);
  // One partner's invoices only (tag filter); the split itself is unchanged.
  const [only, setOnly] = useState<string | null>(null);
  const belongs = (shares: Shares | null, id: string) => ((shares ?? Object.fromEntries(partners.map((p) => [p.id, p.share])))[id] ?? 0) > 0;
  const invoices = only ? report.invoices.filter((inv) => belongs(inv.partnerShares ?? inv.claimedShares, only)) : report.invoices;
  const extra = only ? report.extraIncome.filter((e) => belongs(e.shares, only)) : report.extraIncome;
  const count = invoices.length + extra.length;

  const save = (id: string, shares: Shares | null) => {
    setBusy(id);
    start(async () => {
      const res = await setInvoicePartnerShares(id, shares);
      setBusy(null);
      if (!res.ok) {
        toast({ text: t('list.failed'), tone: 'err' });
        return;
      }
      toast({ text: t('list.saved'), tone: 'ok' });
      router.refresh();
    });
  };

  const body = (
    <ul className="divide-y divide-border">
      {invoices.map((inv) => (
        <li key={inv.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {inv.number} · {inv.customer || '–'}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('list.paidOn', { date: day(inv.paidAt) })}
              <span className="amount">{inv.currency !== 'CZK' && ` · ${formatMoney(inv.amount, inv.currency, locale)} · ${t(`list.source.${inv.source}`)}`}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 sm:justify-end">
            <span className="text-sm font-bold tabular-nums">{formatKc(inv.income, locale)}</span>
            {canSplit && (
              <span className="flex items-center gap-1">
                {pending && busy === inv.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                <SharesPicker partners={partners} value={inv.partnerShares} fallback={inv.claimedShares} onChange={(s) => save(inv.id, s)} disabled={pending} label={t('list.splitLabel', { number: inv.number })} />
              </span>
            )}
          </div>
        </li>
      ))}
      {extra.map((e) => (
        <li key={`extra-${e.index}`} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{e.label}</p>
            <p className="text-xs text-muted-foreground">
              {day(e.date)} · {t('list.extra')}
            </p>
          </div>
          <span className="shrink-0 text-sm font-bold tabular-nums">{formatKc(e.amount, locale)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="mt-6 rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <InfoHint hint={t(report.vatPayer ? 'list.hintVat' : 'list.hint')} rowClassName="font-bold">
          {t('list.title', { count })}
        </InfoHint>
        {partners.length > 1 && (
          <span role="group" aria-label={t('list.filter')} className="flex items-center gap-1">
            {[null, ...partners.map((p) => p.id)].map((id) => (
              <button
                key={id ?? 'all'}
                type="button"
                aria-pressed={only === id}
                title={id ? partners.find((p) => p.id === id)?.name : undefined}
                onClick={() => setOnly(id)}
                className={cn(
                  'h-6 min-w-6 rounded-md px-1.5 text-[11px] font-bold transition-colors',
                  only === id
                    ? id
                      ? colors[id]!.solid
                      : 'bg-primary text-primary-foreground'
                    : 'border border-border text-muted-foreground hover:bg-accent'
                )}
              >
                {id ? tags[id] : t('list.filterAll')}
              </button>
            ))}
          </span>
        )}
      </div>
      {count === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('list.empty')}</p>
      ) : kind === 'year' ? (
        // A year can be hundreds of rows: folded until asked for.
        <details>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-primary">{t('list.show', { count })}</summary>
          {body}
        </details>
      ) : (
        body
      )}
    </section>
  );
}
