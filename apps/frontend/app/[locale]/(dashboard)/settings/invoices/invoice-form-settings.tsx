'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { DEFAULT_SHOWN, PDF_ACCENTS, type Contact, type DocLanguage, type InvoiceFormPrefs, type OptionalField } from '../../invoices/new/types';
import { updateInvoiceFormPrefs } from '../actions';
import { InvoiceDefaultsFields, parseNumber, type DefaultsDraft } from './invoice-defaults';
import { annualRatesOf, ExchangeRateSettings, type AnnualRateDraft } from './exchange-rate-settings';
import type { VatStatus } from '@faktur/cz-compliance';

/** Toggles grouped the way the invoice form lays them out. */
const GROUPS: { key: string; fields: OptionalField[] }[] = [
  { key: 'items', fields: ['itemCode', 'unit', 'discount'] },
  { key: 'dates', fields: ['taxableSupplyDate', 'symbols', 'language'] },
  { key: 'details', fields: ['orderNumber', 'issuePlace', 'issuedBy', 'customFields'] },
  { key: 'notes', fields: ['noteAbove', 'internalNote'] }
];

export function InvoiceFormSettings({
  prefs,
  company,
  defaultContact,
  bankAccounts,
  vatPayer,
  vatStatus,
  readOnly
}: {
  prefs: InvoiceFormPrefs;
  /** Defaults stored as tenant columns (they used to sit in Settings → Company). */
  company: { locale: DocLanguage; dueDays: number; paymentMethod: string; noteBelow: string | null };
  defaultContact: Contact | null;
  bankAccounts: { id: string; label: string; line: string }[];
  vatPayer: boolean;
  vatStatus: VatStatus;
  readOnly: boolean;
}) {
  const t = useTranslations('settings.invoices');
  const tf = useTranslations('invoiceForm.fields');
  const router = useRouter();
  const [show, setShow] = useState(prefs.show);
  const [labels, setLabels] = useState(prefs.customFieldLabels);
  const [place, setPlace] = useState(prefs.defaultIssuePlace ?? '');
  const [issuedBy, setIssuedBy] = useState(prefs.defaultIssuedBy ?? '');
  const [grossPrices, setGrossPrices] = useState(prefs.pricesIncludeVat);
  const [accent, setAccent] = useState(prefs.pdfAccent);
  const [secondLanguage, setSecondLanguage] = useState<'' | 'cs' | 'sk' | 'en'>(prefs.pdfSecondLanguage ?? '');
  const [reminders, setReminders] = useState(prefs.remindersEnabled);
  const [reminderInterval, setReminderInterval] = useState(prefs.reminderIntervalDays);
  const [reminderMax, setReminderMax] = useState(prefs.reminderMax);
  const [rateMode, setRateMode] = useState(prefs.exchangeRateMode);
  const [annualRates, setAnnualRates] = useState<AnnualRateDraft[]>(() =>
    prefs.annualRates.map((r) => ({ year: String(r.year), currency: r.currency, rate: String(r.rate) }))
  );
  const [blank, setBlank] = useState<DefaultsDraft>(() => ({
    language: company.locale,
    dueDays: String(company.dueDays),
    paymentMethod: company.paymentMethod,
    currency: prefs.defaultCurrency ?? '',
    bankAccountId: bankAccounts.some((a) => a.id === prefs.defaultBankAccountId) ? prefs.defaultBankAccountId! : '',
    contact: defaultContact,
    items: prefs.defaultItems.map((i) => ({
      description: i.description,
      quantity: String(i.quantity),
      unit: i.unit ?? '',
      unitPrice: i.unitPrice ? String(i.unitPrice) : '',
      vatRate: vatPayer ? (i.vatRate == null ? '' : String(i.vatRate)) : ''
    })),
    noteAbove: prefs.defaultNoteAbove ?? '',
    noteBelow: company.noteBelow ?? ''
  }));
  const [saving, startSave] = useTransition();

  const save = () =>
    startSave(async () => {
      const rates = annualRatesOf(annualRates);
      if (!rates) {
        toast({ text: t('rate.duplicate'), tone: 'err' });
        return;
      }
      const result = await updateInvoiceFormPrefs({
        exchange_rate_mode: rateMode,
        annual_rates: rates,
        show,
        custom_field_labels: labels.map((l) => l.trim()).filter(Boolean),
        default_issue_place: place.trim() || null,
        default_issued_by: issuedBy.trim() || null,
        prices_include_vat: grossPrices,
        pdf_accent: accent,
        pdf_second_language: secondLanguage === '' ? null : secondLanguage,
        reminders_enabled: reminders,
        reminder_interval_days: Math.min(60, Math.max(1, Math.round(reminderInterval) || 7)),
        reminder_max: Math.min(10, Math.max(1, Math.round(reminderMax) || 3)),
        default_currency: blank.currency && blank.currency !== 'CZK' ? blank.currency : null,
        default_bank_account_id: blank.bankAccountId || null,
        default_contact_id: blank.contact?.id ?? null,
        default_items: blank.items
          .filter((i) => i.description.trim())
          .map((i) => {
            const quantity = parseNumber(i.quantity);
            const price = parseNumber(i.unitPrice);
            return {
              description: i.description.trim(),
              quantity: Number.isFinite(quantity) && i.quantity.trim() ? quantity : 1,
              unit: i.unit.trim() || null,
              unit_price: Number.isFinite(price) ? price : 0,
              vat_rate: vatPayer && i.vatRate !== '' ? Number(i.vatRate) : null
            };
          }),
        default_note_above: blank.noteAbove.trim() || null
      }, {
        default_locale: blank.language,
        default_due_days: Math.min(365, Math.max(0, Math.round(parseNumber(blank.dueDays)) || 0)),
        default_payment_method: blank.paymentMethod,
        default_note_below: blank.noteBelow.trim() || null
      });
      toast(result.ok ? { text: t('saved'), tone: 'ok' } : { text: `${t('saveFailed')}: ${result.error}`, tone: 'err' });
      if (result.ok) router.refresh();
    });

  const card = 'mt-6 rounded-xl border border-border bg-card p-5';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <section id="fields" className={cn(card, 'scroll-mt-20')}>
        <InfoHint hint={t('fieldsHint')}>
          <h2 className="font-bold">{t('fieldsTitle')}</h2>
        </InfoHint>
        <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <fieldset key={group.key} className="space-y-1">
              <legend className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t(`groups.${group.key}`)}</legend>
              {group.fields
                .filter((f) => vatPayer || f !== 'taxableSupplyDate')
                .map((f) => (
                  <InfoHint key={f} hint={t(`hints.${f}`)} className={cn('text-sm', readOnly && 'opacity-70')}>
                    <label className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={show[f]}
                        disabled={readOnly}
                        onChange={(e) => setShow((cur) => ({ ...cur, [f]: e.target.checked }))}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="font-medium">{tf(f)}</span>
                    </label>
                  </InfoHint>
                ))}
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setShow(DEFAULT_SHOWN)}
          className="mt-4 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {t('resetDefaults')}
        </button>
      </section>

      {/* bitfaktura spreads these over several settings pages; here they share one card. */}
      <section className={card}>
        <h2 className="font-bold">{t('lookTitle')}</h2>
        <div className="mt-3 space-y-4">
          {vatPayer && (
            <InfoHint hint={t('grossPricesHint')} className={cn('text-sm', readOnly && 'opacity-70')}>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={grossPrices}
                  disabled={readOnly}
                  onChange={(e) => setGrossPrices(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="font-medium">{t('grossPrices')}</span>
              </label>
            </InfoHint>
          )}
          <div>
            <InfoHint hint={t('accentHint')}>
              <span className="text-sm font-medium">{t('accent')}</span>
            </InfoHint>
            <div role="radiogroup" aria-label={t('accent')} className="mt-2 flex flex-wrap items-center gap-2">
              {PDF_ACCENTS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={accent === color}
                  aria-label={color}
                  title={color}
                  disabled={readOnly}
                  onClick={() => setAccent(color)}
                  style={{ backgroundColor: color }}
                  className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-card transition-shadow disabled:opacity-60',
                    accent === color ? 'ring-2 ring-foreground' : 'hover:ring-2 hover:ring-border'
                  )}
                >
                  {accent === color && <Check className="h-4 w-4" />}
                </button>
              ))}
              <span className="ml-2 text-lg font-extrabold" style={{ color: accent }}>
                {t('accentSample')}
              </span>
            </div>
          </div>
          <label className="block max-w-xs">
            <InfoHint hint={t('secondLanguageHint')}>
              <span className="text-sm font-medium">{t('secondLanguage')}</span>
            </InfoHint>
            <select
              className={cn(inputClass, 'mt-1.5')}
              value={secondLanguage}
              disabled={readOnly}
              onChange={(e) => setSecondLanguage(e.target.value as typeof secondLanguage)}
            >
              <option value="">{t('secondLanguageNone')}</option>
              {(['en', 'cs', 'sk'] as const).map((l) => (
                <option key={l} value={l}>
                  {t(`secondLanguages.${l}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <ExchangeRateSettings
        className={card}
        mode={rateMode}
        onModeChange={setRateMode}
        rates={annualRates}
        onRatesChange={setAnnualRates}
        vatStatus={vatStatus}
        readOnly={readOnly}
      />

      <section id="reminders" className={cn(card, 'scroll-mt-20')}>
        <InfoHint hint={t('remindersHint')}>
          <h2 className="font-bold">{t('remindersTitle')}</h2>
        </InfoHint>
        <div className="mt-3 space-y-3">
          <label className={cn('flex items-center gap-2.5 text-sm', readOnly && 'opacity-70')}>
            <input
              type="checkbox"
              checked={reminders}
              disabled={readOnly}
              onChange={(e) => setReminders(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="font-medium">{t('remindersEnabled')}</span>
          </label>
          {reminders && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
              {t.rich('remindersRule', {
                interval: () => (
                  <input
                    type="number"
                    min={1}
                    max={60}
                    aria-label={t('reminderInterval')}
                    className={cn(inputClass, 'h-9 w-16 text-center')}
                    value={reminderInterval}
                    disabled={readOnly}
                    onChange={(e) => setReminderInterval(Number(e.target.value))}
                  />
                ),
                max: () => (
                  <input
                    type="number"
                    min={1}
                    max={10}
                    aria-label={t('reminderMax')}
                    className={cn(inputClass, 'h-9 w-16 text-center')}
                    value={reminderMax}
                    disabled={readOnly}
                    onChange={(e) => setReminderMax(Number(e.target.value))}
                  />
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section id="defaults" className={cn(card, 'scroll-mt-20')}>
        <InfoHint hint={t('defaultsHint')}>
          <h2 className="font-bold">{t('defaultsTitle')}</h2>
        </InfoHint>
        <InvoiceDefaultsFields value={blank} onChange={setBlank} bankAccounts={bankAccounts} vatPayer={vatPayer} readOnly={readOnly} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">{tf('issuePlace')}</span>
            <input
              className={cn(inputClass, 'mt-1')}
              maxLength={100}
              value={place}
              disabled={readOnly}
              onChange={(e) => setPlace(e.target.value)}
              placeholder={tf('issuePlacePlaceholder')}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">{tf('issuedBy')}</span>
            <input
              className={cn(inputClass, 'mt-1')}
              maxLength={100}
              value={issuedBy}
              disabled={readOnly}
              onChange={(e) => setIssuedBy(e.target.value)}
              placeholder={tf('issuedByPlaceholder')}
            />
          </label>
        </div>

        <InfoHint hint={t('customLabelsHint')} className="mt-6">
          <h3 className="text-sm font-semibold">{t('customLabelsTitle')}</h3>
        </InfoHint>
        <div className="mt-3 space-y-2">
          {labels.map((label, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={inputClass}
                maxLength={40}
                value={label}
                disabled={readOnly}
                aria-label={tf('customLabel')}
                placeholder={t('customLabelPlaceholder')}
                onChange={(e) => setLabels((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <button
                type="button"
                disabled={readOnly}
                aria-label={t('remove')}
                onClick={() => setLabels((cur) => cur.filter((_, j) => j !== i))}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {labels.length < 4 && !readOnly && (
            <button type="button" onClick={() => setLabels((cur) => [...cur, ''])} className={buttonClass.secondary}>
              <Plus className="h-4 w-4" />
              {t('addLabel')}
            </button>
          )}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          {t('registryNoteElsewhere')}{' '}
          <Link href="/settings/company" className="font-semibold text-foreground underline underline-offset-2">
            {t('registryNoteLink')}
          </Link>
        </p>
      </section>

      {!readOnly && (
        <div className="sticky bottom-20 z-10 mt-6 flex justify-end rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur md:bottom-4">
          <button type="submit" className={buttonClass.primary} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('save')}
          </button>
        </div>
      )}
    </form>
  );
}
