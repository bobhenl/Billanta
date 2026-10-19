'use client';

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { AI_PROMPT_KEY } from '@/components/command-palette';
import { BadgeCheck, Building2, ChevronDown, CloudOff, Copy, FileCheck2, Loader2, Lock, LockOpen, Plus, SlidersHorizontal, Sparkles, Star, Trash2, Wand2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { DictationButton } from '@/components/dictation-button';
import { FieldFinder, type FinderEntry } from '@/components/field-finder';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { useOffline } from '@/components/offline-sync';
import { VoiceNoteRecorder } from '@/components/voice-note-recorder';
import { OFFLINE_CONTACT_PREFIX, queueOffline } from '@/lib/offline-outbox';
import { Typeahead, type TypeaheadGroup } from '@/components/typeahead';
import { RegistryPicker, useCompanyRegistry } from '@/components/registry-picker';
import { fetchContactSearch } from '@/components/company-lookup';
import { hasSlowRegistryPart, type RegistryPart } from '@/lib/company-lookup';
import { REVERSE_CHARGE_CODE_VALUES, homeCurrencyOf, isReverseChargeCode, isWorkingDay, nextWorkingDay, publicHolidayOn } from '@faktur/cz-compliance';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { fieldKey, formattedVars, resolveVars } from '@/lib/custom-fields';
import { CopyFromInvoicePanel } from './copy-from-invoice';
import { fetchExchangeRate, saveInvoice, suggestInvoice, suggestItems } from './actions';
import type {
  AiSettings,
  AresPrefill,
  Contact,
  CustomField,
  DocLanguage,
  DocumentType,
  FormDefaults,
  InvoiceDraftInput,
  InvoiceTemplate,
  ItemSuggestion,
  OptionalField,
  PaymentMethod,
  SelectedCustomer,
  SuggestionResult
} from './types';

type CustomerOption = { kind: 'contact'; contact: Contact } | { kind: 'ares'; ares: AresPrefill };

interface Row {
  key: number;
  description: string;
  quantity: string;
  unit: string;
  code: string;
  unitPrice: string;
  discount: string;
  vatRate: string; // '' = no VAT
  /** Price incl. VAT as typed in "prices with VAT" mode; `unitPrice` stays the net source of truth. */
  gross?: string;
}

const VAT_RATES = ['21', '12', '0'];
const DUE_PRESETS = [7, 14, 30];
const CURRENCIES = ['CZK', 'EUR', 'USD', 'GBP', 'PLN'];
const PAYMENT_METHODS: PaymentMethod[] = ['bank_transfer', 'cash', 'card', 'cash_on_delivery', 'other'];
const LANGUAGES: DocLanguage[] = ['cs', 'sk', 'en'];
const UNITS = ['ks', 'hod', 'den', 'měs', 'm', 'm²', 'kg', 'km', 'bal'];
/** Credit notes are created from an issued invoice ("Vytvořit dobropis"), never from scratch. */
const NEW_TYPES: DocumentType[] = ['invoice', 'proforma', 'quote'];
/** Search synonyms per field (cs/sk/en, abbreviations) for the field finder. */
const FIELD_KEYWORDS: Record<string, string> = {
  documentType: 'typ doklad faktura zálohová proforma nabídka cenová ponuka quote invoice',
  customer: 'odběratel zákazník klient firma ičo dič odberateľ customer client company ares',
  items: 'položky řádky popis služba zboží cena položky items lines product service',
  itemCode: 'ean kód sku katalog code',
  unit: 'jednotka ks hod mj unit pcs hours',
  discount: 'sleva zľava procenta discount rabat',
  vatRate: 'dph sazba daň vat tax rate',
  orderNumber: 'objednávka obj číslo objednávky order po purchase',
  issuePlace: 'místo vystavení miesto město place city',
  issuedBy: 'vystavil vystavila jméno podpis issued by name signature',
  customFields: 'vlastní pole smlouva projekt custom fields contract project',
  noteBelow: 'poznámka text pod patička zápatí note footer below',
  noteAbove: 'text nad úvod úvodní note above intro',
  internalNote: 'interní poznámka soukromá internal private note',
  issueDate: 'datum vystavení dátum vystavenia issue date',
  taxableSupplyDate: 'duzp datum zdanitelného plnění dátum dodania taxable supply tax point',
  dueDate: 'splatnost datum splatnosti platnost platnosť due date validity',
  paymentMethod: 'způsob úhrady platby převod hotovost karta dobírka payment method cash card transfer',
  currency: 'měna mena eur usd czk currency',
  exchangeRate: 'kurz čnb devizový exchange rate fx',
  bankAccount: 'bankovní účet iban banka bank account',
  variableSymbol: 'vs variabilní symbol variabilný variable symbol',
  symbols: 'ks ss konstantní specifický konštantný špecifický constant specific symbol',
  language: 'jazyk dokladu jazyk čeština angličtina language english',
  reverseCharge: 'přenesená daňová povinnost prenesenie reverse charge rpdp'
};
/** Sidebar section each field lives in (they can be folded away). */
const FIELD_SECTION: Record<string, string> = {
  issueDate: 'dates',
  taxableSupplyDate: 'dates',
  dueDate: 'dates',
  paymentMethod: 'payment',
  currency: 'payment',
  exchangeRate: 'payment',
  bankAccount: 'payment',
  variableSymbol: 'payment',
  symbols: 'payment',
  language: 'settings',
  reverseCharge: 'settings'
};
const OPTIONAL_FIELDS = new Set<string>([
  'itemCode',
  'unit',
  'discount',
  'taxableSupplyDate',
  'symbols',
  'orderNumber',
  'issuePlace',
  'issuedBy',
  'noteAbove',
  'internalNote',
  'customFields',
  'language'
]);

let rowSeq = 0;
const newRow = (defaultVat: string, partial: Partial<Row> = {}): Row => ({
  key: ++rowSeq,
  description: '',
  quantity: '1',
  unit: '',
  code: '',
  unitPrice: '',
  discount: '',
  vatRate: defaultVat,
  ...partial
});

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isoDate = (value: string | null | undefined) => (value ? value.slice(0, 10) : '');
/** YYYY-MM-DD as a local calendar date (working-day helpers ignore time zones). */
const localDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = (value: string) => {
  const n = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
/** Net unit price from a gross one, kept to 4 decimals so 1 000 incl. 21 % stays 1 000,00 after VAT. */
const netOf = (gross: string, rate: number) => {
  if (!gross.trim()) return '';
  return String(Math.round((num(gross) / (1 + rate / 100)) * 10000) / 10000);
};
const grossOf = (net: string, rate: number) => {
  if (!net.trim()) return '';
  return String(Math.round(num(net) * (1 + rate / 100) * 100) / 100);
};
const lineBase = (row: Row) => num(row.quantity) * num(row.unitPrice) * (1 - Math.min(100, Math.max(0, num(row.discount))) / 100);

/** `issued`: "Přesto upravit" on an issued or paid document — needs a reason, never re-issues. */
export type InvoiceFormMode =
  | { kind: 'create'; templateId?: string | null }
  | { kind: 'edit'; id: string; issued?: boolean; reason?: string };

/**
 * The invoice form — new drafts and editing an existing one. Three ways in,
 * all ending in the same reviewed form: type it, pick from suggestions
 * (customers from your contacts + ARES, items from your past invoices), or
 * describe the invoice in a sentence and let AI pre-fill it. A draft gets its
 * number only when it is issued — either here ("Uložit a vystavit") or later
 * from its detail.
 */
/** Ready-made custom fields; the fees are typical list prices to adjust. */
const FIELD_PRESETS = {
  net: { value: '{net}', kind: 'formula', internal: true },
  afterTax: { value: '{base} - {tax}', kind: 'formula', internal: true },
  afterTaxSocial: { value: '{base} - {tax} - {social}', kind: 'formula', internal: true },
  reserve: { value: '{tax} + {social} + {health}', kind: 'formula', internal: true },
  paypal: { value: '{amount} * 3,4 % + 10', kind: 'formula', internal: true },
  stripe: { value: '{amount} * 1,5 % + 6,5', kind: 'formula', internal: true },
  wise: { value: '{amount} * 0,6 %', kind: 'formula', internal: true },
  gopay: { value: '{amount} * 1,4 % + 3', kind: 'formula', internal: true },
  deposit: { value: '50', kind: 'percent' }
} satisfies Record<string, Omit<CustomField, 'label'>>;
type FieldPresetKey = keyof typeof FIELD_PRESETS | 'margin';
const FIELD_PRESET_GROUPS: { label: string; keys: FieldPresetKey[] }[] = [
  { label: 'profit', keys: ['net', 'afterTax', 'afterTaxSocial', 'reserve', 'margin'] },
  { label: 'fees', keys: ['paypal', 'stripe', 'wise', 'gopay'] },
  { label: 'customer', keys: ['deposit'] }
];

export function InvoiceForm({
  mode = { kind: 'create' },
  defaults,
  ai,
  starred = [],
  template = null
}: {
  mode?: InvoiceFormMode;
  defaults: FormDefaults;
  ai: AiSettings | null;
  /** Starred customers, offered as one-tap picks while no customer is chosen. */
  starred?: Contact[];
  /** Start from a duplicated invoice, a saved template, a chosen customer, or (edit) the draft itself. */
  template?: InvoiceTemplate | null;
}) {
  const t = useTranslations('invoiceForm');
  const tDoc = useTranslations('doc');
  const tHoliday = useTranslations('holidays');
  const tLookup = useTranslations('companyLookup');
  const tOffline = useTranslations('offline');
  const offline = useOffline();
  // Contacts written offline and not synced yet: pickable like starred ones (docs/offline-drafts-plan.md).
  const queuedContacts = useMemo(
    () =>
      offline.items.flatMap((item): Contact[] =>
        item.kind === 'contact'
          ? [
              {
                id: OFFLINE_CONTACT_PREFIX + item.id,
                legalName: item.payload.legalName ?? item.label,
                ico: item.payload.ico ?? null,
                dic: item.payload.dic ?? null,
                email: item.payload.email ?? null,
                contactPerson: item.payload.contactPerson ?? null,
                addressStreet: item.payload.addressStreet ?? null,
                addressCity: item.payload.addressCity ?? null,
                addressPostalCode: item.payload.addressPostalCode ?? null,
                addressCountry: item.payload.addressCountry ?? 'CZ',
                isVatPayer: item.payload.isVatPayer ?? null,
                isStarred: false,
                isPerson: item.payload.isPerson
              }
            ]
          : []
      ),
    [offline.items]
  );
  const sellerCountry = defaults.sellerCountry ?? 'CZ';
  const home = homeCurrencyOf(sellerCountry);
  // The rate field shows the rate the way its source quotes it (ČNB: CZK per unit, ECB: units per
  // euro); the API stores home currency per unit. For EUR that is 1/x, which is its own inverse.
  const quoted = (rate: number) => (home === 'EUR' ? 1 / rate : rate);
  const rateSource = home === 'EUR' ? 'ECB' : 'ČNB';
  const locale = useLocale();
  const router = useRouter();
  const editing = mode.kind === 'edit';
  const issuedEdit = mode.kind === 'edit' && Boolean(mode.issued);
  const [editReason, setEditReason] = useState(mode.kind === 'edit' ? mode.reason ?? '' : '');
  const { vatPayer } = defaults;
  const defaultVat = vatPayer ? '21' : '';
  // A blank new invoice (no copy, no template; a chosen customer alone still
  // counts) starts from Settings → Faktury → Výchozí hodnoty.
  const blank = mode.kind === 'create' && !template?.items && !template?.templateName && template?.sourceNumber === undefined ? defaults.blank : undefined;

  const [documentType, setDocumentType] = useState<DocumentType>(template?.documentType ?? 'invoice');
  const [customer, setCustomer] = useState<SelectedCustomer | null>(() => {
    const contact = template?.contact ?? blank?.contact;
    return contact ? { kind: 'contact', id: contact.id, contact } : null;
  });
  const [customerQuery, setCustomerQuery] = useState('');
  // The document keeps its own copy: an edit or a copy shows what it had, a fresh pick the contact's.
  const [buyerContactPerson, setBuyerContactPerson] = useState(
    () => template?.buyerContactPerson ?? (template?.contact ?? blank?.contact)?.contactPerson ?? ''
  );
  const chooseCustomer = (next: SelectedCustomer) => {
    setCustomer(next);
    setBuyerContactPerson(next.kind === 'contact' ? (next.contact.contactPerson ?? '') : '');
  };
  const [registry, setRegistry] = useCompanyRegistry();
  const [issueDate, setIssueDate] = useState(() => isoDate(template?.issueDate) || today());
  const [dueDate, setDueDate] = useState(
    () => isoDate(template?.dueDate) || addDays(isoDate(template?.issueDate) || today(), template?.dueInDays ?? defaults.dueDays)
  );
  const dueHoliday = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? publicHolidayOn(localDay(dueDate), sellerCountry) : null;
  const [taxableSupplyDate, setTaxableSupplyDate] = useState(() => isoDate(template?.taxableSupplyDate));
  const [currency, setCurrency] = useState(() => {
    const wanted = template?.currency ?? blank?.currency;
    return wanted && CURRENCIES.includes(wanted) ? wanted : home;
  });
  const [exchangeRate, setExchangeRate] = useState(() =>
    Number(template?.exchangeRate) > 0 ? String(Number(quoted(Number(template!.exchangeRate)).toFixed(4))) : ''
  );
  const [bankAccountId, setBankAccountId] = useState(() => {
    const wanted = template?.bankAccountId ?? blank?.bankAccountId;
    return wanted && defaults.bankAccounts.some((a) => a.id === wanted) ? wanted : '';
  });
  const [loadingRate, setLoadingRate] = useState(false);
  const [paidValue, setPaidValue] = useState('');
  const [paidUnit, setPaidUnit] = useState<'amount' | 'percent'>('amount');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(template?.paymentMethod ?? defaults.paymentMethod);
  const [paymentMethodLabel, setPaymentMethodLabel] = useState(template?.paymentMethodLabel ?? '');
  const [paymentInstructions, setPaymentInstructions] = useState(template?.paymentInstructions ?? '');
  const customMethods = defaults.customPaymentMethods ?? [];
  // Select value: a built-in key, `custom:<id>`, or `custom:` for a label no longer in the settings.
  const paymentChoice = paymentMethodLabel ? `custom:${customMethods.find((m) => m.label === paymentMethodLabel)?.id ?? ''}` : paymentMethod;
  const choosePayment = (value: string) => {
    if (value.startsWith('custom:')) {
      const def = customMethods.find((m) => `custom:${m.id}` === value);
      if (!def) return;
      setPaymentMethod(def.base);
      setPaymentMethodLabel(def.label);
      setPaymentInstructions(def.instructions ?? '');
    } else {
      setPaymentMethod(value as PaymentMethod);
      setPaymentMethodLabel('');
      setPaymentInstructions('');
    }
  };
  const [variableSymbol, setVariableSymbol] = useState(template?.variableSymbol ?? '');
  const [constantSymbol, setConstantSymbol] = useState(template?.constantSymbol ?? '');
  const [specificSymbol, setSpecificSymbol] = useState(template?.specificSymbol ?? '');
  const [orderNumber, setOrderNumber] = useState(template?.orderNumber ?? '');
  const [language, setLanguage] = useState<DocLanguage>(template?.language ?? defaults.language);
  const [reverseCharge, setReverseCharge] = useState(Boolean(template?.reverseCharge));
  const [reverseChargeCode, setReverseChargeCode] = useState<string>(() => {
    const code = template?.reverseChargeCode;
    return isReverseChargeCode(code) ? code : '';
  });
  // Kontrolní hlášení A.1 needs the code only when the buyer has a Czech DIČ.
  const customerDic = customer?.kind === 'contact' ? customer.contact.dic : (customer?.ares.dic ?? null);
  const domesticReverseCharge = vatPayer && reverseCharge && /^CZ/i.test(customerDic?.trim() ?? '');
  // bitfaktura-style "I enter prices incl. VAT"; the default lives in Settings → Invoices.
  const [grossPrices, setGrossPricesState] = useState(defaults.prefs.pricesIncludeVat);
  const [noteAbove, setNoteAbove] = useState(template?.noteAbove ?? blank?.noteAbove ?? '');
  const [noteBelow, setNoteBelow] = useState(() => (template && template.noteBelow !== undefined ? template.noteBelow ?? '' : defaults.noteBelow ?? ''));
  const [internalNote, setInternalNote] = useState(template?.internalNote ?? '');
  const { prefs } = defaults;
  const [issuePlace, setIssuePlace] = useState(() => template?.issuePlace ?? (editing ? '' : prefs.defaultIssuePlace ?? ''));
  const [issuedByName, setIssuedByName] = useState(() => template?.issuedByName ?? (editing ? '' : prefs.defaultIssuedBy ?? ''));
  const [customFields, setCustomFields] = useState<CustomField[]>(() => {
    const existing = template?.customFields ?? [];
    const preset = prefs.customFieldLabels.filter((label) => !existing.some((f) => f.label === label)).map((label) => ({ label, value: '' }));
    return [...existing, ...preset];
  });

  const [rows, setRows] = useState<Row[]>(() =>
    template?.items?.length
      ? template.items.map((item) =>
          newRow(defaultVat, {
            description: item.description,
            quantity: String(item.quantity),
            unit: item.unit ?? '',
            code: item.code ?? '',
            unitPrice: String(item.unitPrice),
            discount: item.discountPercent ? String(item.discountPercent) : '',
            vatRate: vatPayer ? (item.vatRate == null ? '' : String(item.vatRate)) : ''
          })
        )
      : blank?.items.length
        ? blank.items.map((item) =>
            newRow(defaultVat, {
              description: item.description,
              quantity: String(item.quantity),
              unit: item.unit ?? '',
              unitPrice: item.unitPrice ? String(item.unitPrice) : '',
              vatRate: vatPayer ? (item.vatRate == null ? '' : String(item.vatRate)) : ''
            })
          )
        : [newRow(defaultVat)]
  );
  // Optional fields: expanded when the company wants them (Nastavení →
  // Faktury) or when the document already has a value; otherwise one
  // "+ field" chip away.
  const [shown, setShown] = useState<Record<OptionalField, boolean>>(() => {
    const items: { code?: string | null; unit?: string | null; discountPercent?: number }[] = template?.items ?? blank?.items ?? [];
    const has: Record<OptionalField, boolean> = {
      itemCode: items.some((i) => i.code),
      unit: items.some((i) => i.unit),
      discount: items.some((i) => i.discountPercent),
      taxableSupplyDate: Boolean(template?.taxableSupplyDate),
      symbols: Boolean(template?.constantSymbol || template?.specificSymbol),
      orderNumber: Boolean(template?.orderNumber),
      issuePlace: Boolean(template?.issuePlace),
      issuedBy: Boolean(template?.issuedByName),
      noteAbove: Boolean(template?.noteAbove ?? blank?.noteAbove),
      internalNote: Boolean(template?.internalNote),
      // Preset labels from settings only make sense if the editor is visible.
      customFields: Boolean(template?.customFields?.some((f) => f.value)) || prefs.customFieldLabels.length > 0,
      language: Boolean(template?.language && template.language !== defaults.language)
    };
    return Object.fromEntries(Object.entries(prefs.show).map(([k, v]) => [k, v || has[k as OptionalField]])) as Record<OptionalField, boolean>;
  });
  const reveal = (f: OptionalField) => setShown((current) => ({ ...current, [f]: true }));
  const [collapsed, setCollapsed] = useCollapsedSections();

  const [prefilledByAi, setPrefilledByAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [savingIntent, setSavingIntent] = useState<'draft' | 'issue' | null>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiBusy, startAi] = useTransition();
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  // `?dictate=1` (dashboard tile "Nadiktovat fakturu"): open the AI box and start the mic.
  const [dictateNow, setDictateNow] = useState(false);
  const aiUsable = Boolean(ai && ai.mode !== 'off' && (ai.mode === 'own' ? ai.hasOwnKey : ai.platformAvailable));

  const isQuote = documentType === 'quote';
  // Offline, a new invoice can still take a voice note: it is queued and becomes a draft for review once synced.
  // Not for quotes, the backend turns a note into an invoice.
  const voiceOffline = !offline.online && Boolean(offline.scope) && mode.kind === 'create' && !isQuote;
  const money = useMemo(() => new Intl.NumberFormat(locale, { style: 'currency', currency }), [locale, currency]);
  const totals = useMemo(() => {
    const byRate = new Map<string, { base: number; vat: number }>();
    let base = 0;
    let vat = 0;
    for (const row of rows) {
      if (!row.description.trim() && !row.unitPrice) continue;
      const line = lineBase(row);
      const rate = vatPayer && row.vatRate !== '' ? num(row.vatRate) : null;
      const lineVat = rate != null && !reverseCharge ? (line * rate) / 100 : 0;
      base += line;
      vat += lineVat;
      if (rate != null) {
        const key = String(rate);
        const bucket = byRate.get(key) ?? { base: 0, vat: 0 };
        bucket.base += line;
        bucket.vat += lineVat;
        byRate.set(key, bucket);
      }
    }
    return { base, vat, total: base + vat, byRate: [...byRate.entries()].sort((a, b) => Number(b[0]) - Number(a[0])) };
  }, [rows, vatPayer, reverseCharge]);
  const paidNumber = Number(paidValue.replace(',', '.')) || 0;
  // Partial payment received up front (bitfaktura-style), as an amount or % of the total.
  const paidAmount = paidNumber > 0 ? Math.min(totals.total, Math.round((paidUnit === 'percent' ? (totals.total * paidNumber) / 100 : paidNumber) * 100) / 100) : undefined;

  const fieldMoney = new Intl.NumberFormat(locale, { style: 'currency', currency });
  // Numbers behind amount / % / formula custom fields, for the live preview.
  const fieldVars = useMemo(
    () => resolveVars(customFields, { totalWithoutVat: totals.base, totalVat: totals.vat, totalWithVat: totals.total }, paidAmount, defaults.companyVars),
    [customFields, totals, paidAmount, defaults.companyVars]
  );
  // What `{placeholders}` in the notes turn into, as far as the form knows
  // already; the rest (number, link…) is filled in when the PDF is made.
  const noteVars = useMemo(() => {
    const date = (iso: string) => (iso ? new Intl.DateTimeFormat(locale).format(new Date(`${iso}T12:00:00`)) : '');
    const who = customer ? (customer.kind === 'contact' ? customer.contact : customer.ares) : null;
    const now = new Date();
    return {
      ...Object.fromEntries((defaults.companyVars ?? []).map((v) => [v.key, v.value])),
      ...formattedVars(fieldVars, (n) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n)),
      customer: who?.legalName ?? '',
      customer_ico: who?.ico ?? '',
      issue_date: date(issueDate),
      due_date: date(dueDate),
      vs: variableSymbol,
      today: new Intl.DateTimeFormat(locale).format(now),
      year: String(now.getFullYear())
    } as Record<string, string>;
  }, [defaults.companyVars, fieldVars, currency, customer, issueDate, dueDate, variableSymbol, locale]);
  const notePreview = (text: string) =>
    /\{[a-z_][a-z0-9_]*\}/.test(text) ? (
      <span className="block rounded-md bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{t('notes.preview')}: </span>
        {text.split(/(\{[a-z_][a-z0-9_]*\})/).map((part, i) => {
          const key = /^\{([a-z_][a-z0-9_]*)\}$/.exec(part)?.[1];
          if (!key) return part;
          const value = noteVars[key];
          return value ? (
            <span key={i} className="font-medium text-foreground">{value}</span>
          ) : (
            <span key={i} title={t('notes.previewLater')} className="rounded bg-primary/10 px-1 font-mono text-primary">{part}</span>
          );
        })}
      </span>
    ) : null;
  const companyNumberVars = (defaults.companyVars ?? []).filter((v) => v.value.trim() && Number.isFinite(Number(v.value.replace(/\s/g, '').replace(',', '.'))));
  const addFieldPreset = (preset: FieldPresetKey) => {
    const costs = t('fields.presets.costsLabel');
    const made: CustomField[] =
      preset === 'margin'
        ? [
            { label: costs, value: '0', kind: 'amount', internal: true },
            { label: t('fields.presets.margin'), value: `{base} - {${fieldKey(costs)}}`, kind: 'formula', internal: true }
          ]
        : [{ label: t(`fields.presets.${preset}`), ...FIELD_PRESETS[preset] }];
    setCustomFields((cur) => [...cur.filter((f) => f.label.trim() || f.value.trim()), ...made].slice(0, 10));
  };

  // Rate a gross price is converted at: none for non-payers and reverse charge.
  const grossRate = (row: Row) => (vatPayer && !reverseCharge && row.vatRate !== '' ? num(row.vatRate) : 0);
  const grossMode = grossPrices && vatPayer && !reverseCharge;
  const updateRow = (key: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        // A net price set from elsewhere (pick, AI) replaces a typed gross one.
        if (patch.unitPrice !== undefined && patch.gross === undefined) next.gross = undefined;
        // Changing the rate keeps the gross price the person typed.
        else if (patch.vatRate !== undefined && next.gross !== undefined) next.unitPrice = netOf(next.gross, grossRate(next));
        return next;
      })
    );
  const setGrossPrices = (on: boolean) => {
    setGrossPricesState(on);
    if (!on) setRows((current) => current.map((row) => ({ ...row, gross: undefined })));
  };
  const duplicateRow = (key: number) =>
    setRows((current) => current.flatMap((row) => (row.key === key ? [row, { ...row, key: ++rowSeq }] : [row])));

  const fetchCustomers = async (q: string): Promise<TypeaheadGroup<CustomerOption>[]> => {
    // Own contacts first – instant; the registers (slower, abroad even more) arrive in registryFetchers.
    const { contacts } = await fetchContactSearch(q, 'none');
    return [{ label: t('customer.yourContacts'), items: contacts.map((contact) => ({ kind: 'contact' as const, contact })) }];
  };
  const registryPart = (part: RegistryPart) => async (q: string): Promise<TypeaheadGroup<CustomerOption>[]> => {
    if (part === 'slow' && !hasSlowRegistryPart(q, registry)) return [];
    const { ares } = await fetchContactSearch(q, registry, part);
    return [{ label: t('customer.fromAres'), items: ares.map((a) => ({ kind: 'ares' as const, ares: a })) }];
  };
  // ARES first, the Slovak RPO name search (seconds) after it, appended under the same heading.
  const registryFetchers = [registryPart('fast'), registryPart('slow')];

  const applySuggestion = ({ suggestion, contact, ares }: SuggestionResult) => {
    if (contact) {
      chooseCustomer({ kind: 'contact', id: contact.id, contact });
    } else if (ares) {
      chooseCustomer({ kind: 'ares', ares });
    } else if (suggestion.customer.ico || suggestion.customer.name) {
      // Not found anywhere: put what was said into the search box so the
      // person can pick or create the right company.
      setCustomer(null);
      setCustomerQuery(suggestion.customer.ico ?? suggestion.customer.name ?? '');
    }
    if (suggestion.items.length > 0) {
      setRows(
        suggestion.items.map((item) =>
          newRow(defaultVat, {
            description: item.description,
            quantity: String(item.quantity),
            unitPrice: String(item.unit_price),
            vatRate: vatPayer ? String(item.vat_rate ?? defaultVat) : ''
          })
        )
      );
    }
    if (CURRENCIES.includes(suggestion.currency)) setCurrency(suggestion.currency);
    const issue = suggestion.issue_date && /^\d{4}-\d{2}-\d{2}$/.test(suggestion.issue_date) ? suggestion.issue_date : issueDate;
    setIssueDate(issue);
    if (suggestion.due_in_days != null && suggestion.due_in_days >= 0) setDueDate(addDays(issue, suggestion.due_in_days));
    setPrefilledByAi(true);
    setAiNote(t('ai.applied'));
  };

  const runAi = (text: string = aiText) => {
    setAiError(null);
    setAiNote(null);
    // The text stays in the box, so it can be run once the connection is back.
    if (!navigator.onLine) return setAiError(tOffline('aiNeedsConnection'));
    startAi(async () => {
      let response: Awaited<ReturnType<typeof suggestInvoice>>;
      try {
        response = await suggestInvoice(text);
      } catch {
        setAiError(navigator.onLine ? t('errors.ai_provider_unavailable') : tOffline('aiNeedsConnection'));
        return;
      }
      if (response.ok) applySuggestion(response.result);
      else setAiError(t.has(`errors.${response.error}`) ? t(`errors.${response.error}`) : t('errors.ai_provider_unavailable'));
    });
  };

  // Handoff from the Ctrl+K palette ("Vytvořit fakturu s AI: …"): take the
  // typed request and run it right away when AI is available.
  useEffect(() => {
    if (editing) return;
    let prompt: string | null = null;
    try {
      prompt = sessionStorage.getItem(AI_PROMPT_KEY);
      sessionStorage.removeItem(AI_PROMPT_KEY);
    } catch {
      return;
    }
    if (!prompt?.trim()) {
      if (new URLSearchParams(window.location.search).get('dictate') === '1') {
        setAiOpen(true);
        setDictateNow(true);
      }
      return;
    }
    setAiOpen(true);
    setAiText(prompt);
    if (aiUsable && prompt.trim().length >= 3) runAi(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editing || navigator.onLine) return;
    const type = new URLSearchParams(window.location.search).get('type');
    if (type === 'invoice' || type === 'proforma' || type === 'quote') setDocumentType(type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+S saves, Ctrl+Shift+S saves and issues (listed in the "?" help sheet).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
      // A dialog on top (e.g. a new customer) saves its own form instead.
      if (event.defaultPrevented || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      event.preventDefault();
      if (!saving) submit(event.shiftKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Re-bound every render so `submit` sees the current form state.
  });

  const submit = (issue: boolean) => {
    setError(null);
    // A draft can wait for its customer (or be sent to them to fill in); issuing cannot.
    if (!customer && (issue || issuedEdit)) return setError(t('errors.customer_required'));
    const items = rows
      .filter((row) => row.description.trim())
      .map((row) => ({
        description: row.description.trim(),
        quantity: num(row.quantity) || 1,
        unit: row.unit.trim() || null,
        code: row.code.trim() || null,
        unitPrice: num(row.unitPrice),
        vatRate: !vatPayer || row.vatRate === '' ? null : num(row.vatRate),
        discountPercent: Math.min(100, Math.max(0, num(row.discount)))
      }));
    if (items.length === 0) return setError(t('errors.items_required'));
    for (const [value, max] of [
      [variableSymbol, 10],
      [specificSymbol, 10],
      [constantSymbol, 4]
    ] as const) {
      if (value.trim() && !new RegExp(`^\\d{1,${max}}$`).test(value.trim())) return setError(t('errors.symbol_invalid'));
    }

    if (issuedEdit && !editReason.trim()) return setError(t('errors.reason_required'));

    const input: InvoiceDraftInput = {
          customer: !customer ? null : customer.kind === 'contact' ? { kind: 'contact', id: customer.id } : { kind: 'ares', ares: customer.ares },
          documentType,
          issueDate,
          dueDate,
          // Hidden DUZP: a new document gets none, an edit keeps what is stored.
          taxableSupplyDate: vatPayer && !isQuote ? taxableSupplyDate : editing ? undefined : '',
          currency,
          exchangeRate: currency !== home && Number(exchangeRate.replace(',', '.')) > 0 ? String(quoted(Number(exchangeRate.replace(',', '.')))) : '',
          bankAccountId,
          paymentMethod,
          paymentMethodLabel,
          paymentInstructions,
          variableSymbol,
          constantSymbol,
          specificSymbol,
          orderNumber,
          buyerContactPerson,
          language,
          reverseCharge: vatPayer && reverseCharge,
          reverseChargeCode: domesticReverseCharge && isReverseChargeCode(reverseChargeCode) ? reverseChargeCode : null,
          noteAbove,
          noteBelow,
          internalNote,
          issuePlace,
          issuedByName,
          customFields,
          // A paid document keeps its payment; the backend moves it to a changed total.
          amountPaid: issuedEdit ? undefined : paidAmount,
          items,
          prefilledByAi,
          templateId: mode.kind === 'create' ? mode.templateId : null
    };

    // Offline, or the customer itself still waits in the queue: a new draft goes into the
    // offline queue. Numbering, issuing and edits need the server, so they wait for a connection.
    const queuedCustomer = customer?.kind === 'contact' && customer.id.startsWith(OFFLINE_CONTACT_PREFIX);
    const canQueue = mode.kind === 'create' && !issue && Boolean(offline.scope);
    const queue = async () => {
      const name = customer ? (customer.kind === 'contact' ? customer.contact.legalName : customer.ares.legalName) : tOffline('noCustomer');
      await queueOffline({ kind: 'invoice', scope: offline.scope!, label: `${name} – ${items[0]?.description ?? ''}`, payload: input });
      setSavingIntent(null);
      toast({ text: tOffline('invoiceQueued'), tone: 'ok' });
      offline.sync();
      // The invoice list is not kept offline; the dashboard is.
      router.push(navigator.onLine ? '/invoices' : '/dashboard');
    };
    if (!navigator.onLine || queuedCustomer) {
      if (!canQueue) {
        return setError(
          !issue
            ? tOffline('editNeedsConnection')
            : queuedCustomer && navigator.onLine
              ? tOffline('issueNeedsSyncedCustomer')
              : tOffline('issueNeedsConnection')
        );
      }
      setSavingIntent('draft');
      startSaving(queue);
      return;
    }

    setSavingIntent(issue ? 'issue' : 'draft');
    startSaving(async () => {
      let result: Awaited<ReturnType<typeof saveInvoice>>;
      try {
        result = await saveInvoice(input, {
          editId: mode.kind === 'edit' ? mode.id : undefined,
          issue: issue && !issuedEdit,
          editReason: issuedEdit ? editReason.trim() : undefined
        });
      } catch {
        // The request itself failed (the connection dropped meanwhile): keep a new draft locally.
        if (canQueue) return queue();
        setSavingIntent(null);
        setError(navigator.onLine ? t('errors.save_failed') : tOffline('issueNeedsConnection'));
        return;
      }
      setSavingIntent(null);
      if (!result.ok) {
        setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.save_failed'));
        return;
      }
      if (result.issueError) toast({ text: t('issueFailed', { reason: result.issueError }), tone: 'err' });
      else toast({ text: issue ? t('savedIssued') : editing ? t('savedChanges') : t('savedDraft'), tone: 'ok' });
      router.push(`/invoices/${result.id}`);
    });
  };

  const field = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30';
  const area = 'w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30';
  const label = 'text-xs font-bold uppercase tracking-wider text-muted-foreground';
  const card = 'rounded-xl border border-border bg-card p-4';
  // An issued document keeps its type (the number series belongs to it).
  const typeChoices =
    documentType === 'credit_note' || issuedEdit
      ? [documentType]
      : NEW_TYPES.filter((type) => type !== 'quote' || defaults.quotesEnabled || documentType === 'quote');
  // Desktop item grid: only the columns in use.
  const itemColumns = [
    'minmax(0,1fr)',
    shown.itemCode && '6rem',
    '4rem',
    shown.unit && '4.5rem',
    '6.5rem',
    shown.discount && '4rem',
    vatPayer && '5rem',
    '6.5rem',
    '4.5rem'
  ]
    .filter(Boolean)
    .join(' ');
  const gridStyle = { '--item-cols': itemColumns } as React.CSSProperties;
  const gridCols = 'md:[grid-template-columns:var(--item-cols)]';
  const chip = (f: OptionalField, text?: string) =>
    !shown[f] && (
      <button
        key={f}
        type="button"
        onClick={() => reveal(f)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Plus className="h-3 w-3" />
        {text ?? t(`fields.${f}`)}
      </button>
    );
  const docDetailsShown = shown.orderNumber || shown.issuePlace || shown.issuedBy || shown.customFields;

  const finderEntries = useMemo<FinderEntry[]>(() => {
    const sec = {
      type: t('type.label'),
      customer: t('customer.title'),
      items: t('items.title'),
      details: t('details.title'),
      notes: t('notes.title'),
      dates: t('dates.title'),
      payment: t('payment.title'),
      settings: t('settings.title')
    };
    const list: [string, string, string, boolean?][] = [
      ['documentType', t('type.label'), sec.type, documentType !== 'credit_note'],
      ['customer', t('customer.title'), sec.customer],
      ['items', t('items.description'), sec.items],
      ['itemCode', t('fields.itemCode'), sec.items],
      ['unit', t('items.unit'), sec.items],
      ['discount', t('items.discount'), sec.items],
      ['vatRate', t('items.vat'), sec.items, vatPayer],
      ['orderNumber', tDoc('fields.orderNumber'), sec.details],
      ['issuePlace', t('fields.issuePlace'), sec.details],
      ['issuedBy', t('fields.issuedBy'), sec.details],
      ['customFields', t('fields.customFields'), sec.details],
      ['noteBelow', t('notes.below'), sec.notes],
      ['noteAbove', t('notes.above'), sec.notes],
      ['internalNote', t('notes.internal'), sec.notes],
      ['issueDate', t('dates.issue'), sec.dates],
      ['taxableSupplyDate', t('dates.taxableSupply'), sec.dates, vatPayer && !isQuote],
      ['dueDate', isQuote ? t('dates.validUntil') : t('dates.due'), sec.dates],
      ['paymentMethod', tDoc('fields.paymentMethod'), sec.payment],
      ['currency', t('dates.currency'), sec.payment],
      ['exchangeRate', t('payment.exchangeRate', { pair: home === 'EUR' ? `${currency}/EUR` : `CZK/${currency}` }), sec.payment, currency !== home],
      ['bankAccount', t('payment.bankAccount'), sec.payment, paymentMethod === 'bank_transfer' && defaults.bankAccounts.length > 0],
      ['variableSymbol', tDoc('fields.variableSymbol'), sec.payment],
      ['symbols', t('fields.symbols'), sec.payment],
      ['language', t('settings.language'), sec.settings],
      ['reverseCharge', t('settings.reverseCharge'), sec.settings, vatPayer]
    ];
    return list
      .filter(([, , , available]) => available !== false)
      .map(([id, entryLabel, section]) => ({ id, label: entryLabel, section, keywords: FIELD_KEYWORDS[id] }));
  }, [t, tDoc, documentType, vatPayer, isQuote, currency, paymentMethod, defaults.bankAccounts.length]);

  const requiredState = [
    { id: 'customer', label: t('customer.title'), done: Boolean(customer) },
    { id: 'items', label: t('items.title'), done: rows.some((row) => row.description.trim()) },
    { id: 'issueDate', label: t('dates.issue'), done: /^\d{4}-\d{2}-\d{2}$/.test(issueDate) },
    { id: 'dueDate', label: t('dates.due'), done: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) }
  ];

  /** Makes a field visible before the finder jumps to it. */
  const showField = (id: string) => {
    if (OPTIONAL_FIELDS.has(id)) reveal(id as OptionalField);
    const section = FIELD_SECTION[id];
    if (section && collapsed.has(section)) setCollapsed(section);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <div className="min-w-0 space-y-4">
        <FieldFinder
          entries={finderEntries}
          onPick={showField}
          required={requiredState}
          labels={{
            placeholder: t('find.placeholder'),
            empty: t('find.empty'),
            required: (done, total) => t('find.required', { done, total }),
            allDone: t('find.allDone'),
            missing: t('find.missing')
          }}
          className="sticky top-14 z-20 -mx-1 bg-background/95 px-1 py-1.5 backdrop-blur xl:static xl:bg-transparent xl:p-0 xl:backdrop-blur-none"
        />
        {/* Document type */}
        <div data-field="documentType" role="radiogroup" aria-label={t('type.label')} className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-1.5">
          {typeChoices.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={documentType === type}
              onClick={() => setDocumentType(type)}
              className={cn(
                'flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                documentType === type ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {tDoc(`type.${type}`)}
            </button>
          ))}
        </div>
        <p className="-mt-2 px-1 text-xs text-muted-foreground">{t(`type.hint.${documentType}`)}</p>

        {/* AI pre-fill */}
        {!editing && (
          <div>
            {/* Two pre-fill options side by side; the open one expands full width below. */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setAiOpen((v) => !v); setCopyOpen(false); }}
                aria-expanded={aiOpen}
                className={cn(
                  'flex min-w-0 items-center gap-1.5 rounded-xl border p-3 text-left transition-colors',
                  aiOpen ? 'border-primary/30 bg-accent/40' : 'border-border bg-card hover:bg-secondary',
                )}
              >
                <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <h2 className="min-w-0 flex-1 truncate text-sm font-bold">{t('ai.title')}</h2>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aiOpen && 'rotate-180')} />
              </button>
              <button
                type="button"
                onClick={() => { setCopyOpen((v) => !v); setAiOpen(false); }}
                aria-expanded={copyOpen}
                className={cn(
                  'flex min-w-0 items-center gap-1.5 rounded-xl border p-3 text-left transition-colors',
                  copyOpen ? 'border-primary/30 bg-accent/40' : 'border-border bg-card hover:bg-secondary',
                )}
              >
                <Copy className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <h2 className="min-w-0 flex-1 truncate text-sm font-bold">{t('copy.title')}</h2>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', copyOpen && 'rotate-180')} />
              </button>
            </div>
            {copyOpen && (
              <section className="mt-2 rounded-xl border border-border bg-card p-4">
                {offline.online ? <CopyFromInvoicePanel /> : <p className="text-sm text-muted-foreground">{tOffline('copyNeedsConnection')}</p>}
              </section>
            )}
            {aiOpen && (
              <section className="mt-2 rounded-xl border border-primary/30 bg-accent/40 p-4">
                {
              (aiUsable ? (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">{t('ai.hint')}</p>
                  <textarea
                    value={aiText}
                    onChange={(event) => setAiText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && aiText.trim()) runAi();
                    }}
                    rows={2}
                    placeholder={t('ai.placeholder')}
                    className={cn(area, 'mt-3')}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => runAi()}
                      disabled={aiBusy || aiText.trim().length < 3 || !offline.online}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {aiBusy ? t('ai.working') : t('ai.run')}
                    </button>
                    {voiceOffline ? (
                      <VoiceNoteRecorder />
                    ) : (
                      <DictationButton
                        base={aiText}
                        autoStart={dictateNow && offline.online}
                        disabled={aiBusy || !offline.online}
                        onText={setAiText}
                        onDone={(text) => {
                          setDictateNow(false);
                          if (text.length >= 3) runAi(text);
                        }}
                      />
                    )}
                    <span className="text-xs text-muted-foreground">{ai?.mode === 'own' ? t('ai.usingOwn') : t('ai.usingPlatform')}</span>
                  </div>
                  {!offline.online && !aiError && (
                    <p className="mt-2 text-xs text-muted-foreground">{tOffline(voiceOffline ? 'voiceHint' : 'aiNeedsConnection')}</p>
                  )}
                  {aiError && (
                    <Banner tone="err" className="mt-2">
                      {aiError}
                    </Banner>
                  )}
                  {aiNote && <p className="mt-2 text-sm font-medium text-primary">{aiNote}</p>}
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('ai.unavailable')}{' '}
                  <Link href="/settings/ai" className="font-semibold text-foreground underline underline-offset-2">
                    {t('ai.setup')}
                  </Link>
                </p>
              ))}
              </section>
            )}
          </div>
        )}

        {/* Customer */}
        <section data-field="customer" className={card}>
          <InfoHint hint={t('customer.hint')}>
            <h2 className={label}>{t('customer.title')}</h2>
          </InfoHint>
          {customer ? (
            <div className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-secondary p-3">
              <CustomerSummary customer={customer} />
              <button
                type="button"
                onClick={() => setCustomer(null)}
                aria-label={t('customer.change')}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          {customer && (
            <label data-field="buyerContactPerson" className="mt-3 block space-y-1.5">
              <span className="text-sm font-medium">{t('customer.contactPerson')}</span>
              <input maxLength={255} value={buyerContactPerson} onChange={(e) => setBuyerContactPerson(e.target.value)} className={field} />
            </label>
          )}
          {customer ? null : (
            <>
              {(starred.length > 0 || queuedContacts.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t('customer.starred')}>
                  {[...queuedContacts, ...starred].map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => chooseCustomer({ kind: 'contact', id: contact.id, contact })}
                      title={contact.id.startsWith(OFFLINE_CONTACT_PREFIX) ? tOffline('queuedContact') : undefined}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-semibold transition-colors hover:border-primary hover:text-primary"
                    >
                      {contact.id.startsWith(OFFLINE_CONTACT_PREFIX) ? (
                        <CloudOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" aria-hidden="true" />
                      )}
                      <span className="truncate">{contact.legalName}</span>
                    </button>
                  ))}
                </div>
              )}
              {!offline.online && <p className="mt-3 text-xs text-muted-foreground">{tOffline('searchNeedsConnection')}</p>}
              <div className="mt-3 flex gap-2">
              <Typeahead<CustomerOption>
                className="min-w-0 flex-1"
                refreshKey={registry}
                value={customerQuery}
                onChange={setCustomerQuery}
                ariaLabel={t('customer.title')}
                placeholder={t('customer.placeholder')}
                emptyHint={t('customer.empty')}
                fetchGroups={fetchCustomers}
                fetchMoreGroups={registryFetchers}
                moreLoadingHint={[t('customer.searchingRegisters'), tLookup('searchingSlovak')]}
                getKey={(o) => (o.kind === 'contact' ? `c-${o.contact.id}` : `a-${o.ares.addressCountry}-${o.ares.ico ||o.ares.dic || o.ares.regNumber || o.ares.legalName}`)}
                onPick={(o) => chooseCustomer(o.kind === 'contact' ? { kind: 'contact', id: o.contact.id, contact: o.contact } : o)}
                renderItem={(o) => {
                  const name = o.kind === 'contact' ? o.contact.legalName : o.ares.legalName;
                  const ico = o.kind === 'contact' ? o.contact.ico : o.ares.ico;
                  // Foreign register hits have no IČO — show their VAT / registration number instead.
                  const foreignId = o.kind === 'ares' && !o.ares.ico ? (o.ares.dic ?? o.ares.regNumber) : null;
                  const country = o.kind === 'contact' ? o.contact.addressCountry : o.ares.addressCountry;
                  const city = [o.kind === 'contact' ? o.contact.addressCity : o.ares.addressCity, country && country !== 'CZ' ? country : null]
                    .filter(Boolean)
                    .join(', ');
                  return (
                    <span className="flex items-center gap-2">
                      {o.kind === 'ares' ? (
                        <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      ) : (
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{[ico && `IČO ${ico}`, foreignId, city].filter(Boolean).join(' · ')}</span>
                    </span>
                  );
                }}
              />
              <RegistryPicker value={registry} onChange={setRegistry} />
              </div>
              {!issuedEdit && <p className="mt-2 text-xs text-muted-foreground">{t('customer.draftWithout')}</p>}
            </>
          )}
        </section>

        {/* Items */}
        <section className={card}>
          <InfoHint hint={t('items.hint')}>
            <h2 className={label}>{t('items.title')}</h2>
          </InfoHint>
          {vatPayer && !reverseCharge && (
            <label data-field="grossPrices" className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={grossPrices} onChange={(e) => setGrossPrices(e.target.checked)} className="h-4 w-4 accent-primary" />
              {t('items.grossPrices')}
            </label>
          )}
          <div
            style={gridStyle}
            className={cn('mt-3 hidden gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid', gridCols)}
          >
            <span>{t('items.description')}</span>
            {shown.itemCode && <span>{t('fields.itemCode')}</span>}
            <span className="text-right">{t('items.quantity')}</span>
            {shown.unit && <span>{t('items.unit')}</span>}
            <span className="text-right">{grossMode ? t('items.unitPriceGross') : t('items.unitPrice')}</span>
            {shown.discount && <span className="text-right">{t('items.discount')}</span>}
            {vatPayer && <span>{t('items.vat')}</span>}
            <span className="text-right">{grossMode ? t('items.lineTotalGross') : t('items.lineTotal')}</span>
            <span />
          </div>
          <datalist id="invoice-units">
            {UNITS.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
          <div data-field="items" className="mt-2 space-y-2">
            {rows.map((row) => (
              <div key={row.key} style={gridStyle} className={cn('grid grid-cols-3 gap-2 rounded-lg border border-border p-2 md:border-0 md:p-0', gridCols)}>
                <Typeahead<ItemSuggestion>
                  className="col-span-3 md:col-span-1"
                  value={row.description}
                  onChange={(description) => updateRow(row.key, { description })}
                  ariaLabel={t('items.description')}
                  placeholder={t('items.description')}
                  fetchGroups={async (q) => [{ items: await suggestItems(q) }]}
                  getKey={(s) => s.description}
                  onPick={(s) =>
                    updateRow(row.key, {
                      description: s.description,
                      unitPrice: String(s.unitPrice),
                      vatRate: vatPayer ? (s.vatRate == null ? defaultVat : String(s.vatRate)) : ''
                    })
                  }
                  renderItem={(s) => (
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate">{s.description}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{money.format(s.unitPrice)}</span>
                    </span>
                  )}
                />
                {shown.itemCode && (
                  <input
                    data-field="itemCode"
                    aria-label={t('fields.itemCode')}
                    placeholder={t('fields.itemCodePlaceholder')}
                    value={row.code}
                    maxLength={32}
                    onChange={(event) => updateRow(row.key, { code: event.target.value })}
                    className={cn(field, 'px-2')}
                  />
                )}
                <input
                  inputMode="decimal"
                  aria-label={t('items.quantity')}
                  value={row.quantity}
                  onChange={(event) => updateRow(row.key, { quantity: event.target.value })}
                  className={cn(field, 'px-2 text-right')}
                />
                {shown.unit && (
                  <input
                    data-field="unit"
                    list="invoice-units"
                    aria-label={t('items.unit')}
                    placeholder={t('items.unitPlaceholder')}
                    value={row.unit}
                    maxLength={16}
                    onChange={(event) => updateRow(row.key, { unit: event.target.value })}
                    className={cn(field, 'px-2')}
                  />
                )}
                <input
                  inputMode="decimal"
                  aria-label={grossMode ? t('items.unitPriceGross') : t('items.unitPrice')}
                  placeholder="0"
                  value={grossMode ? (row.gross ?? grossOf(row.unitPrice, grossRate(row))) : row.unitPrice}
                  onChange={(event) =>
                    grossMode
                      ? updateRow(row.key, { gross: event.target.value, unitPrice: netOf(event.target.value, grossRate(row)) })
                      : updateRow(row.key, { unitPrice: event.target.value })
                  }
                  className={cn(field, 'px-2 text-right')}
                />
                {shown.discount && (
                  <div className="relative">
                    <input
                      data-field="discount"
                      inputMode="decimal"
                      aria-label={t('items.discount')}
                      placeholder="0"
                      value={row.discount}
                      onChange={(event) => updateRow(row.key, { discount: event.target.value })}
                      className={cn(field, 'pl-2 pr-5 text-right')}
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                )}
                {vatPayer && (
                  <select
                    data-field="vatRate"
                    aria-label={t('items.vat')}
                    value={row.vatRate}
                    onChange={(event) => updateRow(row.key, { vatRate: event.target.value })}
                    className={cn(field, 'px-2')}
                  >
                    {VAT_RATES.map((rate) => (
                      <option key={rate} value={rate}>
                        {rate} %
                      </option>
                    ))}
                  </select>
                )}
                <span className="flex h-10 items-center justify-end text-sm font-semibold tabular-nums">{money.format(grossMode ? lineBase(row) * (1 + grossRate(row) / 100) : lineBase(row))}</span>
                <span className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => duplicateRow(row.key)}
                    aria-label={t('items.duplicate')}
                    title={t('items.duplicate')}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRows((current) => (current.length > 1 ? current.filter((r) => r.key !== row.key) : current))}
                    aria-label={t('items.remove')}
                    title={t('items.remove')}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setRows((current) => [...current, newRow(defaultVat)])}
              className="mr-2 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              {t('items.add')}
            </button>
            {chip('itemCode')}
            {chip('unit', t('items.unit'))}
            {chip('discount', t('items.discount'))}
          </div>
        </section>

        {/* Document details: order number, place, issued by, custom header lines */}
        <section className={card}>
          <InfoHint hint={t('details.hint')}>
            <h2 className={label}>{t('details.title')}</h2>
          </InfoHint>
          {docDetailsShown && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {shown.orderNumber && (
                <label data-field="orderNumber" className="block space-y-1.5">
                  <span className="text-sm font-medium">{tDoc('fields.orderNumber')}</span>
                  <input maxLength={64} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className={field} />
                </label>
              )}
              {shown.issuePlace && (
                <label data-field="issuePlace" className="block space-y-1.5">
                  <span className="text-sm font-medium">{t('fields.issuePlace')}</span>
                  <input maxLength={100} value={issuePlace} onChange={(e) => setIssuePlace(e.target.value)} placeholder={t('fields.issuePlacePlaceholder')} className={field} />
                </label>
              )}
              {shown.issuedBy && (
                <label data-field="issuedBy" className="block space-y-1.5">
                  <span className="text-sm font-medium">{t('fields.issuedBy')}</span>
                  <input maxLength={100} value={issuedByName} onChange={(e) => setIssuedByName(e.target.value)} placeholder={t('fields.issuedByPlaceholder')} className={field} />
                </label>
              )}
              {shown.customFields && (
                <div data-field="customFields" className="space-y-2 sm:col-span-2">
                  <span className="text-sm font-medium">
                    <InfoHint hint={t('fields.customFieldsHint')}>{t('fields.customFields')}</InfoHint>
                  </span>
                  {customFields.map((f, i) => {
                    const key = fieldKey(f.label);
                    const numeric = Boolean(f.kind && f.kind !== 'text');
                    const value = numeric && key ? fieldVars[key] : undefined;
                    return (
                    <div key={i} className="space-y-1">
                    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_5.5rem_2.25rem_2.25rem] gap-2">
                      <input
                        aria-label={t('fields.customLabel')}
                        placeholder={t('fields.customLabel')}
                        maxLength={40}
                        value={f.label}
                        onChange={(e) => setCustomFields((cur) => cur.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                        className={field}
                      />
                      <input
                        aria-label={t('fields.customValue')}
                        placeholder={f.kind === 'formula' ? '{base} - {tax}' : t('fields.customValue')}
                        maxLength={200}
                        inputMode={f.kind === 'amount' || f.kind === 'percent' ? 'decimal' : undefined}
                        value={f.value}
                        onChange={(e) => setCustomFields((cur) => cur.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                        className={cn(field, f.internal && 'border-dashed bg-warning/5')}
                      />
                      <select
                        aria-label={t('fields.customKind')}
                        value={f.kind ?? 'text'}
                        onChange={(e) => setCustomFields((cur) => cur.map((x, j) => (j === i ? { ...x, kind: e.target.value as CustomField['kind'] } : x)))}
                        className={cn(field, 'px-1.5')}
                      >
                        <option value="text">{t('fields.kindText')}</option>
                        <option value="amount">{currency}</option>
                        <option value="percent">%</option>
                        <option value="formula">{t('fields.kindFormula')}</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setCustomFields((cur) => cur.map((x, j) => (j === i ? { ...x, internal: !x.internal } : x)))}
                        aria-pressed={Boolean(f.internal)}
                        aria-label={t('fields.customInternal')}
                        title={f.internal ? t('fields.customInternalOn') : t('fields.customInternalOff')}
                        className={cn(
                          'inline-flex h-10 w-9 items-center justify-center rounded-lg hover:bg-secondary',
                          f.internal ? 'text-warning' : 'text-muted-foreground'
                        )}
                      >
                        {f.internal ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomFields((cur) => cur.filter((_, j) => j !== i))}
                        aria-label={t('items.remove')}
                        className="inline-flex h-10 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {numeric && f.value.trim() && (
                      <p className={cn('pl-1 text-xs tabular-nums', value === undefined ? 'text-destructive' : 'text-muted-foreground')}>
                        {value === undefined ? (
                          t('fields.formulaError')
                        ) : (
                          <>
                            = <span className="font-semibold text-foreground">{fieldMoney.format(value)}</span>
                            {key && (
                              <>
                                {' · '}
                                <code className="rounded bg-muted px-1">{`{${key}}`}</code>
                              </>
                            )}
                          </>
                        )}
                      </p>
                    )}
                    </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">{t('fields.customHelp')}</p>
                  <p className="text-xs leading-6 text-muted-foreground">
                    <InfoHint hint={t('fields.formulaHint')}>{t('fields.formulaVars')}</InfoHint>{' '}
                    {['base', 'vat', 'amount', 'paid', 'remaining', 'net', 'tax', 'social', 'health', 'insurance', ...companyNumberVars.map((v) => v.key)].map((k) => (
                      <code key={k} className="mr-1 rounded bg-muted px-1">{`{${k}}`}</code>
                    ))}
                  </p>
                  {customFields.length < 10 && (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setCustomFields((cur) => [...cur, { label: '', value: '' }])}
                        className="text-sm font-semibold text-primary hover:underline"
                      >
                        + {t('fields.customAdd')}
                      </button>
                      <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Wand2 className="h-4 w-4" />
                        <select
                          aria-label={t('fields.presets.title')}
                          value=""
                          onChange={(e) => e.target.value && addFieldPreset(e.target.value as FieldPresetKey)}
                          className="rounded-lg border border-border bg-background px-2 py-1 text-sm"
                        >
                          <option value="">{t('fields.presets.title')}</option>
                          {FIELD_PRESET_GROUPS.map((group) => (
                            <optgroup key={group.label} label={t(`fields.presets.groups.${group.label}`)}>
                              {group.keys.map((k) => (
                                <option key={k} value={k}>
                                  {t(`fields.presets.${k}`)}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {!(shown.orderNumber && shown.issuePlace && shown.issuedBy && shown.customFields) && (
            <div className={cn('flex flex-wrap gap-1.5', docDetailsShown ? 'mt-3' : 'mt-2')}>
              {chip('orderNumber', tDoc('fields.orderNumber'))}
              {chip('issuePlace')}
              {chip('issuedBy')}
              {chip('customFields')}
            </div>
          )}
        </section>

        {/* Notes */}
        <section className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={label}>{t('notes.title')}</h2>
            <InfoHint hint={t('notes.varsHint')}>
              <Link href="/settings/variables" className="text-xs font-semibold text-primary hover:underline">
                {t('notes.vars')}
              </Link>
            </InfoHint>
          </div>
          <label data-field="noteBelow" className="mt-3 block space-y-1.5">
            <span className="text-sm font-medium">{t('notes.below')}</span>
            <textarea rows={2} value={noteBelow} maxLength={2000} onChange={(e) => setNoteBelow(e.target.value)} placeholder={t('notes.belowPlaceholder')} className={area} />
            {notePreview(noteBelow)}
          </label>
          {(shown.noteAbove || shown.internalNote) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {shown.noteAbove && (
                <label data-field="noteAbove" className="block space-y-1.5">
                  <span className="text-sm font-medium">{t('notes.above')}</span>
                  <textarea rows={2} value={noteAbove} maxLength={2000} onChange={(e) => setNoteAbove(e.target.value)} placeholder={t('notes.abovePlaceholder')} className={area} />
                  {notePreview(noteAbove)}
                </label>
              )}
              {shown.internalNote && (
                <label data-field="internalNote" className="block space-y-1.5">
                  <span className="text-sm font-medium">{t('notes.internal')}</span>
                  <textarea rows={2} value={internalNote} maxLength={2000} onChange={(e) => setInternalNote(e.target.value)} placeholder={t('notes.internalPlaceholder')} className={area} />
                </label>
              )}
            </div>
          )}
          {!(shown.noteAbove && shown.internalNote) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chip('noteAbove', t('notes.above'))}
              {chip('internalNote', t('notes.internal'))}
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Link href="/settings/invoices" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t('customize')}
          </Link>
        </div>
      </div>

      {/* Sidebar: dates, payment, settings, totals, save */}
      <aside className="grid gap-4 sm:grid-cols-2 xl:block xl:space-y-4 xl:sticky xl:top-20">
        <Collapsible id="dates" title={t('dates.title')} collapsed={collapsed} onToggle={setCollapsed} className={card} labelClass={label}>
          <label data-field="issueDate" className="block space-y-1.5">
            <span className="text-sm font-medium">{t('dates.issue')}</span>
            <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} className={field} />
          </label>
          {vatPayer && !isQuote && shown.taxableSupplyDate && (
            <label data-field="taxableSupplyDate" className="block space-y-1.5">
              <span className="text-sm font-medium">{t('dates.taxableSupply')}</span>
              <input type="date" value={taxableSupplyDate} onChange={(event) => setTaxableSupplyDate(event.target.value)} className={field} />
              <span className="block text-xs text-muted-foreground">{t('dates.taxableSupplyHint')}</span>
            </label>
          )}
          <div data-field="dueDate" className="space-y-1.5">
            <label htmlFor="due-date" className="text-sm font-medium">
              {isQuote ? t('dates.validUntil') : t('dates.due')}
            </label>
            <input id="due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={field} />
            <div className="flex gap-1.5">
              {DUE_PRESETS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setDueDate(addDays(issueDate, days))}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
                    dueDate === addDays(issueDate, days) ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t('dates.days', { days })}
                </button>
              ))}
            </div>
            {/^\d{4}-\d{2}-\d{2}$/.test(dueDate) && !isWorkingDay(localDay(dueDate), sellerCountry) && (
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-warning">
                {dueHoliday
                  ? t('dates.dueOnHoliday', { name: tHoliday.has(dueHoliday.key) ? tHoliday(dueHoliday.key) : dueHoliday.name })
                  : t('dates.dueOnWeekend')}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => setDueDate(localIso(nextWorkingDay(localDay(dueDate), sellerCountry)))}
                >
                  {t('dates.shiftToWorkday')}
                </button>
              </p>
            )}
          </div>
          {vatPayer && !isQuote && !shown.taxableSupplyDate && (
            <div className="flex flex-wrap gap-1.5">{chip('taxableSupplyDate', t('dates.taxableSupply'))}</div>
          )}
        </Collapsible>

        <Collapsible id="payment" title={t('payment.title')} collapsed={collapsed} onToggle={setCollapsed} className={card} labelClass={label}>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <label data-field="paymentMethod" className="block space-y-1.5">
              <span className="text-sm font-medium">{tDoc('fields.paymentMethod')}</span>
              <select value={paymentChoice} onChange={(e) => choosePayment(e.target.value)} className={field}>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {tDoc(`payment.${method}`)}
                  </option>
                ))}
                {(customMethods.length > 0 || paymentChoice === 'custom:') && (
                  <optgroup label={t('payment.customGroup')}>
                    {paymentChoice === 'custom:' && <option value="custom:">{paymentMethodLabel}</option>}
                    {customMethods.map((m) => (
                      <option key={m.id} value={`custom:${m.id}`}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label data-field="currency" className="block space-y-1.5">
              <span className="text-sm font-medium">{t('dates.currency')}</span>
              <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={field}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          {paymentMethodLabel && (
            <label data-field="paymentInstructions" className="block space-y-1.5">
              <span className="text-sm font-medium">{t('payment.instructions')}</span>
              <textarea
                rows={2}
                value={paymentInstructions}
                maxLength={500}
                onChange={(e) => setPaymentInstructions(e.target.value)}
                placeholder={t('payment.instructionsPlaceholder')}
                className={field}
              />
            </label>
          )}
          {currency !== home && (
            <div data-field="exchangeRate" className="space-y-1.5">
              <span className="text-sm font-medium">{t('payment.exchangeRate', { pair: home === 'EUR' ? `${currency}/EUR` : `CZK/${currency}` })}</span>
              <div className="flex gap-2">
                <input
                  inputMode="decimal"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder={t('payment.exchangeRateAuto', { source: rateSource })}
                  className={field}
                />
                <button
                  type="button"
                  disabled={loadingRate}
                  onClick={async () => {
                    setLoadingRate(true);
                    // The day the backend converts with at issue (the DUZP is only saved for a payer),
                    // so it recognises this as ČNB's rate and labels it as such.
                    const rate = await fetchExchangeRate(currency, (vatPayer && !isQuote && taxableSupplyDate) || issueDate).catch(() => null);
                    setLoadingRate(false);
                    if (rate) setExchangeRate(String(Number(quoted(rate).toFixed(4))));
                    else toast({ text: t('payment.exchangeRateFailed', { source: rateSource }), tone: 'err' });
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold hover:border-primary disabled:opacity-60"
                >
                  {loadingRate && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('payment.exchangeRateLoad', { source: rateSource })}
                </button>
              </div>
              {Number(exchangeRate.replace(',', '.')) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('payment.inCzk', {
                    amount: new Intl.NumberFormat(locale, { style: 'currency', currency: home }).format(
                      totals.total * quoted(Number(exchangeRate.replace(',', '.')))
                    )
                  })}
                </p>
              )}
            </div>
          )}
          {paymentMethod === 'bank_transfer' && defaults.bankAccounts.length > 0 && (
            <label data-field="bankAccount" className="block space-y-1.5">
              <span className="text-sm font-medium">{t('payment.bankAccount')}</span>
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={field}>
                <option value="">
                  {t('payment.bankAccountAuto', {
                    account:
                      (defaults.bankAccounts.find((a) => a.currency === currency)?.label ?? defaults.primaryAccount) || t('payment.bankAccountPrimary')
                  })}
                </option>
                {defaults.bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.line}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* Without extra accounts there is nothing to pick, but the account
              still belongs here: show the one that gets printed (and QR-coded),
              or say plainly that none is set yet. */}
          {paymentMethod === 'bank_transfer' && defaults.bankAccounts.length === 0 && (
            <div data-field="bankAccount" className="space-y-1.5">
              <span className="text-sm font-medium">{t('payment.bankAccount')}</span>
              {defaults.primaryAccount ? (
                <p className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium tabular-nums">{defaults.primaryAccount}</span>
                  <Link href="/settings/company" className="shrink-0 text-xs font-semibold text-primary hover:underline">
                    {t('payment.bankAccountManage')}
                  </Link>
                </p>
              ) : (
                <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  {t('payment.bankAccountMissing')}{' '}
                  <Link href="/settings/company" className="font-semibold text-primary hover:underline">
                    {t('payment.bankAccountAdd')}
                  </Link>
                </p>
              )}
            </div>
          )}
          {paymentMethod === 'bank_transfer' && defaults.bankAccounts.length > 0 && (
            <Link href="/settings/company" className="-mt-1 inline-block text-xs font-semibold text-primary hover:underline">
              {t('payment.bankAccountManage')}
            </Link>
          )}
          <label data-field="variableSymbol" className="block space-y-1.5">
            <span className="text-sm font-medium">{tDoc('fields.variableSymbol')}</span>
            <input
              inputMode="numeric"
              maxLength={10}
              value={variableSymbol}
              onChange={(e) => setVariableSymbol(e.target.value.replace(/\D/g, ''))}
              placeholder={t('payment.vsAuto')}
              className={field}
            />
          </label>
          {shown.symbols ? (
            <div className="grid grid-cols-2 gap-2">
              <label data-field="symbols" className="block space-y-1.5">
                <span className="text-sm font-medium">{t('payment.ks')}</span>
                <input inputMode="numeric" maxLength={4} value={constantSymbol} onChange={(e) => setConstantSymbol(e.target.value.replace(/\D/g, ''))} className={field} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">{t('payment.ss')}</span>
                <input inputMode="numeric" maxLength={10} value={specificSymbol} onChange={(e) => setSpecificSymbol(e.target.value.replace(/\D/g, ''))} className={field} />
              </label>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">{chip('symbols')}</div>
          )}
        </Collapsible>

        <Collapsible id="settings" title={t('settings.title')} collapsed={collapsed} onToggle={setCollapsed} className={card} labelClass={label}>
          {shown.language ? (
            <label data-field="language" className="block space-y-1.5">
              <span className="text-sm font-medium">{t('settings.language')}</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value as DocLanguage)} className={field}>
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {t(`settings.languages.${lang}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="flex flex-wrap gap-1.5">{chip('language', t('settings.language'))}</div>
          )}
          {vatPayer && (
            <label data-field="reverseCharge" className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>
                <span className="font-medium">{t('settings.reverseCharge')}</span>
                <span className="block text-xs text-muted-foreground">{t('settings.reverseChargeHint')}</span>
              </span>
            </label>
          )}
          {domesticReverseCharge && (
            <label data-field="reverseChargeCode" className="block space-y-1.5">
              <span className="text-sm font-medium">{t('settings.reverseChargeCode')}</span>
              <select value={reverseChargeCode} onChange={(e) => setReverseChargeCode(e.target.value)} className={field}>
                <option value="">{t('settings.reverseChargeCodeNone')}</option>
                {REVERSE_CHARGE_CODE_VALUES.map((code) => (
                  <option key={code} value={code}>
                    {code} – {t(`settings.reverseChargeCodes.${code}`)}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-muted-foreground">{t('settings.reverseChargeCodeHint')}</span>
            </label>
          )}
        </Collapsible>

        <section className={card}>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <dt>{t('totals.base')}</dt>
              <dd className="tabular-nums">{money.format(totals.base)}</dd>
            </div>
            {vatPayer &&
              !reverseCharge &&
              totals.byRate.map(([rate, bucket]) => (
                <div key={rate} className="flex justify-between text-muted-foreground">
                  <dt>{tDoc('vatAt', { rate })}</dt>
                  <dd className="tabular-nums">{money.format(bucket.vat)}</dd>
                </div>
              ))}
            {vatPayer && reverseCharge && <p className="text-xs text-muted-foreground">{tDoc('reverseChargeNote')}</p>}
            <div className="flex justify-between border-t border-border pt-2 text-lg font-extrabold">
              <dt>{t('totals.total')}</dt>
              <dd className="tabular-nums">{money.format(totals.total)}</dd>
            </div>
            {!isQuote && (
              <div className="flex items-center justify-between gap-2 pt-1 text-sm">
                <dt className="text-muted-foreground">
                  <InfoHint hint={t('totals.alreadyPaidHint')}>{t('totals.alreadyPaid')}</InfoHint>
                </dt>
                <dd className="flex items-center gap-1">
                  <input
                    className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right tabular-nums"
                    inputMode="decimal"
                    placeholder="0"
                    value={paidValue}
                    onChange={(e) => setPaidValue(e.target.value.replace(/[^\d.,]/g, ''))}
                  />
                  <select className="rounded-md border border-border bg-background px-1 py-1" value={paidUnit} onChange={(e) => setPaidUnit(e.target.value as 'amount' | 'percent')}>
                    <option value="amount">{currency}</option>
                    <option value="percent">%</option>
                  </select>
                </dd>
              </div>
            )}
            {paidAmount ? (
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">{t('totals.remaining')}</dt>
                <dd className="font-semibold tabular-nums">{money.format(Math.max(0, totals.total - paidAmount))}</dd>
              </div>
            ) : null}
          </dl>

          {error && (
            <Banner tone="err" className="mt-3">
              {error}
            </Banner>
          )}

          {issuedEdit && (
            <label className="mt-4 block space-y-1.5">
              <span className={label}>{t('editReason.label')}</span>
              <textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                rows={3}
                maxLength={1000}
                required
                placeholder={t('editReason.placeholder')}
                className={area}
              />
              <span className="block text-xs text-muted-foreground">{t('editReason.hint')}</span>
            </label>
          )}

          <div className="mt-4 space-y-2">
            {!issuedEdit && (
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={saving || !offline.online}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {savingIntent === 'issue' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
              {isQuote ? t('saveIssueQuote') : t('saveIssue')}
            </button>
            )}
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-6 py-2.5 text-sm font-bold transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              {savingIntent === 'draft' && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? t('saveChanges') : t('save')}
            </button>
            <Link
              href={mode.kind === 'edit' ? `/invoices/${mode.id}` : '/invoices'}
              className="block rounded-full px-4 py-2 text-center text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              {t('cancel')}
            </Link>
          </div>
          <p className="mt-1 text-center text-xs text-muted-foreground">{offline.online ? t('saveNote') : tOffline('formNote')}</p>
        </section>
      </aside>
    </div>
  );
}

const COLLAPSED_KEY = 'invoiceForm.collapsed';

/** Sidebar sections the person folded away, remembered per browser. */
function useCollapsedSections(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]');
      if (Array.isArray(stored)) setCollapsed(new Set(stored.filter((x) => typeof x === 'string')));
    } catch {
      // storage unavailable — start expanded
    }
  }, []);
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // not persisted; fine
      }
      return next;
    });
  return [collapsed, toggle];
}

function Collapsible({
  id,
  title,
  collapsed,
  onToggle,
  className,
  labelClass,
  children
}: {
  id: string;
  title: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  className: string;
  labelClass: string;
  children: ReactNode;
}) {
  const open = !collapsed.has(id);
  return (
    <section className={cn(className, 'space-y-3')}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={open} className="flex w-full items-center gap-1.5 text-left">
        <h2 className={cn(labelClass, 'flex-1')}>{title}</h2>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && children}
    </section>
  );
}

function CustomerSummary({ customer }: { customer: SelectedCustomer }) {
  const t = useTranslations('invoiceForm.customer');
  const c = customer.kind === 'contact' ? customer.contact : customer.ares;
  const address = [c.addressStreet, [c.addressPostalCode, c.addressCity].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return (
    <div className="min-w-0 text-sm">
      <p className="flex items-center gap-1.5 font-bold">
        {c.legalName}
        {customer.kind === 'ares' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground">
            <BadgeCheck className="h-3 w-3" /> {t('aresBadge')}
          </span>
        )}
      </p>
      <p className="text-muted-foreground">{[c.ico && `IČO ${c.ico}`, c.dic && `DIČ ${c.dic}`].filter(Boolean).join(' · ')}</p>
      {address && <p className="text-muted-foreground">{address}</p>}
      {customer.kind === 'contact' && customer.contact.email && <p className="text-muted-foreground">{customer.contact.email}</p>}
      {customer.kind === 'contact' && customer.contact.internalNote && (
        <p className="mt-1.5 flex gap-1.5 rounded-lg bg-warning/10 px-2 py-1.5 text-xs" title={t('internalNote')}>
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-label={t('internalNote')} />
          <span className="whitespace-pre-line">{customer.contact.internalNote}</span>
        </p>
      )}
      {customer.kind === 'ares' && <p className="mt-1 text-xs text-muted-foreground">{t('aresWillSave')}</p>}
    </div>
  );
}
