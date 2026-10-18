import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { OSVC_PARAM_YEARS } from '@faktur/cz-compliance';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { AnnualEstimate } from '@/components/annual-estimate/annual-estimate';

const SLUG = 'self-employed-tax';
type Params = { locale: string };

// The example the page has always opened with (60 % paušál); the dashboard
// card shows the company's own numbers in the same component.
const EXAMPLE = { income: 800_000 };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function OsvcCalculatorPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const first = OSVC_PARAM_YEARS[0]!;
  const latest = OSVC_PARAM_YEARS[OSVC_PARAM_YEARS.length - 1]!;
  const thisYear = new Date().getFullYear();
  const year = OSVC_PARAM_YEARS.includes(thisYear) ? thisYear : latest;
  // The year range comes from the same table the math uses; the widget
  // prints the exact parameters of the year picked.
  const validity = t('tools.common.validFor', { year: first === latest ? String(first) : `${first}–${latest}` });
  return (
    <CalculatorPage slug={SLUG} locale={locale} validity={validity} disclaimer={t('annualEstimate.disclaimer')} skAlternative="slovak-self-employed-tax">
      <AnnualEstimate country="CZ" years={OSVC_PARAM_YEARS} defaultYear={year} defaults={EXAMPLE} />
    </CalculatorPage>
  );
}
