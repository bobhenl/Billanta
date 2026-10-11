'use client';

import { AddressInput } from '@/components/address-input';
import { useMemo, useState, useTransition } from 'react';
import { Building2, CreditCard, FileText, Loader2, MapPin, Phone, Save, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import type { BankAccount, TenantSettings } from '@/lib/tenant';
import { BankAccounts } from './bank-accounts';
import { LogoUpload } from './logo-upload';
import { lookupAres } from '../../contacts/actions';
import { updateCompany } from '../actions';

const PAYMENT_METHODS = ['bank_transfer', 'cash', 'card', 'cash_on_delivery', 'other'] as const;

/** Form field → backend snake_case key; every value is edited as a string, except the two flags below. */
const FIELDS = {
  companyName: 'company_name',
  legalName: 'legal_name',
  ico: 'ico',
  dic: 'dic',
  addressStreet: 'address_street',
  addressCity: 'address_city',
  addressPostalCode: 'address_postal_code',
  addressCountry: 'address_country',
  email: 'email',
  phone: 'phone',
  website: 'website',
  registryNote: 'registry_note',
  bankAccountNumber: 'bank_account_number',
  bankAccountBankCode: 'bank_account_bank_code',
  bankAccountIban: 'bank_account_iban',
  bankAccountSwift: 'bank_account_swift',
  defaultLocale: 'default_locale',
  defaultDueDays: 'default_due_days',
  defaultPaymentMethod: 'default_payment_method',
  defaultNoteBelow: 'default_note_below'
} as const;
type Field = keyof typeof FIELDS;
type Values = Record<Field, string> & { dicVatPayer: boolean };

const REQUIRED: Field[] = ['companyName', 'legalName', 'addressCountry', 'defaultLocale', 'defaultDueDays', 'defaultPaymentMethod'];

function toValues(t: TenantSettings): Values {
  const v = {} as Values;
  for (const key of Object.keys(FIELDS) as Field[]) v[key] = t[key] == null ? '' : String(t[key]);
  v.dicVatPayer = t.dicVatPayer;
  return v;
}

export function CompanyForm({ tenant, accounts, readOnly }: { tenant: TenantSettings; accounts: BankAccount[]; readOnly: boolean }) {
  const t = useTranslations('settings.company');
  const tPay = useTranslations('doc.payment');
  const router = useRouter();
  const initial = useMemo(() => toValues(tenant), [tenant]);
  const [values, setValues] = useState<Values>(initial);
  const [saving, startSave] = useTransition();
  const [loadingAres, setLoadingAres] = useState(false);

  const set = (key: Field, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const dirty = (Object.keys(values) as (keyof Values)[]).filter((k) => values[k] !== initial[k]);

  const loadAres = async () => {
    setLoadingAres(true);
    const result = await lookupAres(values.ico.trim());
    setLoadingAres(false);
    if (!result.ok) {
      toast({ text: result.error === 'not_found' ? t('aresNotFound') : t('aresFailed'), tone: 'err' });
      return;
    }
    const d = result.data;
    setValues((v) => ({
      ...v,
      legalName: d.legalName ?? v.legalName,
      companyName: v.companyName || d.legalName,
      dic: d.dic ?? v.dic,
      addressStreet: d.addressStreet ?? v.addressStreet,
      addressCity: d.addressCity ?? v.addressCity,
      addressPostalCode: d.addressPostalCode ?? v.addressPostalCode,
      addressCountry: d.addressCountry ?? v.addressCountry,
      dicVatPayer: d.isVatPayer ?? v.dicVatPayer
    }));
    toast({ text: t('aresLoaded'), tone: 'ok' });
  };

  const save = () => {
    const patch: Record<string, string | number | boolean | null> = {};
    for (const key of dirty) {
      if (key === 'dicVatPayer') {
        patch.dic_vat_payer = values.dicVatPayer;
        continue;
      }
      const raw = values[key].trim();
      if (key === 'defaultDueDays') patch.default_due_days = Number(raw || 0);
      else if (key === 'dic' || key === 'bankAccountIban' || key === 'bankAccountSwift') patch[FIELDS[key]] = raw ? raw.toUpperCase() : null;
      else patch[FIELDS[key]] = raw || (REQUIRED.includes(key) ? raw : null);
    }
    startSave(async () => {
      const result = await updateCompany(patch);
      toast(result.ok ? { text: t('saved'), tone: 'ok' } : { text: `${t('saveFailed')}: ${result.error}`, tone: 'err' });
      if (result.ok) router.refresh();
    });
  };

  const input = (key: Field, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className={inputClass} value={values[key]} disabled={readOnly} onChange={(e) => set(key, e.target.value)} {...extra} />
  );
  const field = (key: Field, label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>, className = '', hint?: string) => {
    const caption = (
      <span className="font-medium">
        {label}
        {REQUIRED.includes(key) && <span className="text-destructive"> *</span>}
      </span>
    );
    // With a hint the (i) button sits next to the caption, so the caption can't be a <label> around the input.
    if (hint) {
      return (
        <div className={`block text-sm ${className}`}>
          <InfoHint hint={hint} className="mb-1">
            {caption}
          </InfoHint>
          {input(key, { ...extra, 'aria-label': label })}
        </div>
      );
    }
    return (
      <label className={`block text-sm ${className}`}>
        <span className="mb-1 block">{caption}</span>
        {input(key, extra)}
      </label>
    );
  };

  return (
    <form
      className="mt-5 space-y-4 pb-20"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Section icon={Building2} title={t('sections.identity')} hint={t('sections.identityHint')}>
        <LogoUpload hasLogo={tenant.hasLogo} readOnly={readOnly} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('ico')}</span>
            <div className="flex gap-2">
              {input('ico', { inputMode: 'numeric', pattern: '\\d{8}', maxLength: 8, placeholder: '12345678' })}
              {!readOnly && (
                <button type="button" className={buttonClass.secondary} disabled={!/^\d{8}$/.test(values.ico) || loadingAres} onClick={loadAres}>
                  {loadingAres ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  ARES
                </button>
              )}
            </div>
          </label>
          {field('dic', t('dic'), { placeholder: 'CZ12345678', maxLength: 12 })}
          {field('companyName', t('companyName'), { required: true, maxLength: 200 }, '', t('companyNameHint'))}
          {field('legalName', t('legalName'), { required: true, maxLength: 200 }, '', t('legalNameHint'))}
          <InfoHint hint={t('vatPayerHint')} className="text-sm sm:col-span-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={values.dicVatPayer}
                disabled={readOnly}
                onChange={(e) => setValues((v) => ({ ...v, dicVatPayer: e.target.checked }))}
              />
              <span className="font-medium">{t('vatPayer')}</span>
            </label>
          </InfoHint>
        </div>
      </Section>

      <Section icon={MapPin} title={t('sections.address')}>
        <div className="grid gap-3 sm:grid-cols-6">
          <label className="block text-sm sm:col-span-6">
            <span className="mb-1 block font-medium">{t('street')}</span>
            <AddressInput
              className={inputClass}
              value={values.addressStreet}
              country={values.addressCountry}
              disabled={readOnly}
              maxLength={200}
              onChange={(street) => set('addressStreet', street)}
              onPick={(a) => setValues((v) => ({ ...v, addressStreet: a.street, addressCity: a.city, addressPostalCode: a.postalCode }))}
            />
          </label>
          {field('addressCity', t('city'), { maxLength: 100 }, 'sm:col-span-3')}
          {field('addressPostalCode', t('postalCode'), { maxLength: 10 }, 'sm:col-span-2')}
          {field('addressCountry', t('country'), { required: true, minLength: 2, maxLength: 2 }, 'sm:col-span-1', t('countryHint'))}
        </div>
      </Section>

      <Section icon={Phone} title={t('sections.contact')} hint={t('sections.contactHint')}>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('email', t('email'), { type: 'email', maxLength: 320 })}
          {field('phone', t('phone'), { type: 'tel', maxLength: 32 })}
          {field('website', t('website'), { maxLength: 200, placeholder: 'https://' })}
          {field('registryNote', t('registryNote'), { maxLength: 500, placeholder: t('registryNotePlaceholder') }, '', t('registryNoteHint'))}
        </div>
      </Section>

      <Section icon={CreditCard} title={t('sections.bank')} hint={t('sections.bankHint')}>
        <div className="grid gap-3 sm:grid-cols-4">
          {field('bankAccountNumber', t('accountNumber'), { placeholder: '123456789', maxLength: 17 }, 'sm:col-span-3')}
          {field('bankAccountBankCode', t('bankCode'), { placeholder: '0100', maxLength: 4, inputMode: 'numeric' }, 'sm:col-span-1')}
          {field('bankAccountIban', 'IBAN', { placeholder: 'CZ65 0800 0000 1920 0014 5399', maxLength: 42 }, 'sm:col-span-3', t('ibanHint'))}
          {field('bankAccountSwift', 'SWIFT / BIC', { maxLength: 11 }, 'sm:col-span-1')}
        </div>
        <BankAccounts accounts={accounts} readOnly={readOnly} />
      </Section>

      <Section icon={FileText} title={t('sections.defaults')} hint={t('sections.defaultsHint')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('defaultLocale')}</span>
            <select className={inputClass} value={values.defaultLocale} disabled={readOnly} onChange={(e) => set('defaultLocale', e.target.value)}>
              <option value="cs">Čeština</option>
              <option value="sk">Slovenčina</option>
              <option value="en">English</option>
            </select>
          </label>
          {field('defaultDueDays', t('defaultDueDays'), { type: 'number', min: 0, max: 365, required: true }, '', t('defaultDueDaysHint'))}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('defaultPaymentMethod')}</span>
            <select className={inputClass} value={values.defaultPaymentMethod} disabled={readOnly} onChange={(e) => set('defaultPaymentMethod', e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {tPay(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm sm:col-span-3">
            <span className="mb-1 block font-medium">{t('defaultNoteBelow')}</span>
            <textarea
              className={`${inputClass} min-h-20`}
              value={values.defaultNoteBelow}
              disabled={readOnly}
              maxLength={2000}
              placeholder={t('defaultNotePlaceholder')}
              onChange={(e) => set('defaultNoteBelow', e.target.value)}
            />
          </label>
        </div>
      </Section>

      {!readOnly && (
        <div className="sticky bottom-20 z-10 flex items-center justify-end gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur md:bottom-4">
          <span className="mr-auto text-sm text-muted-foreground">{dirty.length > 0 ? t('unsaved', { count: dirty.length }) : t('noChanges')}</span>
          {dirty.length > 0 && (
            <button type="button" className={buttonClass.ghost} onClick={() => setValues(initial)}>
              {t('discard')}
            </button>
          )}
          <button type="submit" className={buttonClass.primary} disabled={saving || dirty.length === 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('save')}
          </button>
        </div>
      )}
    </form>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: typeof Building2; title: string; hint?: string; children: React.ReactNode }) {
  const heading = (
    <h2 className="flex items-center gap-2 font-bold">
      <Icon className="h-4 w-4 text-primary" />
      {title}
    </h2>
  );
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      {/* The section explanation hides behind (i) so the form stays one screen shorter. */}
      {hint ? <InfoHint hint={hint}>{heading}</InfoHint> : heading}
      <div className="mt-3">{children}</div>
    </section>
  );
}
