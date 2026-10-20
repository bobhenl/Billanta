'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { CalendarPlus, Download } from 'lucide-react';
import { Segmented } from '@/components/public-tools/fields';
import { cn } from '@/lib/utils';
import {
  CAL_COUNTRIES,
  CAL_ENTITIES,
  CAL_VAT,
  calendarFor,
  extrasFor,
  isConditional,
  isoDate,
  normalizeProfile,
  periodText,
  profileToParams,
  type CalCountry,
  type CalendarProfile,
  type CalExtra
} from '@/lib/tax-calendar';

/**
 * Twelve months of deadlines for the picked situation, computed in the
 * browser (nothing is sent anywhere), plus the subscription link to the
 * same calendar as an .ics feed. "Today" and the page origin are read after
 * mount, so the server render stays the same for every visitor.
 */
export function TaxCalendar({ years, defaultCountry }: { years: number[]; defaultCountry: CalCountry }) {
  const t = useTranslations('tools.calculators.items.taxCalendar');
  const locale = useLocale();
  const format = useFormatter();
  const [raw, setRaw] = useState<CalendarProfile>({ country: defaultCountry, entity: 'osvc', vat: 'none', extras: [] });
  const profile = normalizeProfile(raw);
  const [year, setYear] = useState(years[0]!);
  const [today, setToday] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setToday(isoDate(new Date()));
    setOrigin(window.location.origin);
  }, []);

  const entries = useMemo(() => calendarFor(profile, year), [profile.country, profile.entity, profile.vat, profile.extras.join(), year]);
  const next = today ? entries.find((e) => isoDate(e.date) >= today) : undefined;
  const months = Array.from({ length: 12 }, (_, m) => entries.filter((e) => e.date.getMonth() === m));

  const set = (patch: Partial<CalendarProfile>) => setRaw((p) => ({ ...p, ...patch }));
  const toggleExtra = (e: CalExtra) => set({ extras: raw.extras.includes(e) ? raw.extras.filter((x) => x !== e) : [...raw.extras, e] });

  const query = profileToParams(profile);
  query.set('lang', locale);
  const feedPath = `/api/public/tax-calendar.ics?${query}`;
  const webcal = origin ? `${origin.replace(/^https?:/, 'webcal:')}${feedPath}` : '';
  const google = webcal ? `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` : '';

  return (
    <div className="space-y-6">
      <form className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
        <Segmented
          label={t('fields.country')}
          value={profile.country}
          onChange={(country) => set({ country })}
          options={CAL_COUNTRIES.map((c) => ({ value: c, label: t(`countries.${c}`) }))}
        />
        <Segmented label={t('fields.year')} value={String(year)} onChange={(y) => setYear(Number(y))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
        <Segmented
          label={t('fields.entity')}
          value={profile.entity}
          onChange={(entity) => set({ entity })}
          options={CAL_ENTITIES.filter((e) => e !== 'flat' || profile.country === 'CZ').map((e) => ({ value: e, label: t(`entities.${profile.country}.${e}`) }))}
        />
        <Segmented label={t('fields.vat')} value={profile.vat} onChange={(vat) => set({ vat })} options={CAL_VAT.map((v) => ({ value: v, label: t(`vat.${v}`) }))} />
        {raw.entity === 'flat' && profile.entity !== 'flat' && profile.country === 'CZ' && (
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('flatNotPossible')}</p>
        )}
        {profile.country === 'CZ' && profile.entity === 'company' && profile.vat === 'quarterly' && (
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('khMonthly')}</p>
        )}
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">{t('fields.extras')}</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {extrasFor(profile.country).map((e) => (
              <label
                key={e}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
                  profile.extras.includes(e) ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={profile.extras.includes(e)} onChange={() => toggleExtra(e)} />
                {t(`extras.${e}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </form>

      <section aria-labelledby="tax-calendar-heading">
        <h2 id="tax-calendar-heading" className="text-xl font-semibold">
          {t('heading', { year, country: t(`countries.${profile.country}`) })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('count', { n: entries.length })}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {months.map((rows, m) => (
            <div key={m} className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-bold capitalize">{format.dateTime(new Date(year, m, 15), { month: 'long' })}</h3>
              {rows.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t('noDeadlines')}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {rows.map((e) => {
                    const iso = isoDate(e.date);
                    const past = today !== null && iso < today;
                    const isNext = next !== undefined && iso === isoDate(next.date);
                    const moved = e.date.getTime() !== e.statutory.getTime();
                    return (
                      <li
                        key={`${e.kind}-${iso}`}
                        className={cn('flex gap-3 rounded-lg p-2 text-sm', isNext && 'bg-primary/10 ring-1 ring-primary/40', past && 'opacity-50')}
                      >
                        <span className="w-12 shrink-0 text-center tabular-nums">
                          <span className="block text-base font-semibold leading-tight">{format.dateTime(e.date, { day: 'numeric', month: 'numeric' })}</span>
                          <span className="block text-xs text-muted-foreground">{format.dateTime(e.date, { weekday: 'short' })}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium">{t(`kinds.${profile.country}.${e.kind}`)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {periodText((k, v) => t(`period.${k}`, v), locale, e.kind, e.statutory)}
                            {moved && ` · ${t('movedShort', { date: format.dateTime(e.statutory, { day: 'numeric', month: 'numeric' }) })}`}
                          </span>
                          {isConditional(e.kind) && <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">{t(`onlyIf.${e.kind}`)}</span>}
                          {isNext && <span className="mt-0.5 block text-xs font-semibold text-primary">{t('nextBadge')}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CalendarPlus className="h-5 w-5 text-primary" aria-hidden="true" />
          {t('subscribe.title')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subscribe.text')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={webcal || feedPath}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            {t('subscribe.webcal')}
          </a>
          {google && (
            <a
              href={google}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-semibold hover:border-primary/40 hover:text-primary"
            >
              {t('subscribe.google')}
            </a>
          )}
          <a
            href={feedPath}
            download="tax-calendar.ics"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-semibold hover:border-primary/40 hover:text-primary"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('subscribe.download')}
          </a>
        </div>
        {webcal && (
          <label className="mt-4 block text-xs text-muted-foreground">
            {t('subscribe.urlLabel')}
            <input
              readOnly
              value={`${origin}${feedPath}`}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
            />
          </label>
        )}
      </section>
    </div>
  );
}
