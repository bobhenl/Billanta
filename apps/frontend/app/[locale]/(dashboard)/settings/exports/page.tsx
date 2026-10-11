import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SettingsHeader } from '@/components/settings-header';
import { AnnualSummary } from './annual-summary';
import { ExportPicker } from './export-picker';
import { VatFilings } from './vat-filings';
import { EpoGuide } from './epo-guide';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.exports');
  return { title: t('title') };
}

export default async function ExportsPage() {
  const t = await getTranslations('settings.exports');
  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <ExportPicker />
      <div className="mt-5">
        <VatFilings />
      </div>
      <div className="mt-5">
        <EpoGuide />
      </div>
      <div className="mt-5">
        <AnnualSummary />
      </div>
    </div>
  );
}
