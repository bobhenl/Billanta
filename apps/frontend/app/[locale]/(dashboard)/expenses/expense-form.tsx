'use client';

import { type FormEvent, useRef, useState, useTransition } from 'react';
import { Loader2, QrCode, ScanLine, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { Banner } from '@/components/banner';
import { formatMoney } from '@/lib/invoice-ui';
import { EXPENSE_CATEGORIES, isKnownCategory, vatOfGross, type Expense } from '@/lib/expense-ui';
import { QrCameraScanner } from '@/components/qr-camera-scanner';
import { scanInvoiceFile, type ScannedInvoice } from '@/lib/qr-scan';
import { createExpense, updateExpense, type ExpenseInput } from './actions';

export interface SupplierOption {
  id: string;
  legalName: string;
  ico: string | null;
}

/** `POST /api/v1/ai/receipt` response (see `AiService.readReceipt`). */
interface ReceiptResult {
  suggestion: {
    supplier: { name: string | null; ico: string | null; dic: string | null };
    document_number: string | null;
    variable_symbol: string | null;
    issue_date: string | null;
    due_date: string | null;
    total_amount: number | null;
    vat_rate: number | null;
    currency: string;
    description: string | null;
    category: string | null;
    already_paid: boolean;
  };
  contact: SupplierOption | null;
}

const AI_ERRORS = ['ai_disabled', 'ai_key_missing', 'unsupported_file_type', 'ai_refused', 'ai_unparseable'] as const;
const VAT_RATE_OPTIONS = ['21', '12', '0'];
const CURRENCY_OPTIONS = ['CZK', 'EUR', 'USD', 'GBP', 'PLN'];
const today = () => new Date().toISOString().slice(0, 10);
const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : '');

/**
 * Create/edit form for an expense (received invoice, receipt). The top
 * drop zone first looks for a QR Faktura / QR Platba on the photo or PDF
 * (in the browser, no AI); only when the code doesn't carry the whole invoice
 * is the file sent to the AI reader. Either way it only pre-fills the fields —
 * nothing is saved until the user submits.
 */
