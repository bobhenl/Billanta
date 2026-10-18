'use client';

import { useState, useTransition } from 'react';
import { Building2, CreditCard, ExternalLink, Loader2, Repeat, RotateCcw } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import type { PaidPlanKey, PlanSummary } from '@/lib/plan';
import { cn } from '@/lib/utils';
import { cancelSubscription, openPortal, requestBankTransfer, resumeSubscription, startCheckout, switchInterval, type SubscriptionInfo } from './actions';

type Currency = 'CZK' | 'EUR';
type Interval = 'month' | 'year';

interface Proforma {
  id: string;
  number: string;
  variableSymbol: string;
  plan: PaidPlanKey;
  months: number;
  currency: string;
  amountMinor: number;
  vatRate: number;
  totalMinor: number;
  status: 'pending' | 'paid' | 'canceled';
  dueDate: string;
  paidAt: string | null;
  createdAt: string;
  payment: {
    payee: { name: string; ico: string; dic: string | null; address: string | null; email: string | null };
    iban: string;
    bic: string | null;
    account: string | null;
    qrDataUrl: string;
  } | null;
}

export interface BillingStatus {
  plan: PlanSummary;
  subscriptionInterval: Interval | null;
  /** Set while a card subscription is the company's plan. */
  subscription: SubscriptionInfo | null;
  hasStripeCustomer: boolean;
  /** Card subscription prices, the headline. */
  prices: Record<PaidPlanKey, Record<Currency, { monthly: number; yearly: number }>>;
  /** The same per month when paid by bank transfer, with the surcharge. */
  transferPrices: Record<PaidPlanKey, Record<Currency, { monthly: number; yearly: number }>>;
  transferSurchargePercent: number;
  card: { enabled: boolean };
  bankTransfer:
    | {
        enabled: true;
        vatRate: number;
        amounts: Record<PaidPlanKey, { amountMinor: number; totalMinor: number }>;
        monthlyAmounts: Record<PaidPlanKey, { amountMinor: number; totalMinor: number }>;
      }
    | { enabled: false };
  proformas: Proforma[];
}

const PAID: PaidPlanKey[] = ['start', 'plus', 'business'];

