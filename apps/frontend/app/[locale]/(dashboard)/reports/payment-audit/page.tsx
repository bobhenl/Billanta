import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Lock, SearchCheck } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { Link, redirect } from '@/i18n/navigation';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import { parseAuditYear, type PaymentAuditResponse } from '@/lib/payment-audit';
import { canManage, fetchMyAccess } from '@/lib/tenant';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { PaymentAuditView } from './payment-audit-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('paymentAudit');
  return { title: t('title') };
}

/**
 * "Roční audit plateb": every invoice of the year against the money that
 * really arrived, and the incoming money no invoice explains. The backend
 * builds it from the stored bank pairing (payment-audit module); with sealed
 * amounts the browser does, from the same inputs.
 */
export default async function PaymentAuditPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const t = await getTranslations('paymentAudit');
  const year = parseAuditYear((await searchParams).year);

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

  const arrow = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-primary';
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('back')}
      </Link>
      <h1 className="mt-2 flex items-start gap-2 text-2xl font-extrabold tracking-tight">
        <SearchCheck className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <span>{t('title')}</span>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>

      {/* The year lives in the URL so the page can be shared and bookmarked. */}
      <div className="mt-5 flex items-center gap-2" aria-label={t('yearLabel')}>
        <Link href={`/reports/payment-audit?year=${year - 1}`} className={arrow} aria-label={t('prev')}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <span className="min-w-[5rem] text-center text-base font-bold tabular-nums">{year}</span>
        <Link href={`/reports/payment-audit?year=${year + 1}`} className={arrow} aria-label={t('next')}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <Suspense key={year} fallback={<ReportPlaceholder />}>
        <Report year={year} />
      </Suspense>
    </div>
  );
}

async function Report({ year }: { year: number }) {
  const t = await getTranslations('paymentAudit');
  const locale = await getLocale();
  const result = await apiFetch<PaymentAuditResponse>(`/api/v1/payment-audit?year=${year}`).then(
    (report) => ({ report }),
    (error: unknown) => ({ error })
  );
  if ('error' in result) {
    const { error } = result;
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    const forbidden = error instanceof ApiError && error.status === 403;
    return (
      <Banner tone={error instanceof NoTenantError || forbidden ? 'info' : 'err'} className="mt-6">
        {t(error instanceof NoTenantError ? 'noTenant' : forbidden ? 'noAccess.body' : 'loadError')}
      </Banner>
    );
  }
  return <PaymentAuditView report={result.report} />;
}

function ReportPlaceholder() {
  return (
    <div className="mt-6 animate-pulse space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-secondary" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-secondary" />
    </div>
  );
}
