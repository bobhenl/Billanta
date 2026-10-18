import type { Metadata } from 'next';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { QrPaymentGenerator } from '@/components/public-tools/qr-payment-generator';

const SLUG = 'qr-payment';
type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function QrPaymentPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  return (
    <CalculatorPage slug={SLUG} locale={locale} disclaimer={false} cta="invoice">
      <QrPaymentGenerator />
    </CalculatorPage>
  );
}
