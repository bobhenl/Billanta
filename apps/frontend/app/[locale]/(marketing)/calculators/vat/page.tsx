import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { VAT_RATES } from '@faktur/cz-compliance';
import { EmbedSection } from '@/components/embed-section';
import { CalculatorPage, calculatorMetadata } from '@/components/public-tools/calculator-page';
import { VatCalculator } from '@/components/public-tools/vat-calculator';

const SLUG = 'vat';
type Params = { locale: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return calculatorMetadata(SLUG, locale);
}

export default async function VatCalculatorPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tools');
  const format = await getFormatter();
  const since = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: 'long', timeZone: 'Europe/Prague' });
  const validity = (['CZ', 'SK'] as const)
    .map((c) => `${t(`calculators.items.vat.countries.${c}`)}: ${VAT_RATES[c].rates.join(', ')} %. ${t('common.ratesSince', { date: since(VAT_RATES[c].since) })}`)
    .join(' ');
  return (
    <CalculatorPage slug={SLUG} locale={locale} validity={validity} after={<EmbedSection section="calculator" tabs={['vat']} />}>
      <VatCalculator defaultCountry={locale === 'sk' ? 'SK' : 'CZ'} />
    </CalculatorPage>
  );
}
