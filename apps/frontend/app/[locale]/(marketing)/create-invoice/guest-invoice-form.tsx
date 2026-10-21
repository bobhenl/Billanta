'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  BellRing,
  Building2,
  Download,
  FileCode2,
  Globe2,
  Landmark,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  User,
  Wand2
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { InfoHint } from '@/components/info-hint';
import { forgetGuestInvoices, nextGuestNumber, readGuestInvoices, rememberGuestInvoice, type GuestInvoiceBody } from '@/lib/guest-invoices';

/**
 * "Make an invoice without an account" — everything stays in the browser
 * until the visitor clicks download; the backend renders the PDF and keeps
 * nothing. A short "what is it for" step tailors which fields show and
 * their defaults; the visitor can always switch to all fields. The supplier
 * block and the chosen profile are remembered in localStorage, and so is
 * each downloaded invoice (`lib/guest-invoices.ts`), so an account opened
 * later takes over the numbering and the customers.
 *
 * Showcase extras: ARES lookup by IČO and an AI fill from free text or
 * voice, capped per visitor (and globally) by the backend.
 */
type Party = { name: string; street: string; city: string; postalCode: string; ico: string; dic: string };
type Supplier = Party & { email: string; phone: string; bankAccountNumber: string; bankCode: string; iban: string };
type Item = { description: string; quantity: string; unit: string; unitPrice: string; vatRate: string };
type UseCase = 'freelancer' | 'vat' | 'foreign' | 'oneoff';
type Billing = 'hours' | 'goods' | 'project';
type Profile = { useCase: UseCase; billing: Billing };
type DocumentType = 'invoice' | 'proforma' | 'credit_note';
/** `?template=<slug>` from the public invoice templates (/invoice-templates/<slug>). */
type TemplateSlug = 'non-vat-payer' | 'vat-payer' | 'proforma-invoice' | 'credit-note' | 'reverse-charge' | 'identified-person';
type AiQuota = { available: boolean; limit: number; remaining: number };
type AresPrefill = { ico: string; dic: string | null; legalName: string; addressStreet: string | null; addressCity: string | null; addressPostalCode: string | null };

const STORAGE_KEY = 'billanta.guestInvoice.supplier';
const PROFILE_KEY = 'billanta.guestInvoice.profile';
const emptyParty: Party = { name: '', street: '', city: '', postalCode: '', ico: '', dic: '' };
const emptySupplier: Supplier = { ...emptyParty, email: '', phone: '', bankAccountNumber: '', bankCode: '', iban: '' };
const UNIT_BY_BILLING: Record<Billing, string> = { hours: 'hod', goods: 'ks', project: '' };
const USE_CASES: { id: UseCase; icon: typeof User }[] = [
  { id: 'freelancer', icon: User },
  { id: 'vat', icon: Receipt },
  { id: 'foreign', icon: Globe2 },
  { id: 'oneoff', icon: Sparkles }
];
const BILLINGS: Billing[] = ['hours', 'goods', 'project'];
const DOCUMENT_TYPES: DocumentType[] = ['invoice', 'proforma', 'credit_note'];
const FILE_PREFIX: Record<DocumentType, string> = { invoice: 'faktura', proforma: 'zalohova-faktura', credit_note: 'dobropis' };
const TEMPLATE_PROFILE: Record<TemplateSlug, Profile> = {
  'non-vat-payer': { useCase: 'freelancer', billing: 'project' },
  'vat-payer': { useCase: 'vat', billing: 'project' },
  'proforma-invoice': { useCase: 'vat', billing: 'project' },
  'credit-note': { useCase: 'vat', billing: 'project' },
  'reverse-charge': { useCase: 'vat', billing: 'project' },
  'identified-person': { useCase: 'freelancer', billing: 'project' }
};
const FEATURES = [
  { key: 'recurring', icon: RefreshCw },
  { key: 'reminders', icon: BellRing },
  { key: 'bank', icon: Landmark },
  { key: 'ai', icon: Wand2 },
  { key: 'exports', icon: FileCode2 },
  { key: 'registry', icon: Building2 },
  { key: 'payments', icon: Banknote }
] as const;

const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2';
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (v: string) => Number(v.replace(',', '.').replace(/\s/g, ''));
const addDays = (iso: string, days: number) => isoDate(new Date(new Date(`${iso}T12:00:00`).getTime() + days * 86_400_000));

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / blocked storage: a convenience only.
  }
}

