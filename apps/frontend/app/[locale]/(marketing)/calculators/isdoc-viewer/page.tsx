import type { Metadata } from 'next';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { IsdocViewer } from '@/components/public-tools/isdoc-viewer';

const SLUG = 'isdoc-viewer';
type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function IsdocViewerPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  return (
    <CalculatorPage slug={SLUG} locale={locale} disclaimer={false} cta="invoice">
      <IsdocViewer />
    </CalculatorPage>
  );
}
