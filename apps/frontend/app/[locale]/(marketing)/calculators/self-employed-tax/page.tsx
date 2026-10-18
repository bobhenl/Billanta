import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OSVC_PARAM_YEARS } from '@faktur/cz-compliance';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { OsvcCalculator } from '@/components/public-tools/osvc-calculator';

const SLUG = 'self-employed-tax';
type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function OsvcCalculatorPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  const t = await getTranslations('tools');
  const first = OSVC_PARAM_YEARS[0]!;
  const latest = OSVC_PARAM_YEARS[OSVC_PARAM_YEARS.length - 1]!;
  const thisYear = new Date().getFullYear();
  const year = OSVC_PARAM_YEARS.includes(thisYear) ? thisYear : latest;
  // The year range comes from the same table the math uses; the widget
  // prints the exact parameters of the year picked.
  const validity = t('common.validFor', { year: first === latest ? String(first) : `${first}–${latest}` });
  return (
    <CalculatorPage slug={SLUG} locale={locale} validity={validity}>
      <OsvcCalculator defaultYear={year} />
    </CalculatorPage>
  );
}
