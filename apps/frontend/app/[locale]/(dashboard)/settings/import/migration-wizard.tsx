'use client';

import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CloudDownload, Download, FileSpreadsheet, Loader2, Upload, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const SOURCES = ['fakturoid', 'idoklad', 'bitfaktura', 'faktorio', 'invoiceNinja', 'excel'] as const;
type Source = (typeof SOURCES)[number];

type InvoiceSkip = { line: number; number: string; reason: string };
type InvoiceImportResult = {
  dryRun: boolean;
  invoices: number;
  contactsCreated: number;
  contactsMatched: number;
  byStatus: { issued: number; paid: number; cancelled: number };
  totals: Record<string, number>;
  dateFrom: string | null;
  dateTo: string | null;
  skipped: InvoiceSkip[];
  preview: { number: string; customer: string; issueDate: string; total: number; currency: string; status: string }[];
  originalPdfs?: { archived: number; missing: number };
};
type ContactSkip = { line: number; reason: string; name: string };

/** A header our mapper reads — handed out as a template for hand-made files. */
const TEMPLATE =
  'Číslo faktury;Odběratel;IČO;DIČ;E-mail;Datum vystavení;Datum splatnosti;DUZP;Celkem bez DPH;Celkem s DPH;Měna;Stav;Datum úhrady\n' +
  '2025-0001;Příklad s.r.o.;12345678;CZ12345678;fakturace@priklad.cz;2.1.2025;16.1.2025;2.1.2025;1000,00;1210,00;CZK;Zaplaceno;10.1.2025\n';

const card = 'rounded-xl border border-border bg-card p-5';
const button =
  'inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:bg-secondary disabled:opacity-60';
const primary =
  'inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60';

/**
 * "Stěhování" in three steps: how to export from the old system, contacts,
 * then invoice history (preview first, import on confirmation).
 */
export function MigrationWizard({ readOnly }: { readOnly: boolean }) {
  const t = useTranslations('settings.import');
  const [source, setSource] = useState<Source>('fakturoid');
  const steps = t.raw(`sources.${source}.steps`) as string[];

  const downloadTemplate = () => {
    const blob = new Blob(['﻿', TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'faktury-sablona.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-5 space-y-5">
      <section className={card}>
        <StepTitle n={1} title={t('step1.title')} hint={t('step1.hint')} />
        <div className="mt-3 flex flex-wrap gap-2" role="tablist">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === source}
              onClick={() => setSource(s)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-semibold',
                s === source ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary'
              )}
            >
              {t(`sources.${s}.name`)}
            </button>
          ))}
        </div>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {source === 'excel' && (
          <button type="button" className={cn(button, 'mt-4')} onClick={downloadTemplate}>
            <Download className="h-4 w-4" />
            {t('template')}
          </button>
        )}
      </section>

      <ContactsStep readOnly={readOnly} />
      <InvoicesStep readOnly={readOnly} source={source} />
    </div>
  );
}

function StepTitle({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <InfoHint hint={hint} rowClassName="flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{n}</span>
      <h2 className="font-bold">{title}</h2>
    </InfoHint>
  );
}

function FilePicker({ disabled, busy, label, onFile }: { disabled: boolean; busy: boolean; label: string; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      <button type="button" className={button} disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {label}
      </button>
    </>
  );
}

function ContactsStep({ readOnly }: { readOnly: boolean }) {
  const t = useTranslations('settings.import');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; updated: number; skipped: ContactSkip[] } | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch('/api/contacts/import', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ text: errorText(t, data.error), tone: 'err' });
        return;
      }
      setDone({ created: data.created ?? 0, updated: data.updated ?? 0, skipped: data.skipped ?? [] });
    } catch {
      toast({ text: t('errors.failed'), tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card}>
      <StepTitle n={2} title={t('step2.title')} hint={t('step2.hint')} />
      <p className="mt-2 text-sm text-muted-foreground">{t('step2.lead')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <FilePicker disabled={readOnly} busy={busy} label={t('step2.upload')} onFile={upload} />
        {done && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            <Users className="h-4 w-4" />
            {t('step2.done', { created: done.created, updated: done.updated })}
          </span>
        )}
      </div>
      {done && done.skipped.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">{t('step2.skipped', { count: done.skipped.length })}</p>
      )}
    </section>
  );
}

/** What the preview was made from, so the confirmation imports the same thing. */
type ImportRequest = { kind: 'file'; file: File } | { kind: 'bitfaktura'; account: string; apiToken: string };

