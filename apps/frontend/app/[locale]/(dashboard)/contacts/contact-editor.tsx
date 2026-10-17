'use client';

import { AddressInput } from '@/components/address-input';
import { RegistryPicker, useCompanyRegistry } from '@/components/registry-picker';
import { Typeahead, type TypeaheadGroup } from '@/components/typeahead';
import { type FormEvent, useState, useTransition } from 'react';
import { BadgeCheck, Building2, Loader2, RefreshCw, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { VatStatusBadge } from '@/components/vat-status-badge';
import { lookupCompanyById } from '@/lib/company-lookup-actions';
import { registryForCountry, suggestedVatStatus, type VatPayerCheck } from '@/lib/company-lookup';
import { buttonClass, inputClass, Modal } from '@/components/modal';
import { cn } from '@/lib/utils';
import { toast } from '@/components/toaster';
import { searchCustomers } from '../invoices/new/actions';
import type { AresPrefill, Contact } from '../invoices/new/types';
import { CONTACT_COLORS, CONTACT_COLOR_DOT } from '@/lib/contact-colors';
import { createContact, updateContact, type ContactInput } from './actions';

const EMPTY: ContactInput = {
  legalName: '',
  ico: '',
  dic: '',
  email: '',
  phone: '',
  addressStreet: '',
  addressCity: '',
  addressPostalCode: '',
  addressCountry: 'CZ',
  isVatPayer: null,
  isPerson: false
};

/**
 * Create / edit a contact in a modal. "Načíst z ARES" overwrites the
 * company fields with the registry data and marks the contact verified.
 */
export function ContactEditor({
  open,
  onClose,
  contact,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  contact?: Contact;
  onSaved: (contact: Contact) => void;
}) {
  const t = useTranslations('contacts.editor');
  const tColors = useTranslations('contacts.colors');
  const [form, setForm] = useState<ContactInput>(() => (contact ? { ...EMPTY, ...stripNulls(contact) } : EMPTY));
  const [aresVerified, setAresVerified] = useState<boolean | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [loadingAres, setLoadingAres] = useState(false);
  const [registry, setRegistry] = useCompanyRegistry();
  const [registryQuery, setRegistryQuery] = useState('');
  const [vatCheck, setVatCheck] = useState<VatPayerCheck | null>(null);
  // "Automaticky" follows the country typed below, so a German customer is looked up in the German register.
  const effectiveRegistry = registry === 'auto' ? registryForCountry(form.addressCountry) : registry;
  // With "nevím" picked, any clear answer is worth suggesting; otherwise only one that contradicts the choice.
  const unknownVat = form.isVatPayer === null || form.isVatPayer === undefined;
  const suggestVat = unknownVat
    ? vatCheck && ['payer', 'unreliable', 'valid'].includes(vatCheck.state)
      ? 'payer'
      : vatCheck && ['not_registered', 'invalid'].includes(vatCheck.state)
        ? 'non_payer'
        : null
    : suggestedVatStatus(vatCheck, form.isVatPayer ? 'payer' : 'non_payer');

  const fetchRegistry = async (q: string): Promise<TypeaheadGroup<AresPrefill>[]> => {
    const { ares } = await searchCustomers(q, effectiveRegistry);
    return [{ label: t('registryResults'), items: ares }];
  };
  const pickRegistry = (a: AresPrefill) => {
    setForm((f) => ({ ...f, ...stripNulls({ ...a, ico: a.ico || null, source: undefined, regNumber: undefined }), isPerson: false }));
    setAresVerified(true);
    setRegistryQuery('');
    toast({ text: t('aresLoaded'), tone: 'ok' });
  };

  const set = (key: keyof ContactInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function fromAres() {
    const ico = (form.ico ?? '').trim();
    if (!/^\d{8}$/.test(ico)) {
      toast({ text: t('icoInvalid'), tone: 'err' });
      return;
    }
    setLoadingAres(true);
    const result = await lookupCompanyById(ico, form.addressCountry);
    setLoadingAres(false);
    if (!result.ok) {
      toast({ text: result.error === 'not_found' ? t('aresNotFound') : `${t('aresFailed')}: ${result.error}`, tone: 'err' });
      return;
    }
    const d = result.data;
    // "Plátce DPH" is left to the VAT check suggestion below, never switched by the lookup.
    setForm((f) => ({
      ...f,
      ...stripNulls({
        legalName: d.name,
        ico: d.ico,
        dic: d.dic,
        addressStreet: d.street,
        addressCity: d.city,
        addressPostalCode: d.postalCode,
        addressCountry: d.country
      })
    }));
    setAresVerified(true);
    toast({ text: t('aresLoaded'), tone: 'ok' });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
    const person = form.isPerson === true;
    const input: ContactInput = {
      legalName: (form.legalName ?? '').trim(),
      // A private person has no IČO/DIČ — drop whatever was typed before switching.
      ico: person ? null : clean(form.ico),
      dic: person ? null : clean(form.dic),
      email: clean(form.email),
      phone: clean(form.phone),
      addressStreet: clean(form.addressStreet),
      addressCity: clean(form.addressCity),
      addressPostalCode: clean(form.addressPostalCode),
      addressCountry: (form.addressCountry ?? 'CZ').toUpperCase(),
      isVatPayer: person ? false : (form.isVatPayer ?? null),
      isPerson: person,
      color: form.color ?? null,
      internalNote: clean(form.internalNote),
      ...(aresVerified !== undefined && { aresVerified })
    };
    startTransition(async () => {
      // POST's schema has no nullable ico/dic/email — omit empty ones there.
      const result = contact
        ? await updateContact(contact.id, input)
        : await createContact(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null)) as ContactInput);
      if (!result.ok) {
        toast({ text: result.error === 'ico_taken' ? t('icoTaken') : `${t('saveFailed')}: ${result.error}`, tone: 'err' });
        return;
      }
      toast({ text: t('saved'), tone: 'ok' });
      if (result.data) onSaved(result.data);
    });
  }

  const label = 'mb-1 block text-xs font-semibold text-muted-foreground';
  const person = form.isPerson === true;
  const kinds = [
    { value: false, icon: Building2, text: t('kindCompany') },
    { value: true, icon: User, text: t('kindPerson') }
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contact ? t('editTitle') : t('newTitle')}
      className="max-w-xl"
      footer={
        <>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="contact-editor" className={buttonClass.primary} disabled={pending || !form.legalName?.trim()}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </button>
        </>
      }
    >
      <form id="contact-editor" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <InfoHint hint={t('kindHint')} className="sm:col-span-2">
          <div role="radiogroup" aria-label={t('kind')} className="inline-flex rounded-full border border-border bg-secondary p-0.5">
            {kinds.map(({ value, icon: Icon, text }) => (
              <button
                key={text}
                type="button"
                role="radio"
                aria-checked={person === value}
                onClick={() => setForm((f) => ({ ...f, isPerson: value }))}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition-colors',
                  person === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {text}
              </button>
            ))}
          </div>
        </InfoHint>
        {!person && (
        <>
        <div className="sm:col-span-2">
          <InfoHint hint={t('registryHint')}>
            <span className={label}>{t('registrySearch')}</span>
          </InfoHint>
          <div className="flex gap-2">
            <Typeahead<AresPrefill>
              className="min-w-0 flex-1"
              value={registryQuery}
              onChange={setRegistryQuery}
              refreshKey={registry}
              ariaLabel={t('registrySearch')}
              placeholder={t(`registryPlaceholder.${registry}`)}
              emptyHint={t('registryEmpty')}
              fetchGroups={fetchRegistry}
              getKey={(a) => `${a.ico || a.dic || a.regNumber || a.legalName}-${a.addressCountry}`}
              onPick={pickRegistry}
              renderItem={(a) => (
                <span className="flex min-w-0 items-start gap-2">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.legalName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[a.ico ? `IČO ${a.ico}` : (a.dic ?? a.regNumber), [a.addressCity, a.addressCountry].filter(Boolean).join(', ')]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  </span>
                </span>
              )}
            />
            <RegistryPicker value={registry} onChange={setRegistry} />
          </div>
        </div>
        <label className="block">
          <span className={label}>IČO</span>
          <div className="flex gap-2">
            <input
              className={inputClass}
              inputMode="numeric"
              maxLength={8}
              value={form.ico ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, ico: e.target.value.replace(/\D/g, '') }))}
            />
            <button type="button" className={buttonClass.secondary} onClick={fromAres} disabled={loadingAres} title={t('fromAres')}>
              {loadingAres ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('fromRegistry')}
            </button>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
            DIČ
            <VatStatusBadge dic={form.dic ?? ''} onResult={setVatCheck} />
          </span>
          <input className={inputClass} value={form.dic ?? ''} onChange={set('dic')} />
        </label>
        </>
        )}
        <label className="block sm:col-span-2">
          <span className={label}>{person ? t('personName') : t('legalName')}</span>
          <input required className={inputClass} value={form.legalName ?? ''} onChange={set('legalName')} />
        </label>
        <label className="block sm:col-span-2">
          <span className={label}>{t('street')}</span>
          <AddressInput
            className={inputClass}
            value={form.addressStreet ?? ''}
            country={form.addressCountry}
            onChange={(street) => setForm((f) => ({ ...f, addressStreet: street }))}
            onPick={(a) => setForm((f) => ({ ...f, addressStreet: a.street, addressCity: a.city, addressPostalCode: a.postalCode }))}
          />
        </label>
        <label className="block">
          <span className={label}>{t('city')}</span>
          <input className={inputClass} value={form.addressCity ?? ''} onChange={set('addressCity')} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={label}>{t('postalCode')}</span>
            <input className={inputClass} maxLength={10} value={form.addressPostalCode ?? ''} onChange={set('addressPostalCode')} />
          </label>
          <label className="block">
            <span className={label}>{t('country')}</span>
            <input className={inputClass} maxLength={2} value={form.addressCountry ?? ''} onChange={set('addressCountry')} />
          </label>
        </div>
        <label className="block">
          <span className={label}>E-mail</span>
          <input type="email" className={inputClass} value={form.email ?? ''} onChange={set('email')} />
        </label>
        <label className="block">
          <span className={label}>{t('phone')}</span>
          <input type="tel" className={inputClass} maxLength={40} value={form.phone ?? ''} onChange={set('phone')} />
        </label>
        {!person && (
        <label className="block">
          <span className={label}>{t('vatPayer')}</span>
          <select
            className={inputClass}
            value={form.isVatPayer === null || form.isVatPayer === undefined ? '' : String(form.isVatPayer)}
            onChange={(e) => setForm((f) => ({ ...f, isVatPayer: e.target.value === '' ? null : e.target.value === 'true' }))}
          >
            <option value="">{t('vatUnknown')}</option>
            <option value="true">{t('vatYes')}</option>
            <option value="false">{t('vatNo')}</option>
          </select>
          {suggestVat && (
            <button
              type="button"
              className="mt-1 text-xs font-medium text-primary hover:underline"
              onClick={() => setForm((f) => ({ ...f, isVatPayer: suggestVat === 'payer' }))}
            >
              {t(suggestVat === 'payer' ? 'vatSuggestYes' : 'vatSuggestNo')}
            </button>
          )}
        </label>
        )}
        <div className="sm:col-span-2">
          <span className={label}>{t('color')}</span>
          <div role="radiogroup" aria-label={t('color')} className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              role="radio"
              aria-checked={!form.color}
              onClick={() => setForm((f) => ({ ...f, color: null }))}
              className={cn(
                'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold',
                !form.color ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:bg-secondary'
              )}
            >
              {t('colorNone')}
            </button>
            {CONTACT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={form.color === c}
                aria-label={tColors(c)}
                title={tColors(c)}
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-card',
                  form.color === c && 'ring-2 ring-primary'
                )}
              >
                <span className={cn('h-5 w-5 rounded-full', CONTACT_COLOR_DOT[c])} />
              </button>
            ))}
          </div>
        </div>
        <label className="block sm:col-span-2">
          <InfoHint hint={t('internalNoteHint')}>
            <span className={label}>{t('internalNote')}</span>
          </InfoHint>
          <textarea
            rows={3}
            maxLength={4000}
            className={cn(inputClass, 'h-auto py-2')}
            value={form.internalNote ?? ''}
            onChange={set('internalNote')}
            placeholder={t('internalNotePlaceholder')}
          />
        </label>
      </form>
    </Modal>
  );
}

function stripNulls<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}
