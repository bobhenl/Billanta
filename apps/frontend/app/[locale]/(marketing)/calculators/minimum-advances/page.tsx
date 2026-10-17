import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { minimumPeriods, minimumYears, type MinimumKind } from '@faktur/cz-compliance';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';

const SLUG = 'minimum-advances';
type Params = { locale: string };

const KINDS: Record<'CZ' | 'SK', MinimumKind[]> = { CZ: ['social', 'health', 'flat_tax'], SK: ['social', 'health'] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

/**
 * Minimum monthly advances, straight from the @faktur/cz-compliance table
 * the dashboard uses for its one-click suggestions. A reference table
 * rather than a form: there is nothing to type in. The Slovak copy shows
 * Slovakia first.
 */
export default async function MinimumsPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tools.calculators.items.minimums');
  const tc = await getTranslations('tools.common');
  const tVat = await getTranslations('tools.calculators.items.vat');
  const format = await getFormatter();
  const countries = locale === 'sk' ? (['SK', 'CZ'] as const) : (['CZ', 'SK'] as const);
  const years = [...new Set([...minimumYears('CZ'), ...minimumYears('SK')])].sort((a, b) => b - a);
  const month = (from: string) => format.dateTime(new Date(`${from}-01T12:00:00Z`), { month: 'long', year: 'numeric', timeZone: 'Europe/Prague' });

  return (
    <CalculatorPage
      slug={SLUG}
      locale={locale}
      validity={years.length ? tc('validFor', { year: years.join(', ') }) : undefined}
      after={
        <div className="grid max-w-4xl gap-8 md:grid-cols-2">
          {countries.map((country) => (
            <div key={country}>
              <h2 className="text-lg font-semibold">{t('notesTitle')} · {tVat(`countries.${country}`)}</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                {(t.raw(country === 'CZ' ? 'notesCz' : 'notesSk') as string[]).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {countries.map((country) => {
          const currency = country === 'CZ' ? 'CZK' : 'EUR';
          const digits = country === 'CZ' ? 0 : 2;
          return (
            <section key={country} className="overflow-x-auto rounded-xl border border-border bg-card p-5">
              <h2 className="font-semibold">{t(country === 'CZ' ? 'cz' : 'sk')}</h2>
              {years.map((year) => {
                const periods = minimumPeriods(country, year);
                if (periods.length === 0) return null;
                return (
                  <table key={year} className="mt-4 w-full text-sm">
                    <caption className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">{year}</caption>
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th scope="col" className="py-2 pr-3 font-medium">
                          {t('period')}
                        </th>
                        {KINDS[country].map((k) => (
                          <th key={k} scope="col" className="py-2 pl-3 text-right font-medium">
                            {t(`kinds.${k}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((p) => (
                        <tr key={p.from} className="border-b border-border last:border-0">
                          <th scope="row" className="py-2 pr-3 text-left font-medium">
                            {t('from', { date: month(p.from) })}
                          </th>
                          {KINDS[country].map((k) => (
                            <td key={k} className="py-2 pl-3 text-right tabular-nums">
                              {p.values[k] == null
                                ? '–'
                                : format.number(p.values[k]!, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })}
              {years.every((y) => minimumPeriods(country, y).length === 0) && <p className="mt-3 text-sm text-muted-foreground">{t('none')}</p>}
            </section>
          );
        })}
      </div>
    </CalculatorPage>
  );
}
