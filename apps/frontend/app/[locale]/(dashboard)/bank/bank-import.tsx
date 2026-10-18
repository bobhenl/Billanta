'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, UploadCloud } from 'lucide-react';
import { InfoHint } from '@/components/info-hint';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from '@/components/toaster';

/** What the backend parses: CSV, camt.053 XML and GPC/ABO. */
const STATEMENT_EXTENSIONS = ['.csv', '.xml', '.gpc', '.abo'];
const STATEMENT_ERRORS = ['bank_statement_unknown_format', 'bank_statement_invalid'];

/** "Nahrát výpis" – posts the statement through `/api/bank/import`, then refreshes the list. */
export function BankImport() {
  const t = useTranslations('bank.import');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

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
      const res = await fetch('/api/bank/import', { method: 'POST', body });
      const json = (await res.json().catch(() => ({}))) as {
        summary?: { total: number; matched: number; duplicates?: number };
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
      toast({
        text: duplicates > 0 ? t('successWithDuplicates', { total, matched, duplicates }) : t('success', { total, matched }),
        tone: 'ok'
      });
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
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {busy ? t('importing') : t('submit')}
      </button>
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
