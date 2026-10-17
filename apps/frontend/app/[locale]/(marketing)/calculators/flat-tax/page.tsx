import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { CZ_TAX_YEAR_LIST, OSVC_PARAM_YEARS } from '@faktur/cz-compliance';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { FlatTaxCalculator } from '@/components/public-tools/flat-tax-calculator';
import { getCalculator, isPublishedIn } from '@/lib/public-tools';

const SLUG = 'flat-tax';
type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function FlatTaxPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  // sk: the Czech-rules notice only; the sk catalog has no body for this page.
  if (!isPublishedIn(getCalculator(SLUG)!, locale)) return <CalculatorPage slug={SLUG} locale={locale}>{null}</CalculatorPage>;
  const t = await getTranslations('tools');
  // Only years with both the paušální daň bands and OSVČ parameters to compare against.
  const years = CZ_TAX_YEAR_LIST.filter((y) => OSVC_PARAM_YEARS.includes(y));
  const conditions = t.raw('calculators.items.flatTax.conditions') as string[];
  return (
    <CalculatorPage
      slug={SLUG}
      locale={locale}
      validity={years.length ? t('common.validFor', { year: years.join(', ') }) : undefined}
      after={
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold">{t('calculators.items.flatTax.conditionsTitle')}</h2>
          <ul className="mt-4 space-y-3">
            {conditions.map((c) => (
              <li key={c} className="flex gap-3 text-sm leading-relaxed">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      }
    >
      <FlatTaxCalculator years={years} />
    </CalculatorPage>
  );
}
