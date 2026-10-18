import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SK_SZCO_PARAM_YEARS } from '@faktur/cz-compliance';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { AnnualEstimate } from '@/components/annual-estimate/annual-estimate';

const SLUG = 'slovak-self-employed-tax';
type Params = { locale: string };

// An example SZČO on the 60 % paušál, low enough for the 15 % rate and the
// health minimum, high enough to owe social insurance from July.
const EXAMPLE = { income: 30_000 };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function SzcoCalculatorPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const first = SK_SZCO_PARAM_YEARS[0]!;
  const latest = SK_SZCO_PARAM_YEARS[SK_SZCO_PARAM_YEARS.length - 1]!;
  const thisYear = new Date().getFullYear();
  // Default to the year whose return is filed next (the previous one), the
  // case people search for; the current year's figures are a forecast.
  const year = SK_SZCO_PARAM_YEARS.includes(thisYear - 1) ? thisYear - 1 : latest;
  const validity = t('tools.common.validFor', { year: first === latest ? String(first) : `${first}–${latest}` });
  return (
    <CalculatorPage slug={SLUG} locale={locale} validity={validity} disclaimer={t('annualEstimate.disclaimer')}>
      <AnnualEstimate country="SK" years={SK_SZCO_PARAM_YEARS} defaultYear={year} defaults={EXAMPLE} />
    </CalculatorPage>
  );
}