export function ExpenseForm({
  autoScan = false,
  expense,
  initial,
  suppliers
}: {
  /** Open the QR camera right away (dashboard "scan an invoice" tile). */
  autoScan?: boolean;
  /** Edit mode: the saved expense. */
  expense?: Expense;
  /** Create mode prefill (duplicate) — copied, never updated. */
  initial?: Expense;
  suppliers: SupplierOption[];
}) {
  const src = expense ?? initial;
  const t = useTranslations('expenses.form');
  const tCat = useTranslations('expenses.category');
  const locale = useLocale();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [reading, setReading] = useState(false);
  const [aiFilled, setAiFilled] = useState(false);
  const [qrFilled, setQrFilled] = useState<ScannedInvoice['format'] | null>(null);
  const [cameraOpen, setCameraOpen] = useState(autoScan);

  const [supplierContactId, setSupplierContactId] = useState(src?.supplierContactId ?? null);
  const [supplierName, setSupplierName] = useState(
    src?.supplierNameRaw ?? suppliers.find((s) => s.id === src?.supplierContactId)?.legalName ?? ''
  );
  const [supplierIco, setSupplierIco] = useState(src?.supplierIco ?? '');
  const [supplierDic, setSupplierDic] = useState(src?.supplierDic ?? '');
  const [documentNumber, setDocumentNumber] = useState(src?.documentNumber ?? '');
  const [variableSymbol, setVariableSymbol] = useState(src?.variableSymbol ?? '');
  const [description, setDescription] = useState(src?.description ?? '');
  const [amount, setAmount] = useState(src?.amount ? String(Number(src.amount)) : '');
  const [vatRate, setVatRate] = useState(src ? String(Number(src.vatRate)) : VAT_RATE_OPTIONS[0]);
  const [currency, setCurrency] = useState(src?.currency ?? 'CZK');
  const [expenseDate, setExpenseDate] = useState(day(src?.expenseDate) || today());
  const [dueDate, setDueDate] = useState(day(src?.dueDate));
  const [category, setCategory] = useState(src?.category ?? '');
  const [paid, setPaid] = useState(Boolean(src?.paidAt));
  const [paidAt, setPaidAt] = useState(day(src?.paidAt) || today());
  const [receiptFileUrl, setReceiptFileUrl] = useState(src?.receiptFileUrl ?? '');
  const [note, setNote] = useState(src?.note ?? '');

  const vatPart = vatOfGross(Number(amount) || 0, Number(vatRate) || 0);

  function pickSupplier(name: string) {
    setSupplierName(name);
    const match = suppliers.find((s) => s.legalName.toLowerCase() === name.trim().toLowerCase());
    setSupplierContactId(match?.id ?? null);
    if (match?.ico) setSupplierIco(match.ico);
  }

  /** Exact values from the code win over anything the AI read. */
  function applyScan(scan: ScannedInvoice) {
    const ico = scan.supplierIco && /^\d{8}$/.test(scan.supplierIco) ? scan.supplierIco : null;
    const known = ico ? suppliers.find((s) => s.ico === ico) : undefined;
    if (known) {
      setSupplierContactId(known.id);
      setSupplierName(known.legalName);
    }
    if (ico) setSupplierIco(ico);
    if (scan.supplierDic) setSupplierDic(scan.supplierDic);
    if (scan.invoiceNumber) setDocumentNumber(scan.invoiceNumber);
    if (scan.variableSymbol) setVariableSymbol(scan.variableSymbol.replace(/\D/g, '').slice(0, 10));
    if (scan.amount != null) setAmount(String(scan.amount));
    if (scan.vatRate != null && VAT_RATE_OPTIONS.includes(String(scan.vatRate))) setVatRate(String(scan.vatRate));
    else if (scan.taxDocument === false) setVatRate('0');
    if (scan.currency && CURRENCY_OPTIONS.includes(scan.currency.toUpperCase())) setCurrency(scan.currency.toUpperCase());
    if (scan.issueDate) setExpenseDate(scan.issueDate);
    if (scan.dueDate) setDueDate(scan.dueDate);
    setDescription((d) => d || (scan.invoiceNumber ? t('qrDescription', { number: scan.invoiceNumber }) : scan.message ?? ''));
    setQrFilled(scan.format);
  }

  async function readReceipt(file: File) {
    setReading(true);
    const scan = await scanInvoiceFile(file);
    // QR Faktura carries the whole invoice: no need to bother the AI.
    if (scan && scan.format !== 'spayd') {
      applyScan(scan);
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
      toast({ text: t('qrFound'), tone: 'ok' });
      return;
    }
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch('/api/ai/receipt', { method: 'POST', body });
      const data = (await res.json()) as ReceiptResult & { error?: string; message?: string };
      if (!res.ok) {
        const known = AI_ERRORS.includes(data.error as (typeof AI_ERRORS)[number]);
        throw new Error(known ? t(`aiErrors.${data.error as (typeof AI_ERRORS)[number]}`) : data.message ?? `HTTP ${res.status}`);
      }
      const s = data.suggestion;
      if (data.contact) {
        setSupplierContactId(data.contact.id);
        setSupplierName(data.contact.legalName);
        if (data.contact.ico) setSupplierIco(data.contact.ico);
      } else if (s.supplier.name) {
        pickSupplier(s.supplier.name);
      }
      if (s.supplier.ico && /^\d{8}$/.test(s.supplier.ico)) setSupplierIco(s.supplier.ico);
      if (s.document_number) setDocumentNumber(s.document_number);
      if (s.variable_symbol) setVariableSymbol(s.variable_symbol.replace(/\D/g, '').slice(0, 10));
      if (s.description) setDescription(s.description);
      if (s.total_amount !== null) setAmount(String(s.total_amount));
      if (s.vat_rate !== null) setVatRate(String(s.vat_rate));
      setCurrency(s.currency);
      if (s.issue_date) setExpenseDate(s.issue_date);
      if (s.due_date) setDueDate(s.due_date);
      if (s.category) setCategory(s.category);
      if (s.already_paid) {
        setPaid(true);
        setPaidAt(s.issue_date ?? today());
      }
      setAiFilled(true);
      if (scan) applyScan(scan);
    } catch (error) {
      if (scan) applyScan(scan);
      else toast({ text: `${t('aiFailed')}: ${error instanceof Error ? error.message : String(error)}`, tone: 'err' });
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: ExpenseInput = {
      supplierContactId,
      supplierNameRaw: supplierName.trim() || null,
      supplierIco: supplierIco.trim() || null,
      supplierDic: supplierDic.trim() || null,
      documentNumber: documentNumber.trim() || null,
      variableSymbol: variableSymbol.trim() || null,
      description: description.trim(),
      amount: Number(amount),
      vatRate: Number(vatRate),
      currency,
      expenseDate,
      dueDate: dueDate || null,
      paidAt: paid ? paidAt : null,
      category: category || null,
      receiptFileUrl: receiptFileUrl.trim() || null,
      note: note.trim() || null
    };
    startTransition(async () => {
      const result = expense ? await updateExpense(expense.id, input) : await createExpense(input);
      if (!result.ok) {
        toast({ text: `${t('saveFailed')}: ${result.error}`, tone: 'err' });
        return;
      }
      toast({ text: t('saved'), tone: 'ok' });
      router.push(`/expenses/${result.data.id}`);
      router.refresh();
    });
  }

  const label = 'mb-1 block text-xs font-semibold text-muted-foreground';

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight">{expense ? t('editTitle') : t('title')}</h1>
      <p className="mt-1 text-muted-foreground">{t('description')}</p>

      <button
        type="button"
        disabled={reading}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) void readReceipt(file);
        }}
        className="mt-5 flex w-full items-center gap-4 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-left transition-colors hover:border-primary hover:bg-primary/10 disabled:opacity-60"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          {reading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScanLine className="h-5 w-5" />}
        </span>
        <span>
          <span className="block font-bold">{reading ? t('aiReading') : t('aiTitle')}</span>
          <span className="block text-sm text-muted-foreground">{t('aiHint')}</span>
        </span>
        <Upload className="ml-auto h-5 w-5 text-primary" />
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <button type="button" className={buttonClass.secondary} onClick={() => setCameraOpen(true)} disabled={reading}>
          <QrCode className="h-4 w-4" />
          {t('qrCamera')}
        </button>
        <span>{t('qrHint')}</span>
      </div>
      <QrCameraScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onResult={(scan) => {
          setCameraOpen(false);
          applyScan(scan);
          toast({ text: t('qrFound'), tone: 'ok' });
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void readReceipt(file);
        }}
      />
      {qrFilled && !aiFilled && (
        <Banner tone="info" className="mt-3">
          {qrFilled === 'spayd' ? t('qrCheckPayment') : t('qrCheck')}
        </Banner>
      )}
      {aiFilled && (
        <Banner tone="warn" className="mt-3">
          {t('aiCheck')}
        </Banner>
      )}

      <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">{t('supplierSection')}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className={label}>{t('supplierNameLabel')}</span>
              <input
                list="expense-suppliers"
                required
                className={inputClass}
                placeholder={t('supplierNamePlaceholder')}
                value={supplierName}
                onChange={(e) => pickSupplier(e.target.value)}
              />
              <datalist id="expense-suppliers">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.legalName}>
                    {s.ico ?? ''}
                  </option>
                ))}
              </datalist>
              {supplierContactId && <span className="mt-1 block text-xs text-success">{t('supplierLinked')}</span>}
            </label>
            <label className="block">
              <span className={label}>IČO</span>
              <input
                className={inputClass}
                inputMode="numeric"
                pattern="\d{8}"
                maxLength={8}
                value={supplierIco}
                onChange={(e) => setSupplierIco(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="block">
              <span className={label}>DIČ</span>
              <input
                className={inputClass}
                placeholder="CZ12345678"
                pattern="[A-Za-z]{2}[0-9A-Za-z]{2,12}"
                maxLength={14}
                value={supplierDic}
                onChange={(e) => setSupplierDic(e.target.value.replace(/\s/g, '').toUpperCase())}
              />
              <span className="mt-1 block text-xs text-muted-foreground">{t('supplierDicHint')}</span>
            </label>
            <label className="block">
              <span className={label}>{t('documentNumberLabel')}</span>
              <input className={inputClass} maxLength={64} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
            </label>
            <label className="block">
              <span className={label}>{t('variableSymbolLabel')}</span>
              <input
                className={inputClass}
                inputMode="numeric"
                maxLength={10}
                value={variableSymbol}
                onChange={(e) => setVariableSymbol(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label className="block">
              <span className={label}>{t('categoryLabel')}</span>
              <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t('noCategory')}</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {tCat(c)}
                  </option>
                ))}
                {category && !isKnownCategory(category) && <option value={category}>{category}</option>}
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">{t('amountSection')}</h2>
          <label className="block">
            <span className={label}>{t('descriptionLabel')}</span>
            <input
              required
              className={inputClass}
              placeholder={t('descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={label}>{t('amountLabel')}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                className={inputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={label}>{t('vatRateLabel')}</span>
              <select className={inputClass} value={vatRate} onChange={(e) => setVatRate(e.target.value)}>
                {[...new Set([...VAT_RATE_OPTIONS, vatRate])].map((option) => (
                  <option key={option} value={option}>
                    {option} %
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>{t('currencyLabel')}</span>
              <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {[...new Set([...CURRENCY_OPTIONS, currency])].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {Number(amount) > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('vatBreakdown', {
                base: formatMoney(Number(amount) - vatPart, currency, locale),
                vat: formatMoney(vatPart, currency, locale)
              })}
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">{t('datesSection')}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={label}>{t('expenseDateLabel')}</span>
              <input type="date" required className={inputClass} value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            </label>
            <label className="block">
              <span className={label}>{t('dueDateLabel')}</span>
              <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <div>
              <label className="flex items-center gap-2 pt-5 text-sm font-semibold">
                <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4 accent-primary" />
                {t('paidLabel')}
              </label>
              {paid && (
                <input type="date" className={`${inputClass} mt-2`} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold">{t('otherSection')}</h2>
          <label className="block">
            <span className={label}>{t('noteLabel')}</span>
            <textarea rows={3} maxLength={2000} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="mt-3 block">
            <span className={label}>{t('receiptFileUrlLabel')}</span>
            <input
              className={inputClass}
              placeholder={t('receiptFileUrlPlaceholder')}
              value={receiptFileUrl}
              onChange={(e) => setReceiptFileUrl(e.target.value)}
            />
            <span className="mt-1 block text-xs text-muted-foreground">{t('receiptFileUrlHint')}</span>
          </label>
        </section>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending || reading} className={buttonClass.primary}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {expense ? t('saveChanges') : t('submit')}
          </button>
          <button
            type="button"
            onClick={() => router.push(expense ? `/expenses/${expense.id}` : '/expenses')}
            className={buttonClass.secondary}
          >
            {t('cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
