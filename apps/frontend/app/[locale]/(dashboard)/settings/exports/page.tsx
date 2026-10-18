import type { Metadata } from 'next';
import { UserSearch } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { lookupCzOffices, type CzOfficeTable } from '@faktur/cz-compliance';
import czOffices from '@/data/cz-offices.json';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { checkedDate } from '@/lib/legislation-checked';
import { fetchTenant } from '@/lib/tenant';
import { SettingsHeader } from '@/components/settings-header';
import { AnnualFilings } from './annual-filings';
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
  const tDir = await getTranslations('accountantDirectory.promo');
  // The page works without it (CZ, nothing prefilled); the cards load their own figures.
  const tenant = await fetchTenant().catch(() => null);
  const sk = tenant?.addressCountry === 'SK';
  // Office codes from the address, looked up here so the 60 kB table never reaches the browser.
  const offices = tenant && !sk ? lookupCzOffices(czOffices as unknown as CzOfficeTable, tenant.addressPostalCode, tenant.addressCity) : null;
  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      <ExportPicker />
      <div className="mt-5">
        <VatFilings checked={await checkedDate('vat_forms')} />
      </div>
      <div className="mt-5">
        <EpoGuide />
      </div>
      <div className="mt-5">
        <AnnualSummary country={sk ? 'SK' : 'CZ'} />
      </div>
      {/* The DPFO and ČSSZ files are Czech forms; Slovak filing XML is not built. */}
      {!sk && (
        <div className="mt-5">
          <AnnualFilings prefill={{ taxOffice: offices?.taxOffice ?? null, taxWorkplace: offices?.taxWorkplace ?? null, ossz: offices?.ossz ?? null, dataBox: tenant?.dataBoxId ?? null }} />
        </div>
      )}
      {/* Exports are what people hand to an accountant, so this is where the question comes up. */}
      <aside className="mt-5 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
        <UserSearch className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex-1">
          <h2 className="font-bold">{tDir('title')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{tDir('body')}</p>
        </div>
        <Link href="/accountants" className={buttonClass.secondary}>
          {tDir('cta')}
        </Link>
      </aside>
    </div>
  );
}
