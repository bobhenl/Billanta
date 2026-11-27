'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { PaidPlanKey } from '@/lib/plan';
import type { FeatureUsage, UsageMeter } from '@/lib/usage';
import { cn } from '@/lib/utils';

/** The one lock every plan-gated control shows: "From the Plus plan", linking to billing. */
export function PlanLock({ plan, className }: { plan: PaidPlanKey; className?: string }) {
  const t = useTranslations('planLimits');
  return (
    <Link
      href="/billing"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-primary',
        className
      )}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      {t('from', { plan: t(`plans.${plan}`) })}
    </Link>
  );
}

/** Lock plus what's left of the free try, or nothing when the plan includes the feature. */
export function FeatureBadge({ usage, className }: { usage: FeatureUsage | null | undefined; className?: string }) {
  const t = useTranslations('planLimits');
  if (!usage || usage.access === 'plan') return null;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {usage.access === 'taste' && <span className="text-xs text-muted-foreground">{t('tasteLeft', { left: usage.tasteLeft ?? 0 })}</span>}
      <PlanLock plan={usage.plan} />
    </span>
  );
}

/** "7 of 10 documents this month" for a plan that caps them; nothing otherwise. */
export function DocumentsMeter({ meter, className }: { meter: UsageMeter | null | undefined; className?: string }) {
  const t = useTranslations('planLimits');
  if (!meter || meter.limit === null) return null;
  const out = (meter.remaining ?? 0) <= 0;
  return (
    <p className={cn('flex flex-wrap items-center gap-2 text-sm', out ? 'text-destructive' : 'text-muted-foreground', className)}>
      <span>{t('documents', { used: meter.used, limit: meter.limit })}</span>
      {out && <PlanLock plan="start" />}
    </p>
  );
}
