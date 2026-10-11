'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, ExternalLink, Inbox, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { nextCzechWorkingDay } from '@faktur/cz-compliance';
import { InfoHint } from '@/components/info-hint';
import { cn } from '@/lib/utils';

const EPO_URL = 'https://adisspr.mfcr.cz/pmd/epo/formulare';
const MOJE_DANE_URL = 'https://adisspr.mfcr.cz/pmd/home';
const DS_URL = 'https://www.mojedatovaschranka.cz/';
const FU_DS_URL = 'https://financnisprava.gov.cz/cs/financni-sprava/organizace-a-struktura/financni-urady';

type Channel = 'ds' | 'epo' | 'mojeDane';

/**
 * How to file the DPHDP3 / DPHKH1 / DPHSHV files exported above: the three
 * channels Finanční správa accepts electronically (datová schránka with the
 * XML attached, EPO web form + DS login or a certificate, the MOJE daně
 * portal with bank/eObčanka identity), step by step, plus the next deadlines
 * (25th of the following month, moved to the next working day — § 33 DŘ).
 * Informational only: nothing is sent from here.
 */
export function EpoGuide() {
  const t = useTranslations('settings.exports.epo');
  const locale = useLocale();
  const [channel, setChannel] = useState<Channel>('ds');
  const [open, setOpen] = useState(true);

  const deadlines = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // This month's 25th if still ahead, else next month's.
    let monthly = nextCzechWorkingDay(new Date(now.getFullYear(), now.getMonth(), 25));
    if (monthly < today) monthly = nextCzechWorkingDay(new Date(now.getFullYear(), now.getMonth() + 1, 25));
    const periodOf = (d: Date) => new Date(d.getFullYear(), d.getMonth() - 1, 1);
    // Quarterly payers: 25th of Jan/Apr/Jul/Oct.
    let q = Math.floor(now.getMonth() / 3) * 3;
    let quarterly = nextCzechWorkingDay(new Date(now.getFullYear(), q, 25));
    if (quarterly < today) {
      q += 3;
      quarterly = nextCzechWorkingDay(new Date(now.getFullYear(), q, 25));
    }
    const qPeriod = new Date(quarterly.getFullYear(), quarterly.getMonth() - 3, 1);
    const days = (d: Date) => Math.round((d.getTime() - today.getTime()) / 86_400_000);
    return {
      monthly: { date: monthly, period: periodOf(monthly), days: days(monthly) },
      quarterly: { date: quarterly, quarter: Math.floor(qPeriod.getMonth() / 3) + 1, year: qPeriod.getFullYear(), days: days(quarterly) }
    };
  }, []);

  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const steps = t.raw(`channels.${channel}.steps`) as string[];
  const link = 'inline-flex items-center gap-1 font-semibold text-primary hover:underline';

  return (
    <section id="epo" className="scroll-mt-20 rounded-xl border border-border bg-card p-5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 text-left">
        <Send className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <span className="flex-1">
          <span className="block font-bold">{t('title')}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{t('lead')}</span>
        </span>
        <ChevronDown className={cn('mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <InfoHint hint={t('deadlines.monthlyHint')} rowClassName="font-semibold">
                <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
                {t('deadlines.monthly', { period: monthFmt.format(deadlines.monthly.period) })}
              </InfoHint>
              <p className="mt-1">
                {dateFmt.format(deadlines.monthly.date)} · <span className="text-muted-foreground">{t('deadlines.in', { count: deadlines.monthly.days })}</span>
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <InfoHint hint={t('deadlines.quarterlyHint')} rowClassName="font-semibold">
                <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
                {t('deadlines.quarterly', { q: deadlines.quarterly.quarter, year: deadlines.quarterly.year })}
              </InfoHint>
              <p className="mt-1">
                {dateFmt.format(deadlines.quarterly.date)} · <span className="text-muted-foreground">{t('deadlines.in', { count: deadlines.quarterly.days })}</span>
              </p>
            </div>
          </div>

          <div className="mt-4">
            <InfoHint hint={t('channelHint')} className="text-sm font-semibold">
              {t('channelTitle')}
            </InfoHint>
            <div role="tablist" className="mt-2 flex flex-wrap gap-1.5">
              {(['ds', 'epo', 'mojeDane'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={channel === c}
                  onClick={() => setChannel(c)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm transition-colors',
                    channel === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary'
                  )}
                >
                  {t(`channels.${c}.name`)}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t(`channels.${channel}.when`)}</p>
            <ol className="mt-3 space-y-2 text-sm">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {channel === 'ds' && (
                <>
                  <a href={DS_URL} target="_blank" rel="noreferrer" className={link}>
                    <Inbox className="h-3.5 w-3.5" />
                    mojedatovaschranka.cz
                  </a>
                  <a href={FU_DS_URL} target="_blank" rel="noreferrer" className={link}>
                    {t('links.fuList')}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </>
              )}
              {channel !== 'mojeDane' && (
                <a href={EPO_URL} target="_blank" rel="noreferrer" className={link}>
                  {t('links.epo')}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {channel === 'mojeDane' && (
                <a href={MOJE_DANE_URL} target="_blank" rel="noreferrer" className={link}>
                  {t('links.mojeDane')}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="font-semibold">{t('tips.title')}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {(t.raw('tips.items') as string[]).map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
