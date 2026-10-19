import type { Metadata } from 'next';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { InvoiceRequirementsChecker } from '@/components/public-tools/invoice-requirements-checker';

const SLUG = 'invoice-requirements';
type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function InvoiceRequirementsPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  return (
    <CalculatorPage slug={SLUG} locale={locale} disclaimer={false} cta="invoice">
      <InvoiceRequirementsChecker defaultCountry={locale === 'sk' ? 'SK' : 'CZ'} />
    </CalculatorPage>
  );
}
