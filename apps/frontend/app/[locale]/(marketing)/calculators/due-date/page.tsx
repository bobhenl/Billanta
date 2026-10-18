import type { Metadata } from 'next';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { DueDateCalculator } from '@/components/public-tools/due-date-calculator';

const SLUG = 'due-date';
type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function DueDatePage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  return (
    <CalculatorPage slug={SLUG} locale={locale} disclaimer={false} cta="invoice">
      <DueDateCalculator defaultCountry={locale === 'sk' ? 'SK' : 'CZ'} />
    </CalculatorPage>
  );
}