export function GuestInvoiceForm() {
  const t = useTranslations('guestInvoice');
  const tDemo = useTranslations('demo');
  const locale = useLocale();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [draftUseCase, setDraftUseCase] = useState<UseCase | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [language, setLanguage] = useState(locale === 'sk' || locale === 'en' ? locale : 'cs');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [taxableSupplyDate, setTaxableSupplyDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState(locale === 'sk' ? 'EUR' : 'CZK');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [vatPayer, setVatPayer] = useState(false);
  const [documentType, setDocumentType] = useState<DocumentType>('invoice');
  const [reverseCharge, setReverseCharge] = useState(false);
  const [relatedInvoiceNumber, setRelatedInvoiceNumber] = useState('');
  const [supplier, setSupplier] = useState<Supplier>(emptySupplier);
  const [customer, setCustomer] = useState<Party>(emptyParty);
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: '1', unit: '', unitPrice: '', vatRate: '21' }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** Invoices kept in this browser for an account opened later. */
  const [kept, setKept] = useState(0);

  // Defaults depend on the visitor's clock, so they're set after mount
  // (server and browser may be in different time zones).
  useEffect(() => {
    const today = isoDate(new Date());
    const history = readGuestInvoices();
    setKept(history.length);
    // Continue after the last downloaded number instead of starting the year again.
    const last = history.at(-1)?.invoiceNumber;
    setInvoiceNumber((last && nextGuestNumber(last)) || `${today.slice(0, 4)}0001`);
    setIssueDate(today);
    setTaxableSupplyDate(today);
    setDueDate(addDays(today, 14));
    const saved = readStorage<Partial<Supplier>>(STORAGE_KEY);
    if (saved) setSupplier({ ...emptySupplier, ...saved });
    const savedProfile = readStorage<Profile>(PROFILE_KEY);
    const template = new URLSearchParams(window.location.search).get('template');
    if (template && template in TEMPLATE_PROFILE) applyTemplate(template as TemplateSlug);
    else if (savedProfile?.useCase && savedProfile.billing) applyProfile(savedProfile, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyProfile(next: Profile, remember = true) {
    setProfile(next);
    if (remember) writeStorage(PROFILE_KEY, next);
    setVatPayer(next.useCase === 'vat');
    if (next.useCase === 'foreign') {
      setLanguage('en');
      setCurrency('EUR');
    }
    const unit = UNIT_BY_BILLING[next.billing];
    setItems((list) => list.map((it) => (it.unit ? it : { ...it, unit })));
  }

  /** Presets the form for one public invoice template; the visitor's saved profile is left alone. */
  function applyTemplate(slug: TemplateSlug) {
    applyProfile(TEMPLATE_PROFILE[slug], false);
    if (slug === 'proforma-invoice') setDocumentType('proforma');
    if (slug === 'credit-note') {
      setDocumentType('credit_note');
      setShowAll(true);
    }
    if (slug === 'reverse-charge') setReverseCharge(true);
    if (slug === 'identified-person') {
      setShowAll(true);
      setNote(t('template.identifiedNote'));
    }
  }

  // Which optional parts are visible for the chosen profile ("all fields" shows everything).
  const visible = useMemo(() => {
    const u = profile?.useCase;
    return {
      dic: showAll || u === 'vat' || u === 'foreign',
      customerIds: showAll || u !== 'oneoff',
      contact: showAll || u === 'foreign' || u === 'vat',
      iban: showAll || u === 'foreign',
      duzp: vatPayer,
      language: showAll || u === 'foreign',
      unit: showAll || profile?.billing !== 'project',
      vatToggle: showAll || u === 'vat' || u === 'foreign'
    };
  }, [profile, showAll, vatPayer]);

  const total = useMemo(
    () =>
      items.reduce((sum, i) => {
        const base = (num(i.quantity) || 0) * (num(i.unitPrice) || 0);
        return sum + base * (1 + (vatPayer && !reverseCharge ? num(i.vatRate) || 0 : 0) / 100);
      }, 0),
    [items, vatPayer, reverseCharge]
  );

  const setItem = (index: number, patch: Partial<Item>) => setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const newItem = (): Item => ({ description: '', quantity: '1', unit: profile ? UNIT_BY_BILLING[profile.billing] : '', unitPrice: '', vatRate: '21' });

  function applySuggestion(result: AiResult) {
    const s = result.suggestion;
    if (s.items.length > 0) {
      setItems(
        s.items.slice(0, 50).map((i) => ({
          description: i.description,
          quantity: String(i.quantity),
          unit: profile ? UNIT_BY_BILLING[profile.billing] : '',
          unitPrice: String(i.unit_price),
          vatRate: String(i.vat_rate ?? 21)
        }))
      );
    }
    setCurrency(s.currency);
    const issue = s.issue_date && /^\d{4}-\d{2}-\d{2}$/.test(s.issue_date) ? s.issue_date : issueDate;
    if (issue !== issueDate) {
      setIssueDate(issue);
      setTaxableSupplyDate(issue);
    }
    if (s.due_in_days != null && issue) setDueDate(addDays(issue, Math.max(0, Math.min(365, Math.round(s.due_in_days)))));
    if (result.ares) setCustomer(fromAres(result.ares));
    else if (s.customer.name || s.customer.ico) setCustomer((c) => ({ ...c, name: s.customer.name ?? c.name, ico: s.customer.ico ?? c.ico }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    writeStorage(STORAGE_KEY, supplier);
    try {
      const body: GuestInvoiceBody = {
        language,
        invoiceNumber: invoiceNumber.trim(),
        issueDate,
        taxableSupplyDate: vatPayer && taxableSupplyDate ? taxableSupplyDate : undefined,
        dueDate: dueDate || undefined,
        currency,
        paymentMethod,
        vatPayer,
        documentType,
        reverseCharge: vatPayer && reverseCharge,
        relatedInvoiceNumber: documentType === 'credit_note' ? relatedInvoiceNumber.trim() : undefined,
        supplier: { ...supplier, iban: supplier.iban.replace(/\s/g, '') },
        customer,
        note,
        items: items
          .filter((i) => i.description.trim())
          .map((i) => ({
            description: i.description.trim(),
            quantity: num(i.quantity),
            unit: i.unit,
            unitPrice: num(i.unitPrice),
            vatRate: vatPayer ? num(i.vatRate) || 0 : 0
          }))
      };
      const res = await fetch('/api/public/guest-invoice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        setError(res.status === 429 ? t('errors.rateLimited') : res.status === 503 ? t('errors.busy') : res.status === 400 ? t('errors.invalid') : t('errors.failed'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${FILE_PREFIX[documentType]}-${invoiceNumber.trim().replace(/[^\w.-]+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setKept(rememberGuestInvoice(body).length);
      setDone(true);
    } catch {
      setError(t('errors.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <section className="mt-8 rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby="guest-setup">
        <h2 id="guest-setup" className="text-lg font-bold">
          {t('setup.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('setup.lead')}</p>
        <p className="mt-5 text-sm font-semibold">{t('setup.q1')}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {USE_CASES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setDraftUseCase(id)}
              aria-pressed={draftUseCase === id}
              className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                draftUseCase === id ? 'border-primary bg-accent/60' : 'border-border hover:bg-secondary'
              }`}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold">{t(`setup.useCases.${id}.title`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`setup.useCases.${id}.text`)}</span>
              </span>
            </button>
          ))}
        </div>
        {draftUseCase && (
          <>
            <p className="mt-5 text-sm font-semibold">{t('setup.q2')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BILLINGS.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => applyProfile({ useCase: draftUseCase, billing: b })}
                  className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:border-primary hover:bg-accent/60"
                >
                  {t(`setup.billing.${b}`)}
                </button>
              ))}
            </div>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setShowAll(true);
            applyProfile({ useCase: 'freelancer', billing: 'project' });
          }}
          className="mt-5 text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('setup.skip')}
        </button>
      </section>
    );
  }

  const partyFields = <P extends Party>(value: P, onChange: (v: P) => void, prefix: string, ids: boolean) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {ids && (
        <Field label={t('fields.ico')} className="sm:col-span-2">
          <AresInput value={value.ico} onChange={(ico) => onChange({ ...value, ico })} onFound={(p) => onChange({ ...value, ...fromAres(p) })} />
        </Field>
      )}
      <Field label={t('fields.name')} className="sm:col-span-2">
        <input required className={inputClass} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} autoComplete={`section-${prefix} organization`} />
      </Field>
      <Field label={t('fields.street')} className="sm:col-span-2">
        <input className={inputClass} value={value.street} onChange={(e) => onChange({ ...value, street: e.target.value })} autoComplete={`section-${prefix} street-address`} />
      </Field>
      <Field label={t('fields.city')}>
        <input className={inputClass} value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} autoComplete={`section-${prefix} address-level2`} />
      </Field>
      <Field label={t('fields.postalCode')}>
        <input className={inputClass} value={value.postalCode} onChange={(e) => onChange({ ...value, postalCode: e.target.value })} autoComplete={`section-${prefix} postal-code`} />
      </Field>
      {ids && visible.dic && (
        <Field label={t('fields.dic')}>
          <input className={inputClass} value={value.dic} onChange={(e) => onChange({ ...value, dic: e.target.value })} />
        </Field>
      )}
    </div>
  );

  return (
    <>
      {kept > 0 && !done && (
        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary/30 bg-accent/40 px-4 py-3 text-sm">
          <Save className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{t('carryOver.title')}</span>{' '}
            <span className="text-muted-foreground">
              {t('carryOver.kept', { n: kept })} {t('carryOver.where')}
            </span>
          </p>
          <Link href="/signup?from=guest" className="font-semibold text-primary hover:underline">
            {t('carryOver.cta')}
          </Link>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => {
              forgetGuestInvoices();
              setKept(0);
            }}
          >
            {t('carryOver.forget')}
          </button>
        </div>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm">
        <span className="text-muted-foreground">{t('setup.current')}</span>
        <span className="font-semibold">
          {t(`setup.useCases.${profile.useCase}.title`)} · {t(`setup.billing.${profile.billing}`)}
        </span>
        <button
          type="button"
          onClick={() => {
            setDraftUseCase(profile.useCase);
            setProfile(null);
          }}
          className="text-primary hover:underline"
        >
          {t('setup.change')}
        </button>
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t('setup.showAll')}
        </label>
      </div>

      <AiFill vatPayer={vatPayer} billing={profile.billing} onResult={applySuggestion} />

      <form onSubmit={submit} className="mt-6 space-y-6">
        <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <h2 className="text-base font-bold">{t('sections.document')}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field label={t('fields.number')} hint={t('hints.number')}>
              <input required maxLength={40} className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </Field>
            <Field label={t('fields.issueDate')}>
              <input
                required
                type="date"
                className={inputClass}
                value={issueDate}
                onChange={(e) => {
                  setIssueDate(e.target.value);
                  setTaxableSupplyDate(e.target.value);
                }}
              />
            </Field>
            {visible.duzp && (
              <Field label={t('fields.taxableSupplyDate')} hint={t('hints.duzp')}>
                <input type="date" className={inputClass} value={taxableSupplyDate} onChange={(e) => setTaxableSupplyDate(e.target.value)} />
              </Field>
            )}
            <Field label={t('fields.dueDate')}>
              <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              <span className="flex gap-1">
                {[7, 14, 30].map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={!issueDate}
                    onClick={() => setDueDate(addDays(issueDate, d))}
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary"
                  >
                    {t('dueIn', { days: d })}
                  </button>
                ))}
              </span>
            </Field>
            <Field label={t('fields.currency')}>
              <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {['CZK', 'EUR', 'USD', 'GBP', 'PLN'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={t('fields.paymentMethod')}>
              <select className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                {(['bank_transfer', 'cash', 'card', 'cash_on_delivery', 'other'] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(`methods.${m}`)}
                  </option>
                ))}
              </select>
            </Field>
            {(showAll || documentType !== 'invoice') && (
              <Field label={t('template.documentType')}>
                <select className={inputClass} value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType)}>
                  {DOCUMENT_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {t(`template.documentTypes.${d}`)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {documentType === 'credit_note' && (
              <Field label={t('template.relatedInvoiceNumber')}>
                <input maxLength={40} className={inputClass} value={relatedInvoiceNumber} onChange={(e) => setRelatedInvoiceNumber(e.target.value)} />
              </Field>
            )}
            {visible.language && (
              <Field label={t('fields.language')}>
                <select className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="cs">Čeština</option>
                  <option value="sk">Slovenčina</option>
                  <option value="en">English</option>
                </select>
              </Field>
            )}
          </div>
          {visible.vatToggle && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={vatPayer} onChange={(e) => setVatPayer(e.target.checked)} />
              <InfoHint label={t('fields.vatPayer')} hint={t('hints.vatPayer')}>
                <span>{t('fields.vatPayer')}</span>
              </InfoHint>
            </label>
          )}
          {vatPayer && (showAll || reverseCharge) && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} />
              <InfoHint label={t('template.reverseCharge')} hint={t('template.hintReverseCharge')}>
                <span>{t('template.reverseCharge')}</span>
              </InfoHint>
            </label>
          )}
          {documentType === 'credit_note' && <p className="mt-3 text-xs text-muted-foreground">{t('template.hintCreditNote')}</p>}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <h2 className="text-base font-bold">{t('sections.supplier')}</h2>
            <div className="mt-4 space-y-3">
              {partyFields(supplier, setSupplier, 'supplier', true)}
              <div className="grid gap-3 sm:grid-cols-2">
                {visible.contact && (
                  <>
                    <Field label={t('fields.email')}>
                      <input type="email" className={inputClass} value={supplier.email} onChange={(e) => setSupplier({ ...supplier, email: e.target.value })} autoComplete="email" />
                    </Field>
                    <Field label={t('fields.phone')}>
                      <input type="tel" className={inputClass} value={supplier.phone} onChange={(e) => setSupplier({ ...supplier, phone: e.target.value })} autoComplete="tel" />
                    </Field>
                  </>
                )}
                {paymentMethod === 'bank_transfer' && (
                  <>
                    <Field label={t('fields.account')} hint={t('hints.qr')}>
                      <input className={inputClass} placeholder="123456789" value={supplier.bankAccountNumber} onChange={(e) => setSupplier({ ...supplier, bankAccountNumber: e.target.value })} />
                    </Field>
                    <Field label={t('fields.bankCode')}>
                      <input className={inputClass} placeholder="0100" inputMode="numeric" value={supplier.bankCode} onChange={(e) => setSupplier({ ...supplier, bankCode: e.target.value })} />
                    </Field>
                    {visible.iban && (
                      <Field label={t('fields.iban')} hint={t('hints.iban')} className="sm:col-span-2">
                        <input className={inputClass} value={supplier.iban} onChange={(e) => setSupplier({ ...supplier, iban: e.target.value })} />
                      </Field>
                    )}
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('hints.remembered')}</p>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
            <h2 className="text-base font-bold">{t('sections.customer')}</h2>
            <div className="mt-4">{partyFields(customer, setCustomer, 'customer', visible.customerIds)}</div>
            {profile.useCase === 'foreign' && <p className="mt-3 text-xs text-muted-foreground">{t('hints.foreign')}</p>}
          </section>
        </div>

        <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
          <h2 className="text-base font-bold">{t('sections.items')}</h2>
          <ul className="mt-4 space-y-3">
            {items.map((item, index) => (
              <li key={index} className="grid grid-cols-6 gap-2 border-b border-border pb-3 last:border-0 sm:grid-cols-12">
                <Field label={t('fields.description')} className={`col-span-6 ${visible.unit ? 'sm:col-span-5' : 'sm:col-span-6'}`}>
                  <input
                    required={index === 0}
                    maxLength={500}
                    className={inputClass}
                    placeholder={t(`placeholders.${profile.billing}`)}
                    value={item.description}
                    onChange={(e) => setItem(index, { description: e.target.value })}
                  />
                </Field>
                <Field label={t('fields.quantity')} className="col-span-2 sm:col-span-1">
                  <input required inputMode="decimal" className={inputClass} value={item.quantity} onChange={(e) => setItem(index, { quantity: e.target.value })} />
                </Field>
                {visible.unit && (
                  <Field label={t('fields.unit')} className="col-span-2 sm:col-span-1">
                    <input maxLength={20} className={inputClass} placeholder={t('fields.unitPlaceholder')} value={item.unit} onChange={(e) => setItem(index, { unit: e.target.value })} />
                  </Field>
                )}
                <Field label={t('fields.unitPrice')} className="col-span-2 sm:col-span-2">
                  <input required inputMode="decimal" className={inputClass} value={item.unitPrice} onChange={(e) => setItem(index, { unitPrice: e.target.value })} />
                </Field>
                {vatPayer && (
                  <Field label={t('fields.vatRate')} className="col-span-3 sm:col-span-2">
                    <select className={inputClass} value={item.vatRate} onChange={(e) => setItem(index, { vatRate: e.target.value })}>
                      {['21', '12', '0', '23', '19', '5'].map((r) => (
                        <option key={r} value={r}>
                          {r} %
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className={`flex items-end ${vatPayer ? 'col-span-3 sm:col-span-1' : 'col-span-6 sm:col-span-3'} justify-end`}>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setItems((list) => list.filter((_, i) => i !== index))}
                      className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-destructive"
                      aria-label={t('removeItem')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {items.length < 50 && (
            <button type="button" onClick={() => setItems((list) => [...list, newItem()])} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              <Plus className="h-4 w-4" />
              {t('addItem')}
            </button>
          )}
          <Field label={t('fields.note')} className="mt-4">
            <textarea rows={2} maxLength={2000} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="mt-4 text-right text-lg font-bold">
            {t('total')}: {new Intl.NumberFormat(locale, { style: 'currency', currency }).format(total)}
          </p>
        </section>

        <div className="flex flex-col items-start gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t('download')}
          </button>
          <p className="text-xs text-muted-foreground">{t('privacy')}</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {done && (
            <div role="status" className="w-full rounded-xl border border-primary/30 bg-accent/50 p-4 text-sm">
              <p className="font-semibold">{t('doneTitle')}</p>
              <p className="mt-1 text-muted-foreground">{t('carryOver.title')}</p>
              {kept > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('carryOver.where')}{' '}
                  <button
                    type="button"
                    className="underline hover:text-foreground"
                    onClick={() => {
                      forgetGuestInvoices();
                      setKept(0);
                    }}
                  >
                    {t('carryOver.forget')}
                  </button>
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/signup?from=guest" className="inline-flex rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground hover:opacity-90">
                  {t('carryOver.cta')}
                </Link>
                <Link href="/demo" className="inline-flex rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-secondary">
                  {tDemo('cta')}
                </Link>
              </div>
            </div>
          )}
        </div>
      </form>

      <section className="mt-12" aria-labelledby="guest-features">
        <h2 id="guest-features" className="text-xl font-semibold tracking-tight">
          {t('showcase.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('showcase.lead')}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key} className="rounded-xl border border-border bg-card p-4">
              <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold">{t(`showcase.items.${key}.title`)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t(`showcase.items.${key}.text`)}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/signup" className="inline-flex rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground hover:opacity-90">
            {t('signup')}
          </Link>
          <Link href="/demo" className="inline-flex rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-secondary">
            {tDemo('cta')}
          </Link>
          <Link href="/features" className="inline-flex rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-secondary">
            {t('showcase.all')}
          </Link>
        </div>
      </section>
    </>
  );
}

function fromAres(p: AresPrefill): Party {
  return { name: p.legalName, ico: p.ico, dic: p.dic ?? '', street: p.addressStreet ?? '', city: p.addressCity ?? '', postalCode: p.addressPostalCode ?? '' };
}

/** IČO input with a "load from ARES" button (auto-runs once 8 digits are typed). */
function AresInput({ value, onChange, onFound }: { value: string; onChange: (v: string) => void; onFound: (p: AresPrefill) => void }) {
  const t = useTranslations('guestInvoice');
  const [state, setState] = useState<'idle' | 'loading' | 'notFound' | 'unavailable' | 'found'>('idle');
  const lastLooked = useRef('');

  async function lookup(ico: string) {
    const clean = ico.replace(/\s/g, '');
    if (!/^\d{8}$/.test(clean)) return;
    lastLooked.current = clean;
    setState('loading');
    try {
      const res = await fetch(`/api/public/guest-invoice/lookup?ico=${clean}`);
      if (!res.ok) {
        setState(res.status === 404 || res.status === 400 ? 'notFound' : 'unavailable');
        return;
      }
      onFound((await res.json()) as AresPrefill);
      setState('found');
    } catch {
      setState('notFound');
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex gap-2">
        <input
          className={inputClass}
          inputMode="numeric"
          value={value}
          placeholder="12345678"
          onChange={(e) => {
            onChange(e.target.value);
            setState('idle');
            const clean = e.target.value.replace(/\s/g, '');
            if (/^\d{8}$/.test(clean) && clean !== lastLooked.current) void lookup(clean);
          }}
        />
        <button
          type="button"
          onClick={() => void lookup(value)}
          disabled={!/^\d{8}$/.test(value.replace(/\s/g, '')) || state === 'loading'}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary disabled:opacity-50"
        >
          {state === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          ARES
        </button>
      </span>
      {state === 'found' && <span className="text-[11px] text-primary">{t('ares.found')}</span>}
      {state === 'notFound' && <span className="text-[11px] text-destructive">{t('ares.notFound')}</span>}
      {state === 'unavailable' && <span className="text-[11px] text-destructive">{t('ares.unavailable')}</span>}
    </span>
  );
}

type AiResult = {
  suggestion: {
    customer: { ico: string | null; name: string | null };
    items: { description: string; quantity: number; unit_price: number; vat_rate: number | null }[];
    currency: string;
    due_in_days: number | null;
    issue_date: string | null;
  };
  ares: AresPrefill | null;
  remaining: number;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/** Free text / dictation -> invoice fields, a few tries per visitor (backend-enforced). */
function AiFill({ vatPayer, billing, onResult }: { vatPayer: boolean; billing: Billing; onResult: (r: AiResult) => void }) {
  const t = useTranslations('guestInvoice.ai');
  const locale = useLocale();
  const [quota, setQuota] = useState<AiQuota | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    setSpeechSupported(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    fetch('/api/public/guest-invoice/ai')
      .then((r) => (r.ok ? (r.json() as Promise<AiQuota>) : null))
      .then((q) => q && setQuota(q))
      .catch(() => undefined);
  }, []);

  function toggleDictation() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = locale === 'en' ? 'en-US' : locale === 'sk' ? 'sk-SK' : 'cs-CZ';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ');
      setText((prev) => `${prev ? `${prev} ` : ''}${said}`.slice(0, 1500));
    };
    rec.onend = () => setListening(false);
    recognition.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/public/guest-invoice/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, vatPayer })
      });
      const body = (await res.json().catch(() => ({}))) as Partial<AiResult> & { error?: string };
      if (!res.ok) {
        if (body.error === 'ai_guest_limit' || body.error === 'ai_global_limit') setQuota((q) => (q ? { ...q, remaining: 0 } : q));
        setMessage({ kind: 'error', text: t(`errors.${body.error === 'ai_guest_limit' || body.error === 'ai_global_limit' || body.error === 'ai_unavailable' ? body.error : 'failed'}`) });
        return;
      }
      onResult(body as AiResult);
      setQuota((q) => (q ? { ...q, remaining: body.remaining ?? q.remaining } : q));
      setMessage({ kind: 'ok', text: t('applied') });
    } catch {
      setMessage({ kind: 'error', text: t('errors.failed') });
    } finally {
      setBusy(false);
    }
  }

  if (quota && !quota.available) return null;
  const exhausted = quota?.remaining === 0;

  return (
    <section className="mt-6 rounded-xl border border-primary/30 bg-accent/40 p-4 sm:p-6" aria-labelledby="guest-ai">
      <div className="flex flex-wrap items-center gap-2">
        <Wand2 className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 id="guest-ai" className="text-base font-bold">
          {t('title')}
        </h2>
        {quota && (
          <span className="ml-auto rounded-full bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {t('remaining', { remaining: quota.remaining, limit: quota.limit })}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('lead')}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <textarea
          rows={2}
          maxLength={1500}
          className={`${inputClass} h-auto`}
          placeholder={t(`placeholder.${billing}`)}
          value={text}
          disabled={exhausted}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2 sm:flex-col">
          {speechSupported && (
            <button
              type="button"
              onClick={toggleDictation}
              disabled={exhausted}
              aria-pressed={listening}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-secondary disabled:opacity-50"
            >
              {listening ? <MicOff className="h-4 w-4 text-destructive" /> : <Mic className="h-4 w-4" />}
              {listening ? t('stop') : t('dictate')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || exhausted || text.trim().length < 3}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {t('run')}
          </button>
        </div>
      </div>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${message.kind === 'error' ? 'text-destructive' : 'text-primary'}`}>
          {message.text}
        </p>
      )}
      {exhausted && (
        <p className="mt-2 text-sm">
          {t('exhausted')}{' '}
          <Link href="/signup" className="font-semibold text-primary hover:underline">
            {t('signupCta')}
          </Link>
        </p>
      )}
    </section>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ''}`}>
      {hint ? (
        <InfoHint label={label} hint={hint}>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </InfoHint>
      ) : (
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      )}
      {children}
    </label>
  );
}
