'use client';

import { useMemo, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import { CompanyLookup } from '@/components/company-lookup';
import { registryForCountry, type CompanyHit, type RegistryPart } from '@/lib/company-lookup';
import type { BuyerDetailsField } from '@/lib/public-buyer-details';
import { submitBuyerDetails, type BuyerDetailsInput } from '@/lib/public-buyer-details-actions';

const COUNTRIES = [
  'CZ', 'SK', 'AT', 'BE', 'BG', 'HR', 'CY', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SI', 'ES', 'SE', 'GB', 'CH', 'NO', 'IS', 'LI', 'UA', 'RS', 'US', 'CA', 'AU', 'IL', 'TR', 'AE', 'CN', 'JP', 'IN'
];
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

const inputClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive';

interface Props {
  token: string;
  supplierName: string;
  prefill: { name: string | null; email: string | null; country: string | null; isPerson: boolean };
  /** Fields the supplier made mandatory; name and address always are. */
  required: BuyerDetailsField[];
}

/**
 * The customer's billing details form: a name search over the register of
 * the picked country (CZ + SK when unknown), an exact lookup by IČO
 * (ARES/RPO) or EU VAT ID (VIES), and the fields the supplier asked for.
 */
export function BuyerDetailsForm({ token, supplierName, prefill, required }: Props) {
  const t = useTranslations('buyerDetails.form');
  const locale = useLocale();
  const router = useRouter();
  const [form, setForm] = useState<BuyerDetailsInput>({
    isPerson: prefill.isPerson,
    name: prefill.name ?? '',
    email: prefill.email ?? '',
    phone: '',
    street: '',
    city: '',
    postalCode: '',
    country: prefill.country && COUNTRIES.includes(prefill.country) ? prefill.country : 'CZ',
    ico: '',
    dic: ''
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [pending, startTransition] = useTransition();

  const countryNames = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return COUNTRIES.map((code) => ({ code, name: names.of(code) ?? code }));
  }, [locale]);

  const domestic = form.country === 'CZ' || form.country === 'SK';
  // IČO only exists for Czech and Slovak companies; a private person never gives IČO or DIČ.
  const isRequired = (key: BuyerDetailsField) =>
    required.includes(key) && (key === 'email' || key === 'phone' || (!form.isPerson && (key === 'dic' || domestic)));
  const set = (key: keyof BuyerDetailsInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const fieldError = (key: string) => {
    const code = fields[key];
    if (!code) return null;
    const known = ['required', 'ico_required', 'ico_format', 'ico_foreign', 'dic_format', 'phone_format'];
    return known.includes(code) ? t(`errors.${code}`) : t('errors.field');
  };

  const fill = (hit: Omit<CompanyHit, 'source'>) =>
    setForm((f) => ({
      ...f,
      name: hit.name || f.name,
      ico: hit.ico ?? f.ico,
      dic: hit.dic ?? f.dic,
      street: hit.street || f.street,
      city: hit.city || f.city,
      postalCode: hit.postalCode || f.postalCode,
      country: COUNTRIES.includes(hit.country) ? hit.country : f.country
    }));

  const searchByName = async (q: string, part: RegistryPart): Promise<CompanyHit[]> => {
    try {
      const params = new URLSearchParams({ q, country: form.country });
      if (part !== 'all') params.set('part', part);
      const res = await fetch(`/api/public/buyer-details/${encodeURIComponent(token)}/lookup?${params}`, { cache: 'no-store' });
      if (!res.ok) return [];
      return ((await res.json()) as { hits?: CompanyHit[] }).hits ?? [];
    } catch {
      return [];
    }
  };

  const lookup = async () => {
    setLookupNote(null);
    const ico = form.ico.replace(/\s+/g, '');
    const vat = form.dic.replace(/[\s.-]/g, '');
    const query = domestic && /^\d{6,8}$/.test(ico) ? `ico=${ico}` : EU.has(form.country) && vat ? `vat=${encodeURIComponent(/^\d/.test(vat) ? `${form.country === 'GR' ? 'EL' : form.country}${vat}` : vat)}` : null;
    if (!query) {
      setLookupNote(t(domestic ? 'lookupNeedsIco' : 'lookupNeedsVat'));
      return;
    }
    setLooking(true);
    try {
      const res = await fetch(`/api/public/buyer-details/${encodeURIComponent(token)}/lookup?${query}&country=${form.country}`, { cache: 'no-store' });
      if (!res.ok) {
        setLookupNote(t(res.status === 429 ? 'errors.limit' : 'lookupNotFound'));
        return;
      }
      fill((await res.json()) as CompanyHit);
      setLookupNote(t('lookupDone'));
    } catch {
      setLookupNote(t('lookupNotFound'));
    } finally {
      setLooking(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    startTransition(async () => {
      // The IČO field is only shown for Czech and Slovak companies.
      const r = await submitBuyerDetails(token, { ...form, ico: domestic ? form.ico : '' });
      if (r.ok) {
        router.refresh();
        return;
      }
      if (r.fields) setFields(r.fields);
      setError(t(`errors.${r.error}`));
    });
  };

  const label = (key: string, text: string, node: React.ReactNode, wide = false, mandatory = true) => (
    <label className={`text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block font-medium">
        {text}
        {mandatory ? (
          <span className="text-destructive" aria-hidden="true">
            {' '}*
          </span>
        ) : (
          <span className="font-normal text-muted-foreground"> ({t('optional')})</span>
        )}
      </span>
      {node}
      {fieldError(key) && <span className="mt-1 block text-xs text-destructive">{fieldError(key)}</span>}
    </label>
  );

  return (
    <form onSubmit={submit} className="mt-8 rounded-lg border border-primary/30 bg-primary/5 p-5">
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('hint', { supplier: supplierName })}</p>

      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label={t('kind')}>
        {[false, true].map((person) => (
          <button
            key={String(person)}
            type="button"
            role="radio"
            aria-checked={form.isPerson === person}
            onClick={() => setForm((f) => ({ ...f, isPerson: person }))}
            className={`h-9 rounded-md border px-3 text-sm font-medium ${form.isPerson === person ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:bg-muted'}`}
          >
            {person ? t('person') : t('company')}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {label(
          'country',
          t('country'),
          <select className={inputClass} value={form.country} onChange={set('country')}>
            {countryNames.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {form.isPerson ? (
          label(
            'name',
            t('personName'),
            <input className={inputClass} value={form.name} onChange={set('name')} required minLength={2} maxLength={200} autoComplete="name" aria-invalid={Boolean(fields.name)} />,
            true
          )
        ) : (
          <div className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">
              {t('companyName')}
              <span className="text-destructive" aria-hidden="true">
                {' '}*
              </span>
            </span>
            <CompanyLookup
              value={form.name}
              onChange={(name) => setForm((f) => ({ ...f, name: name.slice(0, 200) }))}
              onPick={(hit) => {
                fill(hit);
                setLookupNote(t('lookupDone'));
              }}
              fetchHits={searchByName}
              registry={registryForCountry(form.country)}
              refreshKey={form.country}
              placeholder={t('companySearch')}
              ariaLabel={t('companyName')}
              inputClassName={`rounded-md ${fields.name ? 'border-destructive' : ''}`}
            />
            <span className="mt-1 block text-xs text-muted-foreground">{t('companySearchHint')}</span>
            {fieldError('name') && <span className="mt-1 block text-xs text-destructive">{fieldError('name')}</span>}
          </div>
        )}
        {!form.isPerson && (
          <div className="grid grid-cols-[1fr_auto] items-end gap-2 sm:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              {domestic &&
                label(
                  'ico',
                  t('ico'),
                  <input className={inputClass} value={form.ico} onChange={set('ico')} inputMode="numeric" maxLength={12} required={isRequired('ico')} aria-invalid={Boolean(fields.ico)} />,
                  false,
                  isRequired('ico')
                )}
              {label(
                'dic',
                domestic ? t('dic') : t('vatId'),
                <input className={inputClass} value={form.dic} onChange={set('dic')} maxLength={20} required={isRequired('dic')} aria-invalid={Boolean(fields.dic)} placeholder={domestic ? `${form.country}…` : ''} />,
                false,
                isRequired('dic')
              )}
            </div>
            <button
              type="button"
              onClick={lookup}
              disabled={looking}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {t('lookup')}
            </button>
            {lookupNote && <p className="col-span-2 text-xs text-muted-foreground">{lookupNote}</p>}
          </div>
        )}
        {label(
          'street',
          t('street'),
          <input className={inputClass} value={form.street} onChange={set('street')} required maxLength={200} autoComplete="street-address" aria-invalid={Boolean(fields.street)} />,
          true
        )}
        {label('city', t('city'), <input className={inputClass} value={form.city} onChange={set('city')} required maxLength={120} autoComplete="address-level2" aria-invalid={Boolean(fields.city)} />)}
        {label('postalCode', t('postalCode'), <input className={inputClass} value={form.postalCode} onChange={set('postalCode')} required maxLength={10} autoComplete="postal-code" aria-invalid={Boolean(fields.postalCode)} />)}
        {label(
          'email',
          t('email'),
          <input className={inputClass} type="email" value={form.email} onChange={set('email')} maxLength={200} autoComplete="email" required={isRequired('email')} aria-invalid={Boolean(fields.email)} />,
          false,
          isRequired('email')
        )}
        {label(
          'phone',
          t('phone'),
          <input className={inputClass} type="tel" value={form.phone} onChange={set('phone')} maxLength={40} autoComplete="tel" required={isRequired('phone')} aria-invalid={Boolean(fields.phone)} />,
          false,
          isRequired('phone')
        )}
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('submit')}
      </button>
    </form>
  );
}
