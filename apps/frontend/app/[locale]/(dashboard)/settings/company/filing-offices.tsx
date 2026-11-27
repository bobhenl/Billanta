'use client';

import { useTranslations } from 'next-intl';
import { CZ_HEALTH_INSURERS, CZ_SOCIAL_OFFICES, CZ_TAX_OFFICES, czTaxWorkplace, czTaxWorkplacesOf } from '@faktur/cz-compliance';
import { InfoHint } from '@/components/info-hint';
import { inputClass } from '@/components/modal';

/** The company-form fields this section edits, all kept as strings like the rest of the form. */
export const FILING_OFFICE_FIELDS = {
  taxOffice: 'tax_office',
  taxWorkplace: 'tax_workplace',
  healthInsurer: 'health_insurer',
  socialOffice: 'social_office',
  residenceStreet: 'residence_street',
  residenceCity: 'residence_city',
  residencePostalCode: 'residence_postal_code'
} as const;
export type FilingOfficeField = keyof typeof FILING_OFFICE_FIELDS;
/** Sent as numbers: the backend validates them against the official code lists. */
export const NUMERIC_FILING_FIELDS: ReadonlySet<string> = new Set(['taxOffice', 'taxWorkplace', 'socialOffice']);

/**
 * Offices and the trvalý pobyt for the CZ filings. EPO requires c_ufo in the
 * VAT files and takes the address of a natural person from the residence
 * (§ 13 daňového řádu); the insurer and OSSZ prefill the yearly přehledy.
 * Codes come from the official ADIS and ČSSZ lists in cz-compliance.
 */
export function FilingOffices({
  values,
  onChange,
  naturalPerson,
  readOnly
}: {
  values: Record<FilingOfficeField, string>;
  onChange: (patch: Partial<Record<FilingOfficeField, string>>) => void;
  naturalPerson: boolean;
  readOnly: boolean;
}) {
  const t = useTranslations('settings.company.filingOffices');
  const tc = useTranslations('settings.company');
  const office = values.taxOffice ? Number(values.taxOffice) : null;
  const workplaces = czTaxWorkplacesOf(office);
  // EPO rejects a pracoviště of another office, so switching the office drops one that no longer fits.
  const set = (key: FilingOfficeField, value: string) =>
    onChange(
      key === 'taxOffice'
        ? { taxOffice: value, taxWorkplace: value && czTaxWorkplace(Number(values.taxWorkplace))?.office === Number(value) ? values.taxWorkplace : '' }
        : { [key]: value }
    );

  const select = (key: FilingOfficeField, label: string, options: { value: string; label: string }[], className = '') => (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium">{label}</span>
      <select className={inputClass} value={values[key]} disabled={readOnly || options.length === 0} onChange={(e) => set(key, e.target.value)}>
        <option value="">{t('none')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const text = (key: FilingOfficeField, label: string, maxLength: number, className = '') => (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium">{label}</span>
      <input className={inputClass} value={values[key]} disabled={readOnly} maxLength={maxLength} onChange={(e) => set(key, e.target.value)} />
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {select(
          'taxOffice',
          t('taxOffice'),
          CZ_TAX_OFFICES.map((o) => ({ value: String(o.code), label: o.name }))
        )}
        {select(
          'taxWorkplace',
          t('taxWorkplace'),
          workplaces.map((w) => ({ value: String(w.code), label: w.name }))
        )}
        {naturalPerson &&
          select(
            'healthInsurer',
            t('healthInsurer'),
            CZ_HEALTH_INSURERS.map((i) => ({ value: i.code, label: `${i.code} ${i.name}` }))
          )}
        {naturalPerson &&
          select(
            'socialOffice',
            t('socialOffice'),
            CZ_SOCIAL_OFFICES.map((o) => ({ value: String(o.code), label: o.name }))
          )}
      </div>
      {naturalPerson && (
        <div>
          <InfoHint hint={t('residenceHint')} className="mb-2">
            <span className="text-sm font-medium">{t('residence')}</span>
          </InfoHint>
          <div className="grid gap-3 sm:grid-cols-6">
            {text('residenceStreet', tc('street'), 200, 'sm:col-span-6')}
            {text('residenceCity', tc('city'), 100, 'sm:col-span-4')}
            {text('residencePostalCode', tc('postalCode'), 10, 'sm:col-span-2')}
          </div>
        </div>
      )}
    </div>
  );
}