/** Current plan, the plan picker (card or transfer) and the proformas. Paying is for owners and admins. */
export function BillingPanel({ status, locale, readOnly }: { status: BillingStatus; locale: string; readOnly: boolean }) {
  const t = useTranslations('billing');
  const format = useFormatter();
  const [interval, setInterval] = useState<Interval>('year');
  const [currency, setCurrency] = useState<Currency>(locale === 'cs' ? 'CZK' : 'EUR');
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const { plan } = status;
  const money = (minor: number, cur: string) => format.number(minor / 100, { style: 'currency', currency: cur });
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const planName = (key: string) => t(`planNames.${key}`);
  // A live Stripe subscription is changed or cancelled in the portal, not bought again.
  const subscribed = plan.source === 'subscription';
  // Proformas are in CZK only; the interval toggle picks a month or a year up front.
  const transferOk = status.bankTransfer.enabled && currency === 'CZK';
  const [confirmCancel, setConfirmCancel] = useState(false);
  const sub = subscribed ? status.subscription : null;
  const subPlan = plan.paidPlan && plan.paidPlan !== 'free' ? plan.paidPlan : null;
  const subInterval = sub?.interval ?? status.subscriptionInterval;
  const otherInterval: Interval | null = subInterval === 'month' ? 'year' : subInterval === 'year' ? 'month' : null;
  const subCurrency: Currency = sub?.currency ?? 'CZK';
  const switchPrice =
    subPlan && otherInterval
      ? money(otherInterval === 'year' ? status.prices[subPlan][subCurrency].yearly : status.prices[subPlan][subCurrency].monthly, subCurrency)
      : '';

  const fail = (code: string) => {
    const key = `errors.${code}`;
    toast({ text: t.has(key) ? t(key) : t('errors.generic'), tone: 'err' });
  };

  const act = (id: string, fn: () => Promise<{ ok: true; data: { url?: string } } | { ok: false; error: string }>, onOk?: () => void) => {
    setBusy(id);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setBusy(null);
        fail(r.error);
        return;
      }
      if (r.data.url) {
        window.location.assign(r.data.url);
        return;
      }
      setBusy(null);
      onOk?.();
    });
  };

  return (
    <div className="mt-6 flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('current.label')}</p>
        <p className="mt-1 text-xl font-bold">{planName(plan.plan)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {plan.source === 'trial' && plan.trial
            ? t('current.trial', { days: plan.trial.daysLeft, date: day(plan.trial.endsAt) })
            : plan.source === 'prepaid' && plan.prepaidUntil
              ? t('current.prepaid', { date: day(plan.prepaidUntil) })
              : plan.source === 'subscription'
                ? t(status.subscriptionInterval === 'year' ? 'current.subscriptionYear' : 'current.subscriptionMonth')
                : plan.trial && !plan.trial.active
                  ? t('current.trialEnded', { plan: planName(plan.trial.plan) })
                  : t('current.free')}
        </p>
        {plan.subscriptionStatus === 'past_due' && plan.source === 'subscription' && (
          <p className="mt-2 text-sm font-semibold text-warning">{t('current.pastDue')}</p>
        )}
        {sub && sub.cancelAt && <p className="mt-2 text-sm font-semibold text-warning">{t('sub.endsOn', { date: day(sub.cancelAt) })}</p>}
        {sub && !sub.cancelAt && sub.periodEnd && <p className="mt-2 text-sm text-muted-foreground">{t('sub.renewsOn', { date: day(sub.periodEnd) })}</p>}

        {sub && !readOnly && (
          <div className="mt-3 flex flex-col gap-3">
            {otherInterval && plan.subscriptionStatus !== 'past_due' && !sub.cancelAt && (
              <div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    act('interval', () => switchInterval(otherInterval), () =>
                      toast({ text: t('sub.switched', { interval: otherInterval }), tone: 'ok' })
                    )
                  }
                  className={buttonClass.secondary}
                >
                  {busy === 'interval' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Repeat className="h-4 w-4" aria-hidden="true" />}
                  {t(otherInterval === 'year' ? 'sub.switchToYear' : 'sub.switchToMonth', { price: switchPrice })}
                </button>
                <p className="mt-1 text-xs text-muted-foreground">{t('sub.switchNote')}</p>
              </div>
            )}
            {sub.cancelAt ? (
              <div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act('resume', resumeSubscription, () => toast({ text: t('sub.resumed'), tone: 'ok' }))}
                  className={buttonClass.primary}
                >
                  {busy === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                  {t('sub.resume')}
                </button>
              </div>
            ) : confirmCancel ? (
              <div className="rounded-lg border border-border p-3 text-sm">
                <p>{sub.periodEnd ? t('sub.cancelConfirm', { date: day(sub.periodEnd) }) : t('sub.cancelConfirmNoDate')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      act('cancel', cancelSubscription, () => {
                        setConfirmCancel(false);
                        toast({ text: t('sub.canceled'), tone: 'ok' });
                      })
                    }
                    className={buttonClass.danger}
                  >
                    {busy === 'cancel' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {t('sub.cancelYes')}
                  </button>
                  <button type="button" disabled={pending} onClick={() => setConfirmCancel(false)} className={buttonClass.ghost}>
                    {t('sub.keep')}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <button type="button" disabled={pending} onClick={() => setConfirmCancel(true)} className={buttonClass.ghost}>
                  {t('sub.cancel')}
                </button>
              </div>
            )}
          </div>
        )}

        {status.hasStripeCustomer && (
          <div className="mt-3">
            <button
              type="button"
              disabled={readOnly || pending}
              onClick={() => act('portal', openPortal)}
              className={buttonClass.secondary}
            >
              {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
              {t('portal')}
            </button>
            <p className="mt-1 text-xs text-muted-foreground">{t('portalHint')}</p>
          </div>
        )}
      </section>

      {!subscribed && (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold">{t('choose.title')}</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              <Toggle
                value={interval}
                onChange={setInterval}
                options={[
                  ['year', t('choose.yearly')],
                  ['month', t('choose.monthly')]
                ]}
              />
              <Toggle
                value={currency}
                onChange={setCurrency}
                options={[
                  ['CZK', 'CZK'],
                  ['EUR', 'EUR']
                ]}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <p className="flex items-start gap-2 rounded-lg bg-primary/[0.06] p-2.5">
              <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="block font-semibold">{t('choose.cardTitle')}</span>
                <span className="text-xs text-muted-foreground">{t('choose.cardBody')}</span>
              </span>
            </p>
            {status.bankTransfer.enabled && (
              <p className="flex items-start gap-2 rounded-lg border border-border p-2.5">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  <span className="block font-semibold">{t('choose.transferTitle')}</span>
                  <span className="text-xs text-muted-foreground">{t('choose.transferBody', { percent: status.transferSurchargePercent })}</span>
                </span>
              </p>
            )}
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {PAID.map((key) => {
              const price = status.prices[key][currency];
              const perMonth = interval === 'year' ? price.yearly : price.monthly;
              const total = interval === 'year' ? price.yearly * 12 : price.monthly;
              const tPrice = status.transferPrices[key][currency];
              const tTotal = interval === 'year' ? tPrice.yearly * 12 : tPrice.monthly;
              const current = plan.paidPlan === key;
              return (
                <li key={key} className={cn('flex flex-col rounded-lg border p-3', key === 'plus' ? 'border-primary/50' : 'border-border')}>
                  <p className="font-bold">{planName(key)}</p>
                  <p className="mt-1 text-lg font-extrabold">
                    {money(perMonth, currency)}
                    <span className="text-sm font-normal text-muted-foreground"> {t('choose.perMonth')}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {interval === 'year' ? t('choose.billedYearly', { total: money(total, currency) }) : t('choose.billedMonthly')}
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={readOnly || pending || !status.card.enabled}
                      onClick={() => act(`card-${key}`, () => startCheckout(key, interval, currency))}
                      className={key === 'plus' ? buttonClass.primary : buttonClass.secondary}
                    >
                      {busy === `card-${key}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CreditCard className="h-4 w-4" aria-hidden="true" />}
                      {current ? t('choose.renewCard') : t('choose.payCard')}
                    </button>
                    {transferOk && (
                      <>
                      <p className="mt-1 border-t border-border pt-2 text-xs text-muted-foreground">
                        {t('choose.transferPrice', { price: money(interval === 'year' ? tPrice.yearly : tPrice.monthly, currency), total: money(tTotal, currency) })}
                      </p>
                      <button
                        type="button"
                        disabled={readOnly || pending}
                        onClick={() =>
                          act(`bank-${key}`, () => requestBankTransfer(key, interval === 'year' ? 12 : 1), () => toast({ text: t('transfer.created'), tone: 'ok' }))
                        }
                        className={buttonClass.ghost}
                      >
                        {busy === `bank-${key}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Building2 className="h-4 w-4" aria-hidden="true" />}
                        {t('transfer.button')}
                      </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {!status.card.enabled && <p className="mt-3 text-sm text-muted-foreground">{t('choose.cardUnavailable')}</p>}
          <div className="mt-4 flex flex-col gap-1.5 text-xs text-muted-foreground">
            <p>{t(interval === 'year' ? 'terms.renewYearly' : 'terms.renewMonthly')}</p>
            <p>{t('terms.cancel')}</p>
            <p>{t('terms.methods')}</p>
            {status.bankTransfer.enabled && (
              <p>{t(!transferOk ? 'terms.transferCzkOnly' : interval === 'year' ? 'terms.transfer' : 'terms.transferMonthly', { percent: status.transferSurchargePercent })}</p>
            )}
            <p>{t('terms.vat')}</p>
          </div>
        </section>
      )}

      {status.proformas.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-bold">{t('transfer.title')}</h2>
          <ul className="mt-3 flex flex-col gap-4">
            {status.proformas.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {p.number} · {planName(p.plan)} · {t('transfer.months', { n: p.months })}
                  </span>
                  <span className={cn('text-xs font-semibold', p.status === 'paid' ? 'text-success' : 'text-muted-foreground')}>
                    {t(`transfer.status.${p.status}`)}
                  </span>
                </div>
                {p.payment && (
                  <div className="mt-3 flex flex-col gap-4 sm:flex-row">
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the backend */}
                    <img src={p.payment.qrDataUrl} alt={t('transfer.qrAlt')} width={160} height={160} className="h-40 w-40 shrink-0 rounded bg-white p-1" />
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">{t('transfer.amount')}</dt>
                      <dd className="font-bold">{money(p.totalMinor, p.currency)}</dd>
                      {p.vatRate > 0 && (
                        <>
                          <dt className="text-muted-foreground">{t('transfer.vat', { rate: p.vatRate })}</dt>
                          <dd>{money(p.totalMinor - p.amountMinor, p.currency)}</dd>
                        </>
                      )}
                      <dt className="text-muted-foreground">{t('transfer.vs')}</dt>
                      <dd className="font-mono font-bold">{p.variableSymbol}</dd>
                      {p.payment.account && (
                        <>
                          <dt className="text-muted-foreground">{t('transfer.account')}</dt>
                          <dd className="font-mono">{p.payment.account}</dd>
                        </>
                      )}
                      <dt className="text-muted-foreground">IBAN</dt>
                      <dd className="break-all font-mono">{p.payment.iban}</dd>
                      <dt className="text-muted-foreground">{t('transfer.due')}</dt>
                      <dd>{day(p.dueDate)}</dd>
                      <dt className="text-muted-foreground">{t('transfer.payee')}</dt>
                      <dd>
                        {p.payment.payee.name}, {t('transfer.ico')} {p.payment.payee.ico}
                        {p.payment.payee.dic ? `, ${t('transfer.dic')} ${p.payment.payee.dic}` : ''}
                        {p.payment.payee.address ? <span className="block text-muted-foreground">{p.payment.payee.address}</span> : null}
                      </dd>
                    </dl>
                  </div>
                )}
                {p.payment && <p className="mt-3 text-xs text-muted-foreground">{t('transfer.note')}</p>}
                {p.status === 'paid' && p.paidAt && <p className="mt-1 text-xs text-muted-foreground">{t('transfer.paidOn', { date: day(p.paidAt) })}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Toggle<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: [V, string][] }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-full border border-border p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn('rounded-full px-3 py-1 font-semibold', value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
