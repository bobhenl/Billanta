'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, FileUp, HelpCircle, RotateCcw, Sparkles, XCircle } from 'lucide-react';
import {
  checkIsdoc,
  generateIsdocXml,
  inferIsdocScenario,
  IsdocParseError,
  readIsdocFile,
  type ChecklistScenario,
  type IsdocItemStatus,
  type ParsedIsdoc,
  type ParsedIsdocParty
} from '@faktur/cz-compliance';
import { ChecklistGroups, ChecklistNotices, ScenarioPicker } from '@/components/public-tools/invoice-checklist-view';
import { money } from '@/components/public-tools/fields';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/** Bigger files are not invoices; it also keeps a stray video from freezing the tab. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * A sample invoice with one deliberate mistake (the customer's DIČ has a
 * wrong check digit), so the visitor sees the checker at work without
 * having an ISDOC file at hand. Built in the browser like an upload.
 */
function sampleXml(): string {
  return generateIsdocXml({
    invoiceNumber: '20260142',
    variableSymbol: '20260142',
    issueDate: '2026-10-01',
    dueDate: '2026-10-15',
    taxableSupplyDate: '2026-09-30',
    currency: 'CZK',
    supplier: {
      legalName: 'Grafika Novák s.r.o.',
      ico: '27082440',
      dic: 'CZ27082440',
      isVatPayer: true,
      address: { street: 'Vinohradská', houseNumber: '1234/56', city: 'Praha', postalCode: '120 00', countryCode: 'CZ' },
      email: 'faktury@example.cz'
    },
    customer: {
      legalName: 'Pekárna U Mlýna a.s.',
      ico: '00006947',
      dic: 'CZ00006948',
      address: { street: 'Letenská', houseNumber: '15', city: 'Praha', postalCode: '118 10', countryCode: 'CZ' }
    },
    lineItems: [
      { description: 'Návrh loga', quantity: 1, unit: 'ks', unitPriceWithoutVat: 12000, vatRate: 'base', vatRatePercent: 21 },
      { description: 'Úprava fotografií', quantity: 6, unit: 'hod', unitPriceWithoutVat: 650, vatRate: 'base', vatRatePercent: 21 }
    ],
    totals: {
      totalWithoutVat: 15900,
      totalVat: 3339,
      totalWithVat: 19239,
      vatRecapitulation: [{ vatRate: 'base', vatRatePercent: 21, totalWithoutVat: 15900, vatAmount: 3339, totalWithVat: 19239 }]
    },
    bankAccount: { accountNumber: '19-2000145399/0800', iban: 'CZ6508000000192000145399', bic: 'GIBACZPX', bankName: 'Česká spořitelna' },
    note: 'Zapsáno v obchodním rejstříku u Městského soudu v Praze, oddíl C, vložka 123456'
  });
}

type ErrorCode = 'not_xml' | 'not_isdoc' | 'too_big' | 'read';

