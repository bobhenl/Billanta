'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Search } from 'lucide-react';

/**
 * The customer's own billing details (company or person, country, IČO/DIČ
 * with registry lookup, name, address, e-mail), shared by the public forms
 * where a customer fills them in: the buyer-details link (`/d/:token`) and
 * orders from a company profile (`/p/:slug`). Labels live in
 * `buyerDetails.form`; `fields` holds the backend's per-field error codes.
 */
export const BUYER_COUNTRIES = [
  'CZ', 'SK', 'AT', 'BE', 'BG', 'HR', 'CY', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SI', 'ES', 'SE', 'GB', 'CH', 'NO', 'IS', 'LI', 'UA', 'RS', 'US', 'CA', 'AU', 'IL', 'TR', 'AE', 'CN', 'JP', 'IN'
];
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
const KNOWN_ERRORS = ['ico_required', 'ico_format', 'ico_foreign', 'dic_format', 'email_required'];

export const buyerInputClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive';

export interface BuyerFieldsValue {
  isPerson: boolean;
  name: string;
  email: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  ico: string;
  dic: string;
}

type Lookup = { name: string | null; ico: string | null; dic: string | null; street: string | null; city: string | null; postalCode: string | null; country: string };

export function emptyBuyer(prefill: { name?: string | null; email?: string | null; country?: string | null; isPerson?: boolean } = {}): BuyerFieldsValue {
  return {
    isPerson: prefill.isPerson ?? false,
    name: prefill.name ?? '',
    email: prefill.email ?? '',
    street: '',
    city: '',
    postalCode: '',
    country: prefill.country && BUYER_COUNTRIES.includes(prefill.country) ? prefill.country : 'CZ',
    ico: '',
    dic: ''
  };
}

/** The IČO field is only shown for Czech and Slovak companies, so a hidden value is never sent. */
export function buyerForSubmit(value: BuyerFieldsValue): BuyerFieldsValue {
  const domestic = value.country === 'CZ' || value.country === 'SK';
  return { ...value, ico: domestic ? value.ico : '' };
}

export function BuyerFields({
  value,
  onChange,
  fields,
  lookupUrl,
  emailRequired = false
}: {
  value: BuyerFieldsValue;
  onChange: (update: (current: BuyerFieldsValue) => BuyerFieldsValue) => void;
  fields: Record<string, string>;
  /** Route that proxies the registry lookup; `?ico=` or `?vat=` is appended. */
  lookupUrl: string;
  emailRequired?: boolean;
}) {
  const t = useTranslations('buyerDetails.form');
  const locale = useLocale();
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const countryNames = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return BUYER_COUNTRIES.map((code) => ({ code, name: names.of(code) ?? code }));
  }, [locale]);

  const form = value;
  const domestic = form.country === 'CZ' || form.country === 'SK';
  const set = (key: keyof BuyerFieldsValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const next = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    onChange((f) => ({ ...f, [key]: next }));
  };

  const fieldError = (key: string) => {
    const code = fields[key];
    if (!code) return null;
    return KNOWN_ERRORS.includes(code) ? t(`errors.${code}`) : t('errors.field');
  };

  const lookup = async () => {
    setLookupNote(null);
    const ico = form.ico.replace(/\s+/g, '');
    const vat = form.dic.replace(/[\s.-]/g, '');
    const query =
      domestic && /^\d{6,8}$/.test(ico)
        ? `ico=${ico}`
        : EU.has(form.country) && vat
          ? `vat=${encodeURIComponent(/^\d/.test(vat) ? `${form.country === 'GR' ? 'EL' : form.country}${vat}` : vat)}`
          : null;
    if (!query) {
      setLookupNote(t(domestic ? 'lookupNeedsIco' : 'lookupNeedsVat'));
      return;
    }
    setLooking(true);
    try {
      const res = await fetch(`${lookupUrl}?${query}`, { cache: 'no-store' });
      if (!res.ok) {
        setLookupNote(t(res.status === 429 ? 'errors.limit' : 'lookupNotFound'));
        return;
      }
      const hit = (await res.json()) as Lookup;
      onChange((f) => ({
        ...f,
        name: hit.name || f.name,
        ico: hit.ico ?? f.ico,
        dic: hit.dic ?? f.dic,
        street: hit.street || f.street,
        city: hit.city || f.city,
        postalCode: hit.postalCode || f.postalCode,
        country: BUYER_COUNTRIES.includes(hit.country) ? hit.country : f.country
      }));
      setLookupNote(t('lookupDone'));
    } catch {
      setLookupNote(t('lookupNotFound'));
    } finally {
      setLooking(false);
    }
  };

  const label = (key: string, text: string, node: React.ReactNode, wide = false) => (
    <label className={`text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block font-medium">{text}</span>
      {node}
      {fieldError(key) && <span className="mt-1 block text-xs text-destructive">{fieldError(key)}</span>}
    </label>
  );

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label={t('kind')}>
        {[false, true].map((person) => (
          <button
            key={String(person)}
            type="button"
            role="radio"
            aria-checked={form.isPerson === person}
            onClick={() => onChange((f) => ({ ...f, isPerson: person }))}
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
          <select className={buyerInputClass} value={form.country} onChange={set('country')}>
            {countryNames.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {!form.isPerson && (
          <div className="grid grid-cols-[1fr_auto] items-end gap-2 sm:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              {domestic &&
                label('ico', t('ico'), <input className={buyerInputClass} value={form.ico} onChange={set('ico')} inputMode="numeric" maxLength={12} aria-invalid={Boolean(fields.ico)} />)}
              {label(
                'dic',
                domestic ? t('dic') : t('vatId'),
                <input className={buyerInputClass} value={form.dic} onChange={set('dic')} maxLength={20} aria-invalid={Boolean(fields.dic)} placeholder={domestic ? `${form.country}…` : ''} />
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
          'name',
          form.isPerson ? t('personName') : t('companyName'),
          <input className={buyerInputClass} value={form.name} onChange={set('name')} required minLength={2} maxLength={200} autoComplete={form.isPerson ? 'name' : 'organization'} aria-invalid={Boolean(fields.name)} />,
          true
        )}
        {label(
          'street',
          t('street'),
          <input className={buyerInputClass} value={form.street} onChange={set('street')} required maxLength={200} autoComplete="street-address" aria-invalid={Boolean(fields.street)} />,
          true
        )}
        {label('city', t('city'), <input className={buyerInputClass} value={form.city} onChange={set('city')} required maxLength={120} autoComplete="address-level2" aria-invalid={Boolean(fields.city)} />)}
        {label('postalCode', t('postalCode'), <input className={buyerInputClass} value={form.postalCode} onChange={set('postalCode')} required maxLength={10} autoComplete="postal-code" aria-invalid={Boolean(fields.postalCode)} />)}
        {label(
          'email',
          t('email'),
          <input className={buyerInputClass} type="email" value={form.email} onChange={set('email')} required={emailRequired} maxLength={200} autoComplete="email" aria-invalid={Boolean(fields.email)} />,
          true
        )}
      </div>
    </>
  );
}
