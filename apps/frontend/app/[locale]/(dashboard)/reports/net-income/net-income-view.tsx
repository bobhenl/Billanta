'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { formatMoney } from '@/lib/invoice-ui';
import { formatKc, type NetIncomeLine, type NetIncomeReport, type PeriodKind, type Shares, type TaxPartner } from '@/lib/net-income';
import { cn } from '@/lib/utils';
import { setInvoicePartnerShares } from './actions';
import { SharesPicker } from './shares-picker';
import { TaxModelEditor } from './tax-model-editor';

const ROWS: { key: keyof NetIncomeLine; strong?: boolean; minus?: boolean }[] = [
  { key: 'income', strong: true },
  { key: 'flatExpenses', minus: true },
  { key: 'base' },
  { key: 'taxBeforeCredits' },
  { key: 'credits', minus: true },
  { key: 'incomeTax' },
  { key: 'social' },
  { key: 'health' },
  { key: 'taxes', strong: true },
  { key: 'sharedExpenses', minus: true },
  { key: 'net', strong: true }
];

export function NetIncomeView({ report, kind, canEdit, canSplit }: { report: NetIncomeReport; kind: PeriodKind; canEdit: boolean; canSplit: boolean }) {
  const t = useTranslations('netIncome');
  const locale = useLocale();
  const kc = (n: number) => formatKc(n, locale);
  const { result, model } = report;
  const many = result.partners.length > 1;
  const nameOf = (p: Pick<TaxPartner, 'name'>, i: number) => p.name || (many ? t('partnerFallback', { n: i + 1 }) : t('partnerMe'));
  const totals = result.totals;
  const monthName = (m: number) => new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(report.period.year, m - 1, 1));

  return (
    <>
      {report.missingRates > 0 && (
        <Banner tone="warn" className="mt-4">
          {t('missingRates', { count: report.missingRates })}
        </Banner>
      )}

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
              {ROWS.map((r) => (
                <tr key={r.key} className={cn('border-t border-border', r.strong && 'font-bold', r.key === 'net' && 'text-primary')}>
                  <th scope="row" className="sticky left-0 bg-card px-4 py-2 text-left font-[inherit]">
                    {t(`table.${r.key}`)}
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
            flat: model.flat_expense_percent,
            tax: model.income_tax_percent,
            socialBase: model.social_base_percent,
            socialRate: model.social_rate_percent,
            healthBase: model.health_base_percent,
            healthRate: model.health_rate_percent
          })}{' '}
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

      <TaxModelEditor initial={model} readOnly={!canEdit} />
    </>
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
  const count = report.invoices.length + report.extraIncome.length;

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
      {report.invoices.map((inv) => (
        <li key={inv.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {inv.number} · {inv.customer || '–'}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('list.paidOn', { date: day(inv.paidAt) })}
              {inv.currency !== 'CZK' && ` · ${formatMoney(inv.amount, inv.currency, locale)} · ${t(`list.source.${inv.source}`)}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 sm:justify-end">
            <span className="text-sm font-bold tabular-nums">{formatKc(inv.income, locale)}</span>
            {canSplit && (
              <span className="flex items-center gap-1">
                {pending && busy === inv.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                <SharesPicker partners={partners} value={inv.partnerShares} onChange={(s) => save(inv.id, s)} disabled={pending} label={t('list.splitLabel', { number: inv.number })} />
              </span>
            )}
          </div>
        </li>
      ))}
      {report.extraIncome.map((e) => (
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
      <div className="border-b border-border px-4 py-3">
        <InfoHint hint={t(report.vatPayer ? 'list.hintVat' : 'list.hint')} rowClassName="font-bold">
          {t('list.title', { count })}
        </InfoHint>
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