export function IsdocViewer() {
  const t = useTranslations('tools.calculators.items.isdocViewer');
  const [doc, setDoc] = useState<ParsedIsdoc | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ChecklistScenario | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = async (bytes: Uint8Array, name: string) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = await readIsdocFile(bytes);
      setDoc(parsed);
      setScenario(inferIsdocScenario(parsed));
      setFileName(name);
    } catch (e) {
      setError(e instanceof IsdocParseError ? e.code : 'read');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('too_big');
      return;
    }
    await load(new Uint8Array(await file.arrayBuffer()), file.name);
  };

  const reset = () => {
    setDoc(null);
    setScenario(null);
    setFileName(null);
    setError(null);
    if (input.current) input.current.value = '';
  };

  if (doc && scenario) return <IsdocReport doc={doc} fileName={fileName} scenario={scenario} onScenario={setScenario} onReset={reset} />;

  return (
    <div className="space-y-4">
      <label
        className={cn(
          'flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-card px-5 py-10 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60'
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFile(e.dataTransfer.files[0]);
        }}
      >
        <FileUp className="h-8 w-8 text-primary" aria-hidden="true" />
        <span className="text-base font-semibold">{busy ? t('reading') : t('dropTitle')}</span>
        <span className="max-w-md text-sm text-muted-foreground">{t('dropHint')}</span>
        <span className={buttonClass.primary}>{t('choose')}</span>
        <input ref={input} type="file" accept=".isdoc,.isdocx,.xml,application/xml,text/xml" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>

      {error && (
        <p role="alert" className="flex gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t(`errors.${error}`)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => void load(new TextEncoder().encode(sampleXml()), t('sampleName'))}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('sample')}
        </button>
        <span className="text-muted-foreground">{t('privacy')}</span>
      </div>
    </div>
  );
}

const STATUS_ICON: Record<IsdocItemStatus, { icon: typeof CheckCircle2; className: string }> = {
  ok: { icon: CheckCircle2, className: 'text-primary' },
  missing: { icon: XCircle, className: 'text-red-600 dark:text-red-400' },
  invalid: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400' },
  unknown: { icon: HelpCircle, className: 'text-muted-foreground' }
};

function IsdocReport({
  doc,
  fileName,
  scenario,
  onScenario,
  onReset
}: {
  doc: ParsedIsdoc;
  fileName: string | null;
  scenario: ChecklistScenario;
  onScenario: (s: ChecklistScenario) => void;
  onReset: () => void;
}) {
  const t = useTranslations('tools.calculators.items.isdocViewer');
  const locale = useLocale();
  const check = useMemo(() => checkIsdoc(doc, scenario), [doc, scenario]);
  const statusOf = new Map(check.items.map((i) => [i.id, i.status]));
  const counts = { missing: 0, invalid: 0 } as Record<'missing' | 'invalid', number>;
  for (const i of check.items) if (i.status === 'missing' || i.status === 'invalid') counts[i.status]++;
  const errors = check.findings.filter((f) => f.severity === 'error').length;
  const clean = counts.missing === 0 && counts.invalid === 0 && check.findings.length === 0;

  const currency = doc.localCurrency ?? 'CZK';
  const amount = (n: number | undefined) => (n == null ? '–' : money(locale, n, currency, 2));
  const date = (d: string | undefined) => {
    if (!d) return '–';
    const parsed = new Date(`${d}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString(locale, { timeZone: 'UTC' });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-muted-foreground">{fileName}</p>
        <button type="button" className={buttonClass.secondary} onClick={onReset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t('another')}
        </button>
      </div>

      {/* Verdict first: that's what the visitor came for. */}
      <section aria-live="polite" className={cn('rounded-xl border p-5', clean ? 'border-primary/40 bg-primary/5' : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30')}>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {clean ? <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" /> : <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
          {clean ? t('verdictOk') : t('verdictIssues', { missing: counts.missing, problems: check.findings.length })}
        </h2>
        {check.findings.length > 0 && (
          <ul className="mt-3 space-y-2 text-sm">
            {check.findings.map((f, i) => (
              <li key={`${f.code}-${i}`} className="flex gap-2">
                {f.severity === 'error' ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                )}
                <span>
                  {t(`findings.${f.code}`, {
                    value: f.value ?? '',
                    expected: f.expected == null ? '' : amount(f.expected),
                    actual: f.actual == null ? '' : amount(f.actual)
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {errors === 0 && !clean && <p className="mt-2 text-sm text-muted-foreground">{t('verdictHint')}</p>}
      </section>

      <InvoiceView doc={doc} amount={amount} date={date} />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="h-fit space-y-4 rounded-xl border border-border bg-card p-5 lg:sticky lg:top-24">
          <h2 className="text-base font-semibold">{t('scenarioTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('scenarioHint')}</p>
          <ScenarioPicker value={{ ...scenario, ...check.checklist.scenario }} onChange={onScenario} />
        </div>
        <div className="min-w-0 space-y-6">
          <ChecklistNotices checklist={check.checklist} />
          <ChecklistGroups
            items={check.items}
            leading={(item) => {
              const status = statusOf.get(item.id) ?? 'unknown';
              const { icon: Icon, className } = STATUS_ICON[status];
              return <Icon className={cn('h-5 w-5', className)} aria-label={t(`status.${status}`)} />;
            }}
            rowClass={(item) => {
              const status = statusOf.get(item.id);
              return status === 'missing' ? 'bg-red-50/60 dark:bg-red-950/20' : status === 'invalid' ? 'bg-amber-50/60 dark:bg-amber-950/20' : undefined;
            }}
          />
        </div>
      </section>
    </div>
  );
}

/** The invoice as a person would read it. Stacked rows instead of a table, so it fits 375px. */
function InvoiceView({ doc, amount, date }: { doc: ParsedIsdoc; amount: (n: number | undefined) => string; date: (d: string | undefined) => string }) {
  const t = useTranslations('tools.calculators.items.isdocViewer');
  const payable = doc.totals.payable ?? doc.totals.taxInclusive;
  return (
    <article className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border p-5">
        <h2 className="text-lg font-bold">
          {t(`kinds.${doc.kind ?? 'unknown'}`)} {doc.number && <span className="tabular-nums">{doc.number}</span>}
        </h2>
        {doc.version && <span className="text-xs text-muted-foreground">ISDOC {doc.version}</span>}
      </header>

      <div className="grid gap-4 border-b border-border p-5 sm:grid-cols-2">
        <Party title={t('supplier')} party={doc.supplier} />
        {doc.customer ? <Party title={t('customer')} party={doc.customer} /> : <p className="text-sm text-muted-foreground">{t('noCustomer')}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border p-5 text-sm sm:grid-cols-4">
        <Fact label={t('issueDate')} value={date(doc.issueDate)} />
        <Fact label={t('taxPointDate')} value={date(doc.taxPointDate)} />
        <Fact label={t('dueDate')} value={date(doc.dueDate)} />
        <Fact label={t('currency')} value={doc.foreignCurrency ? `${doc.foreignCurrency} → ${doc.localCurrency ?? ''}${doc.currRate ? ` (${doc.currRate})` : ''}` : (doc.localCurrency ?? '–')} />
        {doc.originalDocuments.length > 0 && <Fact label={t('corrects')} value={doc.originalDocuments.join(', ')} />}
        {doc.orderNumbers.length > 0 && <Fact label={t('order')} value={doc.orderNumbers.join(', ')} />}
      </dl>

      <div className="border-b border-border p-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('lines')}</h3>
        {doc.lines.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('noLines')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {doc.lines.map((l, i) => (
              <li key={l.id ?? i} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{l.description || t('lineNoText')}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.quantity ?? '–'} {l.unit ?? ''} × {amount(l.unitPrice)}
                    {l.vatPercent != null && ` · ${t('vatRate', { rate: l.vatPercent })}`}
                    {l.reverseCharge && ` · ${t('reverseCharge')}`}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">{amount(l.net)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {doc.taxSubTotals.length > 0 && (
        <div className="border-b border-border p-5">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('vatRecap')}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {doc.taxSubTotals.map((s, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-4">
                <span>{t('vatRate', { rate: s.percent ?? 0 })}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t('recapRow', { base: amount(s.taxable), vat: amount(s.tax) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="space-y-1 border-b border-border p-5 text-sm">
        <Total label={t('taxExclusive')} value={amount(doc.totals.taxExclusive)} />
        {doc.taxTotal != null && <Total label={t('vatTotal')} value={amount(doc.taxTotal)} />}
        {!!doc.totals.rounding && <Total label={t('rounding')} value={amount(doc.totals.rounding)} />}
        {!!doc.totals.alreadyClaimed && <Total label={t('alreadyClaimed')} value={amount(-doc.totals.alreadyClaimed)} />}
        {!!doc.totals.paidDeposits && <Total label={t('paidDeposits')} value={amount(-doc.totals.paidDeposits)} />}
        <Total label={t('payable')} value={amount(payable)} strong />
      </dl>

      <div className="p-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('payment')}</h3>
        {doc.payments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('noPayment')}</p>
        ) : (
          doc.payments.map((p, i) => (
            <dl key={i} className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              {p.accountId && <Fact label={t('account')} value={p.bankCode ? `${p.accountId}/${p.bankCode}` : p.accountId} />}
              {p.iban && <Fact label="IBAN" value={p.iban} />}
              {p.bic && <Fact label="BIC" value={p.bic} />}
              {p.variableSymbol && <Fact label={t('variableSymbol')} value={p.variableSymbol} />}
              {p.constantSymbol && <Fact label={t('constantSymbol')} value={p.constantSymbol} />}
              {p.specificSymbol && <Fact label={t('specificSymbol')} value={p.specificSymbol} />}
              {p.code && <Fact label={t('method')} value={t.has(`methods.${p.code}`) ? t(`methods.${p.code}`) : p.code} />}
            </dl>
          ))
        )}
        {doc.notes.length > 0 && (
          <div className="mt-4 space-y-1 text-xs text-muted-foreground">
            {doc.notes.map((n, i) => (
              <p key={i} className="whitespace-pre-line break-words">
                {n}
              </p>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function Party({ title, party }: { title: string; party: ParsedIsdocParty }) {
  const t = useTranslations('tools.calculators.items.isdocViewer');
  const street = [party.street, party.buildingNumber].filter(Boolean).join(' ');
  const city = [party.postalCode, party.city].filter(Boolean).join(' ');
  return (
    <div className="min-w-0 text-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <p className="mt-1 break-words font-semibold">{party.name || '–'}</p>
      {street && <p className="break-words">{street}</p>}
      {(city || party.countryCode) && <p>{[city, party.countryName ?? party.countryCode].filter(Boolean).join(', ')}</p>}
      <p className="mt-1 text-muted-foreground">
        {party.ico && `${t('ico')} ${party.ico}`}
        {party.ico && party.dic && ' · '}
        {party.dic && `${t('dic')} ${party.dic}`}
      </p>
      {party.otherTaxIds.filter((id) => id !== party.dic).length > 0 && <p className="text-muted-foreground">{party.otherTaxIds.filter((id) => id !== party.dic).join(', ')}</p>}
      {party.registry && <p className="mt-1 break-words text-xs text-muted-foreground">{party.registry}</p>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4', strong && 'pt-1 text-base font-bold')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
