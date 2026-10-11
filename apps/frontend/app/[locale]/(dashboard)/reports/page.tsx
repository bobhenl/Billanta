import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { Link, redirect } from '@/i18n/navigation';
import { apiFetch, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { PERIOD_PRESETS, presetRange, type PeriodPreset } from '@/lib/period-presets';
import { PeriodReport } from '../dashboard/period-report';
import type { PeriodStats } from '../dashboard/types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reports');
  return { title: t('pageTitle') };
}

/**
 * Reports: the dashboard's period card at full size (all KPIs, top
 * customers), opened on `?period=` (a preset) or this year by default.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const t = await getTranslations('reports');
  const locale = await getLocale();
  const { period } = await searchParams;
  const preset: PeriodPreset = (PERIOD_PRESETS as readonly string[]).includes(period ?? '') ? (period as PeriodPreset) : 'thisYear';
  const { from, to } = presetRange(preset);
  let stats: PeriodStats;
  try {
    stats = await apiFetch<PeriodStats>(`/api/v1/dashboard/stats?from=${from}&to=${to}`);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return (
      <Banner tone={error instanceof NoTenantError ? 'info' : 'err'} className="mt-6">
        {t(error instanceof NoTenantError ? 'noTenant' : 'loadError')}
      </Banner>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('pageTitle')}</h1>
          <p className="mt-1 text-muted-foreground">{t('pageLead')}</p>
        </div>
        <Link href="/settings/exports" className="text-sm font-semibold text-primary hover:underline">
          {t('exportsLink')}
        </Link>
      </div>
      <PeriodReport key={preset} initial={stats} initialPreset={preset} />
    </div>
  );
}
