import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { CNB_DAILY_URL, cnbDate, parseCnbDay } from '@faktur/cz-compliance';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { FxConverter } from '@/components/public-tools/fx-converter';
import { FxDatePicker } from '@/components/public-tools/fx-date-picker';

const SLUG = 'cnb-exchange-rates';
/** ČNB publishes the daily list since 1991 (same bound as the backend's parseRateDate). */
const CNB_EARLIEST = '1991-01-01';

type Params = { locale: string };
type Props = { params: Promise<Params>; searchParams: Promise<{ date?: string | string[] }> };

/**
 * `?date=` makes this page render per request; the ČNB fetch below is what
 * is cached. Without the parameter it shows today's list as before.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const { date } = await searchParams;
  const metadata = await calculatorMetadata(SLUG, locale);
  // A dated view is a permutation of the same page: crawlable, so the link
  // works when shared, but only the undated page is indexed. The canonical
  // (from calculatorMetadata) stays the URL without the parameter.
  return date != null ? { ...metadata, robots: { index: false, follow: true } } : metadata;
}

/** Today in Prague as YYYY-MM-DD: ČNB's day, whatever the server's timezone. */
function pragueToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** A real calendar day between ČNB's first list and today, or null (then the page shows today). */
function parseDay(value: string | string[] | undefined, today: string): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  if (value < CNB_EARLIEST || value >= today) return null;
  return value;
}

/**
 * The list valid on `day` (today when null), parsed by the same
 * @faktur/cz-compliance code the backend uses for VAT conversion. ČNB
 * answers a weekend, holiday or not-yet-published day with the last
 * published list, and its header says which day that is. A past day's list
 * never changes, so it is cached for long; today's is refreshed hourly,
 * since ČNB publishes once per working day after 14:30. Null when ČNB is
 * unreachable.
 */
async function loadRates(day: string | null): Promise<{ date: string | null; rates: [string, number][] } | null> {
  try {
    const url = day ? `${CNB_DAILY_URL}?date=${cnbDate(new Date(`${day}T12:00:00`))}` : CNB_DAILY_URL;
    const res = await fetch(url, { next: { revalidate: day ? 30 * 86400 : 3600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const text = await res.text();
    const parsed = parseCnbDay(text);
    if (!parsed) return null;
    const rates = [...parsed.rates].map(([code, r]): [string, number] => [code, r.rate]).sort(([a], [b]) => a.localeCompare(b));
    return { date: parsed.date, rates };
  } catch {
    return null;
  }
}

export default async function FxPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tools.calculators.items.fx');
  const format = await getFormatter();
  const today = pragueToday();
  const day = parseDay((await searchParams).date, today);
  const data = await loadRates(day);
  const long = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'long', timeZone: 'Europe/Prague' });
  const listDate = data?.date ? long(data.date) : null;
  // The day asked for (or today) had no list of its own; say which one applies instead.
  const requested = day ?? today;
  const fallback = data?.date && data.date !== requested ? (day ? t('date.fallback', { day: long(day), date: listDate! }) : t('date.notYet', { date: listDate! })) : null;

  return (
    <CalculatorPage
      slug={SLUG}
      locale={locale}
      validity={listDate ? t('listDate', { date: listDate }) : undefined}
      after={
        data && (
          <div className="max-w-xl overflow-x-auto rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">
              {t('tableTitle')}
              {listDate && <span className="font-normal text-muted-foreground"> · {listDate}</span>}
            </h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">
                    {t('code')}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('perUnit')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rates.map(([code, rate]) => (
                  <tr key={code} className="border-b border-border last:border-0">
                    <th scope="row" className="py-1.5 text-left font-medium">
                      {code}
                    </th>
                    <td className="py-1.5 text-right tabular-nums">{format.number(rate, { minimumFractionDigits: 3, maximumFractionDigits: 5 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              <a href="https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/" target="_blank" rel="noopener" className="hover:text-foreground hover:underline">
                {t('source')}
              </a>
            </p>
          </div>
        )
      }
    >
      <div className="mb-6">
        <FxDatePicker value={day} max={today} min={CNB_EARLIEST} />
        {fallback && <p className="mt-2 text-sm text-muted-foreground">{fallback}</p>}
      </div>
      {data ? (
        <FxConverter rates={data.rates} />
      ) : (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">{t('unavailable')}</p>
      )}
    </CalculatorPage>
  );
}
