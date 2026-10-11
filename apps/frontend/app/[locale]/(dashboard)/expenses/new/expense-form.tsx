'use client';

import { type FormEvent, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/**
 * Create-expense form — same field set as the backend's `CreateExpenseDto`
 * (`apps/backend/src/expenses/dto/create-expense.dto.ts`): supplier name,
 * description, amount, VAT rate, currency, expense date, category, and an
 * optional receipt link.
 *
 * No real network wiring yet, same placeholder pattern as
 * `(auth)/signup/signup-form.tsx`: there is no authenticated API client on
 * the frontend yet (no Auth.js session/JWT to attach). `handleSubmit` below
 * is structured to show the exact payload shape a real
 * `POST /api/v1/expenses` call would send once that exists.
 *
 * `supplierContactId` (an optional FK to an existing `contacts` row) is
 * deliberately NOT a field here — there's no contact picker/search UI yet.
 * Only the free-text `supplierNameRaw` fallback is collected; wiring a real
 * contact-select once `GET /api/v1/contacts` is consumed on the frontend is
 * follow-up work, not done here.
 */
const VAT_RATE_OPTIONS = [21, 12, 0];
const CURRENCY_OPTIONS = ['CZK', 'EUR'];

export function ExpenseForm() {
  const t = useTranslations('expenses.form');
  const router = useRouter();

  const [supplierNameRaw, setSupplierNameRaw] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [vatRate, setVatRate] = useState(String(VAT_RATE_OPTIONS[0]));
  const [currency, setCurrency] = useState(CURRENCY_OPTIONS[0]);
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState('');
  const [receiptFileUrl, setReceiptFileUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // TODO(frontend API client): POST this to `/api/v1/expenses` once an
    // authenticated fetch wrapper exists on the frontend. Left as a
    // console.log placeholder — no real network call happens today.
    const payload = {
      supplierNameRaw: supplierNameRaw || null,
      description,
      amount: Number(amount),
      vatRate: Number(vatRate),
      currency,
      expenseDate,
      category: category || null,
      receiptFileUrl: receiptFileUrl || null
    };

    setSubmitting(true);
    console.log('[expenses] would POST /api/v1/expenses with', payload);
    window.setTimeout(() => {
      setSubmitting(false);
      router.push('/expenses');
    }, 400);
  }

  return (
    <div className="max-w-xl rounded-lg border border-border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="supplierNameRaw" className="text-sm font-medium">
            {t('supplierNameLabel')}
          </label>
          <input
            id="supplierNameRaw"
            name="supplierNameRaw"
            type="text"
            required
            placeholder={t('supplierNamePlaceholder')}
            value={supplierNameRaw}
            onChange={(event) => setSupplierNameRaw(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="description" className="text-sm font-medium">
            {t('descriptionLabel')}
          </label>
          <input
            id="description"
            name="description"
            type="text"
            required
            placeholder={t('descriptionPlaceholder')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="amount" className="text-sm font-medium">
              {t('amountLabel')}
            </label>
            <input
              id="amount"
              name="amount"
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="currency" className="text-sm font-medium">
              {t('currencyLabel')}
            </label>
            <select
              id="currency"
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            >
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="vatRate" className="text-sm font-medium">
              {t('vatRateLabel')}
            </label>
            <select
              id="vatRate"
              name="vatRate"
              value={vatRate}
              onChange={(event) => setVatRate(event.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            >
              {VAT_RATE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} %
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="expenseDate" className="text-sm font-medium">
              {t('expenseDateLabel')}
            </label>
            <input
              id="expenseDate"
              name="expenseDate"
              type="date"
              required
              value={expenseDate}
              onChange={(event) => setExpenseDate(event.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="category" className="text-sm font-medium">
            {t('categoryLabel')}
          </label>
          <input
            id="category"
            name="category"
            type="text"
            placeholder={t('categoryPlaceholder')}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="receiptFileUrl" className="text-sm font-medium">
            {t('receiptFileUrlLabel')}
          </label>
          <input
            id="receiptFileUrl"
            name="receiptFileUrl"
            type="text"
            placeholder={t('receiptFileUrlPlaceholder')}
            value={receiptFileUrl}
            onChange={(event) => setReceiptFileUrl(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
          {/* TODO: replace this free-text link with a real upload widget once
              object storage (Backblaze B2 / Hetzner Object Storage, per
              blueprint §2) is wired up. */}
          <p className="text-xs text-muted-foreground">{t('receiptFileUrlHint')}</p>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('submit')}
          </button>
          <button
            type="button"
            onClick={() => router.push('/expenses')}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            {t('cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
