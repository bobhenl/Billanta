import type { Metadata } from 'next';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { VatReliability } from '@/components/public-tools/vat-reliability';

const SLUG = 'unreliable-vat-payer';
type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function UnreliableVatPayerPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  return (
    <CalculatorPage slug={SLUG} locale={locale} disclaimer={false}>
      <VatReliability />
    </CalculatorPage>
  );
}
