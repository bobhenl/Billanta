import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { CNB_DAILY_URL, parseCnbListDate, parseCnbRates } from '@faktur/cz-compliance';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { FxConverter } from '@/components/public-tools/fx-converter';

const SLUG = 'kurzy-cnb';
type Params = { locale: string };

/** ČNB publishes once per working day after 14:30; an hourly refresh is plenty. */
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

/** Today's list, parsed by the same @faktur/cz-compliance code the backend uses for VAT conversion. Null when ČNB is unreachable. */
async function loadRates(): Promise<{ date: string | null; rates: [string, number][] } | null> {
  try {
    const res = await fetch(CNB_DAILY_URL, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const text = await res.text();
    const rates = [...parseCnbRates(text).entries()].sort(([a], [b]) => a.localeCompare(b));
    return rates.length ? { date: parseCnbListDate(text), rates } : null;
  } catch {
    return null;
  }
}

export default async function FxPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  const t = await getTranslations('tools.calculators.items.fx');
  const format = await getFormatter();
  const data = await loadRates();
  const listDate = data?.date ? format.dateTime(new Date(`${data.date}T12:00:00Z`), { dateStyle: 'long', timeZone: 'Europe/Prague' }) : null;

  return (
    <CalculatorPage
      slug={SLUG}
      locale={locale}
      validity={listDate ? t('listDate', { date: listDate }) : undefined}
      after={
        data && (
          <div className="max-w-xl overflow-x-auto rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold">{t('tableTitle')}</h2>
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
      {data ? (
        <FxConverter rates={data.rates} />
      ) : (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">{t('unavailable')}</p>
      )}
    </CalculatorPage>
  );
}