function InvoicesStep({ readOnly, source }: { readOnly: boolean; source: Source }) {
  const t = useTranslations('settings.import');
  const locale = useLocale();
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [account, setAccount] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [preview, setPreview] = useState<InvoiceImportResult | null>(null);
  const [result, setResult] = useState<InvoiceImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);

  const send = async (req: ImportRequest, dryRun: boolean) => {
    let res: Response;
    if (req.kind === 'file') {
      const body = new FormData();
      body.set('file', req.file);
      res = await fetch(`/api/invoices/import${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', body });
    } else {
      res = await fetch('/api/invoices/import/bitfaktura', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account: req.account, apiToken: req.apiToken, dryRun })
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorText(t, data.error));
    return data as InvoiceImportResult;
  };

  const check = async (req: ImportRequest) => {
    setBusy('preview');
    setResult(null);
    setPreview(null);
    setRequest(req);
    try {
      setPreview(await send(req, true));
    } catch (e) {
      toast({ text: (e as Error).message, tone: 'err' });
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!request) return;
    setBusy('import');
    try {
      setResult(await send(request, false));
      setPreview(null);
      // The token was needed for this import only; do not keep it around.
      setApiToken('');
      setRequest(null);
    } catch (e) {
      toast({ text: (e as Error).message, tone: 'err' });
    } finally {
      setBusy(null);
    }
  };

  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${iso}T00:00:00`));

  return (
    <section className={card}>
      <StepTitle n={3} title={t('step3.title')} hint={t('step3.hint')} />
      <p className="mt-2 text-sm text-muted-foreground">{t('step3.lead')}</p>
      {source === 'bitfaktura' && (
        <form
          className="mt-3 grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (account.trim() && apiToken.trim()) void check({ kind: 'bitfaktura', account: account.trim(), apiToken: apiToken.trim() });
          }}
        >
          <p className="text-sm text-muted-foreground sm:col-span-3">{t('step3.api.lead')}</p>
          <label className="grid gap-1 text-sm font-semibold">
            {t('step3.api.account')}
            <input
              className="h-10 rounded-lg border border-border bg-background px-3 font-normal"
              placeholder={t('step3.api.accountPlaceholder')}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            {t('step3.api.token')}
            <input
              className="h-10 rounded-lg border border-border bg-background px-3 font-normal"
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </label>
          <button type="submit" className={button} disabled={readOnly || busy !== null || !account.trim() || !apiToken.trim()}>
            {busy === 'preview' && request?.kind === 'bitfaktura' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
            {t('step3.api.load')}
          </button>
          <p className="text-xs text-muted-foreground sm:col-span-3">{t('step3.api.privacy')}</p>
        </form>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <FilePicker
          disabled={readOnly || busy === 'import'}
          busy={busy === 'preview' && request?.kind === 'file'}
          label={t('step3.upload')}
          onFile={(file) => void check({ kind: 'file', file })}
        />
        {request?.kind === 'file' && (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <FileSpreadsheet className="h-4 w-4" />
            {request.file.name}
          </span>
        )}
      </div>

      {preview && (
        <div className="mt-4 space-y-3">
          {preview.invoices === 0 ? (
            <Banner tone="warn" title={t('step3.nothing')} />
          ) : (
            <div className="rounded-lg bg-secondary/60 p-4 text-sm">
              <p className="font-bold">{t('step3.summary', { count: preview.invoices })}</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {preview.dateFrom && preview.dateTo && <li>{t('step3.range', { from: date(preview.dateFrom), to: date(preview.dateTo) })}</li>}
                <li>{t('step3.statuses', preview.byStatus)}</li>
                <li>{t('step3.totals', { totals: Object.entries(preview.totals).map(([c, v]) => money(v, c)).join(' · ') || '–' })}</li>
                <li>{t('step3.contacts', { created: preview.contactsCreated, matched: preview.contactsMatched })}</li>
              </ul>
            </div>
          )}
          {preview.preview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">{t('step3.columns.number')}</th>
                    <th className="py-1 pr-3 font-semibold">{t('step3.columns.customer')}</th>
                    <th className="py-1 pr-3 font-semibold">{t('step3.columns.date')}</th>
                    <th className="py-1 pr-3 text-right font-semibold">{t('step3.columns.total')}</th>
                    <th className="py-1 font-semibold">{t('step3.columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row) => (
                    <tr key={row.number} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-mono text-xs">{row.number}</td>
                      <td className="py-1.5 pr-3">{row.customer}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{date(row.issueDate)}</td>
                      <td className="py-1.5 pr-3 text-right whitespace-nowrap">{money(row.total, row.currency)}</td>
                      <td className="py-1.5">{t(`status.${row.status}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.invoices > preview.preview.length && (
                <p className="mt-1 text-xs text-muted-foreground">{t('step3.more', { count: preview.invoices - preview.preview.length })}</p>
              )}
            </div>
          )}
          <Skipped rows={preview.skipped} />
          {preview.invoices > 0 && (
            <button type="button" className={primary} disabled={readOnly || busy !== null} onClick={confirm}>
              {busy === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {t('step3.confirm', { count: preview.invoices })}
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <Banner tone="ok" title={t('step3.done', { count: result.invoices, contacts: result.contactsCreated })}>
            {result.originalPdfs && (
              <p className="text-sm">
                {t('step3.pdfs', { archived: result.originalPdfs.archived })}
                {result.originalPdfs.missing > 0 && ` ${t('step3.pdfsMissing', { missing: result.originalPdfs.missing })}`}
              </p>
            )}
            <Link href="/invoices" className="mt-1 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <CheckCircle2 className="h-4 w-4" />
              {t('step3.open')}
            </Link>
          </Banner>
          <Skipped rows={result.skipped} />
        </div>
      )}
    </section>
  );
}

function Skipped({ rows }: { rows: InvoiceSkip[] }) {
  const t = useTranslations('settings.import');
  if (rows.length === 0) return null;
  return (
    <details className="rounded-lg border border-border p-3 text-sm">
      <summary className="cursor-pointer font-semibold">{t('skipped.title', { count: rows.length })}</summary>
      <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
        {rows.slice(0, 200).map((row) => (
          <li key={`${row.line}-${row.reason}`}>
            {t('skipped.row', { line: row.line, number: row.number || '–' })} {t(`skipped.reasons.${row.reason}`)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function errorText(t: ReturnType<typeof useTranslations>, error: unknown): string {
  const known = [
    'unknown_columns',
    'too_many_rows',
    'no_file',
    'forbidden',
    'bitfaktura_account',
    'bitfaktura_unauthorized',
    'bitfaktura_unreachable'
  ];
  return t(`errors.${typeof error === 'string' && known.includes(error) ? error : 'failed'}`);
}
