import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { TaxDeadlineKind } from '@faktur/cz-compliance';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { TaxCalendar } from '@/components/public-tools/tax-calendar';

const SLUG = 'tax-calendar';
type Params = { locale: string };

// The years offered roll over on 1 January.
export const revalidate = 86400;

/** Kinds explained under the calendar, in the order a visitor meets them. */
const EXPLAINED: Record<'CZ' | 'SK', TaxDeadlineKind[]> = {
  CZ: ['vat_monthly', 'vat_quarterly', 'vat_identified', 'ec_sales_list', 'health', 'social', 'flat_tax', 'income_tax', 'overviews', 'payroll', 'road_tax', 'property_tax'],
  SK: ['vat_monthly', 'vat_quarterly', 'vat_identified', 'ec_sales_list', 'health', 'social', 'income_tax', 'road_tax']
};

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function TaxCalendarPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'tools.calculators.items.taxCalendar' });
  const year = new Date().getFullYear();
  const country = locale === 'sk' ? 'SK' : 'CZ';
  return (
    <CalculatorPage
      slug={SLUG}
      locale={locale}
      disclaimer={t('disclaimer')}
      after={
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold">{t('explainedTitle', { country: t(`countries.${country}`) })}</h2>
          <dl className="mt-4 space-y-4">
            {EXPLAINED[country].map((k) => (
              <div key={k}>
                <dt className="font-medium">{t(`kinds.${country}.${k}`)}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`kindHints.${country}.${k}`)}</dd>
              </div>
            ))}
          </dl>
        </div>
      }
    >
      <TaxCalendar years={[year, year + 1]} defaultCountry={country} />
    </CalculatorPage>
  );
}
