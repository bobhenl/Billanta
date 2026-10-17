'use client';

import { useState, useTransition } from 'react';
import { Calculator, Check, Copy, Gift, Loader2, Users } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { cn } from '@/lib/utils';
import { redeemCredits, setReferralProgram } from './actions';

type Program = 'friend' | 'accountant';
type CreditPlan = 'start' | 'plus' | 'business';

export interface ReferralOverview {
  code: string;
  program: Program;
  canBeAccountant: boolean;
  balance: number;
  rewards: Record<Program, { welcome: number; reward: number }>;
  plans: Record<CreditPlan, { monthly: number; yearly: number }>;
  prepaid: { plan: CreditPlan; until: string } | null;
  invited: { createdAt: string; program: Program; paying: boolean; rewardCredits: number | null }[];
  stats: { invited: number; paying: number; earned: number };
  ledger: { id: string; amount: number; reason: string; plan: CreditPlan | null; months: number | null; createdAt: string }[];
}

const PLAN_KEYS: CreditPlan[] = ['start', 'plus', 'business'];

/** Invite link + programme switch + credit wallet. Spending and switching are for owners and admins. */
export function ReferralsPanel({ overview, link, readOnly }: { overview: ReferralOverview; link: string; readOnly: boolean }) {
  const t = useTranslations('referrals');
  const format = useFormatter();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const rewards = overview.rewards[overview.program];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ text: t('copyFailed'), tone: 'err' });
    }
  };

  const errorText = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : `${t('failed')}: ${code}`);

  const switchProgram = (program: Program) =>
    startTransition(async () => {
      setBusy(`program:${program}`);
      const result = await setReferralProgram(program);
      setBusy(null);
      if (!result.ok) return void toast({ text: errorText(result.error), tone: 'err' });
      toast({ text: t('program.saved'), tone: 'ok' });
      router.refresh();
    });

  const redeem = (plan: CreditPlan, months: 1 | 12) =>
    startTransition(async () => {
      setBusy(`${plan}:${months}`);
      const result = await redeemCredits(plan, months);
      setBusy(null);
      if (!result.ok) return void toast({ text: errorText(result.error), tone: 'err' });
      toast({
        text: t('redeem.done', { plan: t(`plans.${plan}`), until: format.dateTime(new Date(result.data.until), { dateStyle: 'medium' }) }),
        tone: 'ok'
      });
      router.refresh();
    });

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <h2 className="flex items-center gap-2 font-bold">
          <Gift className="h-5 w-5 text-primary" />
          {t('link.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('link.body', { welcome: rewards.welcome, reward: rewards.reward })}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={cn(inputClass, 'font-mono text-xs')} aria-label={t('link.title')} />
          <button type="button" onClick={copy} className={cn(buttonClass.primary, 'shrink-0')}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t('link.copied') : t('link.copy')}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('link.code', { code: overview.code })}</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: t('stats.balance'), value: t('credits', { credits: overview.balance }) },
          { label: t('stats.invited'), value: String(overview.stats.invited) },
          { label: t('stats.paying'), value: String(overview.stats.paying) }
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight">{s.value}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('program.title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('program.hint')}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(['friend', 'accountant'] as const).map((p) => {
            const Icon = p === 'friend' ? Users : Calculator;
            const disabled = readOnly || pending || (p === 'accountant' && !overview.canBeAccountant);
            return (
              <button
                key={p}
                type="button"
                disabled={disabled || overview.program === p}
                aria-pressed={overview.program === p}
                onClick={() => switchProgram(p)}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed',
                  overview.program === p ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50',
                  disabled && overview.program !== p && 'opacity-60'
                )}
              >
                {busy === `program:${p}` ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                <span>
                  <span className="block text-sm font-bold">{t(`program.${p}.title`)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t(`program.${p}.body`, { welcome: overview.rewards[p].welcome, reward: overview.rewards[p].reward })}
                  </span>
                  {p === 'accountant' && !overview.canBeAccountant && (
                    <span className="mt-1 block text-xs font-semibold text-muted-foreground">{t('errors.ico_required')}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('redeem.title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('redeem.hint')}</p>
        {overview.prepaid && (
          <p className="mt-3 rounded-lg bg-secondary/60 px-3 py-2 text-sm">
            {t('redeem.running', {
              plan: t(`plans.${overview.prepaid.plan}`),
              until: format.dateTime(new Date(overview.prepaid.until), { dateStyle: 'medium' })
            })}
          </p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {PLAN_KEYS.map((plan) => {
            const price = overview.plans[plan];
            const otherRunning = overview.prepaid !== null && overview.prepaid.plan !== plan;
            return (
              <div key={plan} className="rounded-lg border border-border p-3">
                <p className="font-bold">{t(`plans.${plan}`)}</p>
                <div className="mt-2 space-y-2">
                  {([1, 12] as const).map((months) => {
                    const cost = months === 12 ? price.yearly * 12 : price.monthly;
                    const enough = overview.balance >= cost;
                    return (
                      <button
                        key={months}
                        type="button"
                        disabled={readOnly || pending || !enough || otherRunning}
                        onClick={() => redeem(plan, months)}
                        className={cn(enough && !otherRunning ? buttonClass.primary : buttonClass.secondary, 'w-full !px-3 text-xs')}
                      >
                        {busy === `${plan}:${months}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {t('redeem.button', { months, credits: cost })}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {readOnly && <p className="mt-3 text-xs text-muted-foreground">{t('readOnly')}</p>}
      </section>
    </div>
  );
}
