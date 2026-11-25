import type { Metadata } from 'next';
import { ArrowLeft, ChevronLeft, ChevronRight, Lock, Wallet } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { Link, redirect } from '@/i18n/navigation';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { parsePeriod, periodQuery, shiftPeriod, switchKind, type NetIncomeReport, type Period, type PeriodKind } from '@/lib/net-income';
import { canManage, canWrite, fetchMyAccess } from '@/lib/tenant';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { NetIncomeView } from './net-income-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('netIncome');
  return { title: t('title') };
}

const KINDS: PeriodKind[] = ['month', 'quarter', 'year'];

/**
 * "Po zdanění": what is left of a month's, quarter's or year's paid income
 * after income tax, insurance and shared expenses, per partner, under the
 * company's own tax model. The backend computes it (net-income module).
 */
export default async function NetIncomePage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string; quarter?: string }> }) {
  const t = await getTranslations('netIncome');
  const locale = await getLocale();
  const period = parsePeriod(await searchParams);

  // Each partner's income and taxes are for owners and admins only (the backend refuses everyone else too).
  // Without access info the request below still gets the backend's answer.
  const access = await fetchMyAccess().catch(() => null);
  if (access && !canManage(access.role)) {
    return (
      <div className="mx-auto mt-6 max-w-lg rounded-xl border border-border bg-card p-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-bold">{t('noAccess.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('noAccess.body')}</p>
        <Link href="/reports" className={cn(buttonClass.secondary, 'mt-5')}>
          {t('back')}
        </Link>
      </div>
    );
  }

  let report: NetIncomeReport;
  try {
    report = await apiFetch<NetIncomeReport>(`/api/v1/net-income?${periodQuery(period)}`);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    const forbidden = error instanceof ApiError && error.status === 403;
    const unsupported = error instanceof ApiError && error.body.includes('country_not_supported');
    return (
      <Banner tone={error instanceof NoTenantError || unsupported || forbidden ? 'info' : 'err'} className="mt-6">
        {t(error instanceof NoTenantError ? 'noTenant' : unsupported ? 'notSupported' : forbidden ? 'noAccess.body' : 'loadError')}
      </Banner>
    );
  }

  const label = periodLabel(period, locale, t('quarterLabel', { q: period.n, year: period.year }));
  const href = (p: Period) => `/reports/net-income?${periodQuery(p)}`;
  const arrow = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-primary';

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('back')}
      </Link>
      <h1 className="mt-2 flex items-start gap-2 text-2xl font-extrabold tracking-tight">
        <Wallet className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <span>{t('title')}</span>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>

      {/* Links, not a form: the period lives in the URL so it can be shared and bookmarked. */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <nav aria-label={t('periodKindLabel')} className="inline-flex rounded-lg bg-secondary p-1">
          {KINDS.map((k) => (
            <Link
              key={k}
              href={href(switchKind(period, k))}
              aria-current={k === period.kind ? 'page' : undefined}
              className={cn(
                'flex min-h-9 items-center rounded-md px-3 text-sm font-semibold transition-colors',
                k === period.kind ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(`periodKind.${k}`)}
            </Link>
          ))}
        </nav>
        <div className="flex min-w-0 items-center gap-2">
          <Link href={href(shiftPeriod(period, -1))} className={arrow} aria-label={t('prev')}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <span className="min-w-[8.5rem] text-center text-base font-bold capitalize tabular-nums">{label}</span>
          <Link href={href(shiftPeriod(period, 1))} className={arrow} aria-label={t('next')}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <NetIncomeView
        key={periodQuery(period)}
        report={report}
        kind={period.kind}
        canEdit={access ? canManage(access.role) : false}
        canSplit={canWrite(access, 'invoices')}
      />
    </div>
  );
}

function periodLabel(p: Period, locale: string, quarter: string): string {
  if (p.kind === 'year') return String(p.year);
  if (p.kind === 'quarter') return quarter;
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(p.year, p.n - 1, 1));
}
