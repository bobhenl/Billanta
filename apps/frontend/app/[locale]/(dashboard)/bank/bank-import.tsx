'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, UploadCloud } from 'lucide-react';
import { InfoHint } from '@/components/info-hint';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from '@/components/toaster';

/** What the backend parses: CSV, camt.053 XML and GPC/ABO. */
const STATEMENT_EXTENSIONS = ['.csv', '.xml', '.gpc', '.abo'];
const STATEMENT_ERRORS = ['bank_statement_unknown_format', 'bank_statement_invalid', 'bank_statement_nothing_matches_filter'];

/** Lets the bank connections box open the same file picker. */
export const STATEMENT_INPUT_ID = 'bank-statement-file';

/** "Nahrát výpis" – posts the statement through `/api/bank/import`, then refreshes the list. */
export function BankImport() {
  const t = useTranslations('bank.import');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Optional words: from a personal account's statement only, say, the ad spend gets stored.
  const [filterOpen, setFilterOpen] = useState(false);
  const [keywords, setKeywords] = useState('');

  async function upload(file: File) {
    const name = file.name.toLowerCase();
    if (!STATEMENT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      toast({ text: t('invalidFile'), tone: 'err' });
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      if (filterOpen && keywords.trim()) body.set('keywords', keywords);
      const res = await fetch('/api/bank/import', { method: 'POST', body });
      const json = (await res.json().catch(() => ({}))) as {
        summary?: { total: number; matched: number; duplicates?: number };
        filteredOut?: number;
        message?: unknown;
        errors?: unknown;
      };
      if (!res.ok || !json.summary) {
        const code = typeof json.message === 'string' && STATEMENT_ERRORS.includes(json.message) ? json.message : null;
        // Row-level problems (CSV and camt/GPC alike) come in `errors`; a plain code alone gets its own text.
        const details = Array.isArray(json.errors) ? json.errors.slice(0, 5).join(', ') : null;
        const message = code
          ? [t(`errors.${code}`), details].filter(Boolean).join(' ')
          : Array.isArray(json.message)
            ? json.message.join(', ')
            : String(json.message ?? `HTTP ${res.status}`);
        toast({ text: t('parseError', { message }), tone: 'err' });
        return;
      }
      const { total, matched, duplicates = 0 } = json.summary;
      const filteredOut = json.filteredOut ?? 0;
      const text = duplicates > 0 ? t('successWithDuplicates', { total, matched, duplicates }) : t('success', { total, matched });
      toast({ text: filteredOut > 0 ? `${text} ${t('filteredOut', { n: filteredOut })}` : text, tone: 'ok' });
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={input}
        id={STATEMENT_INPUT_ID}
        type="file"
        accept=".csv,.xml,.gpc,.abo,text/csv,application/xml,text/xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {busy ? t('importing') : t('submit')}
      </button>
      {filterOpen ? (
        <label className="flex w-64 max-w-full flex-col gap-1 text-left text-xs">
          <span className="font-semibold">{t('filterLabel')}</span>
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            maxLength={500}
            placeholder={t('filterPlaceholder')}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          />
          <span className="text-[11px] text-muted-foreground">{t('filterHint')}</span>
        </label>
      ) : (
        <button type="button" onClick={() => setFilterOpen(true)} className="text-[11px] font-semibold text-primary hover:underline">
          {t('filterToggle')}
        </button>
      )}
      <InfoHint
        label={t('formatHelpLabel')}
        rowClassName="justify-end"
        bodyClassName="max-w-xs text-left"
        hint={
          <>
            {t('formatHelp')}{' '}
            <a href="/samples/bank-statement-sample.csv" download className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <Download className="h-3 w-3" aria-hidden="true" />
              {t('sample')}
            </a>
          </>
        }
      >
        <span className="text-[11px] text-muted-foreground">{t('formatHelpLabel')}</span>
      </InfoHint>
    </div>
  );
}
