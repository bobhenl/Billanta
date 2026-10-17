import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { PlanSummary } from '@/lib/plan';
import { cn } from '@/lib/utils';

/** A trial that ended this long ago stops being mentioned in the shell. */
const ENDED_NOTICE_DAYS = 7;

/**
 * One quiet line above the page while the company tries a paid plan, and for
 * a week after the trial ends. It turns amber in the last 3 days. Companies
 * that already pay, or never had a trial, see nothing.
 */
export async function TrialBanner({ plan, now = new Date() }: { plan: PlanSummary | null | undefined; now?: Date }) {
  const trial = plan?.trial;
  if (!plan || !trial || plan.paidPlan) return null;
  const endedDaysAgo = (now.getTime() - new Date(trial.endsAt).getTime()) / 86_400_000;
  if (!trial.active && endedDaysAgo > ENDED_NOTICE_DAYS) return null;

  const t = await getTranslations('billing');
  const planName = t(`planNames.${trial.plan}`);
  const urgent = !trial.active || trial.daysLeft <= 3;
  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm',
        urgent ? 'border-warning/40 bg-warning/10' : 'border-border bg-secondary/60 text-muted-foreground'
      )}
    >
      <span>
        {trial.active ? t('trialBanner.active', { plan: planName, days: trial.daysLeft }) : t('trialBanner.ended', { plan: planName })}
      </span>
      <Link href="/billing" className="font-semibold text-primary hover:underline">
        {trial.active ? t('trialBanner.choose') : t('trialBanner.upgrade')}
      </Link>
    </div>
  );
}
