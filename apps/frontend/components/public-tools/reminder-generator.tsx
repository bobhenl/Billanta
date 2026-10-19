'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { AmountField, parseAmount, Segmented, SelectField, TextField } from '@/components/public-tools/fields';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

export type ReminderKind = 'reminder' | 'demand' | 'preAction';
type Tone = 'polite' | 'firm';
type Letter = { greeting: string; body: string[] };

const DEADLINES = ['7', '10', '14', '15', '30'];
const CURRENCIES = ['CZK', 'EUR'] as const;

const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function fromInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * The payment reminder generator on /payment-reminder-templates: a few
 * fields in, the letter out as text to copy or as a PDF (rendered by the
 * backend, nothing stored). The wording lives in `reminderGenerator.letter`
 * per language; the legal sentences there are the ones the page backs with
 * links to the law. Empty fields show as [placeholders], so the preview
 * reads as a letter from the first keystroke.
 */
export function ReminderGenerator({ kinds, initialKind }: { kinds: readonly ReminderKind[]; initialKind: ReminderKind }) {
  const t = useTranslations('reminderGenerator');
  const format = useFormatter();
  const locale = useLocale();
  const [kind, setKind] = useState<ReminderKind>(initialKind);
  const [tone, setTone] = useState<Tone>(initialKind === 'reminder' ? 'polite' : 'firm');
  const [creditor, setCreditor] = useState('');
  const [debtor, setDebtor] = useState('');
  const [invoice, setInvoice] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>(locale === 'sk' ? 'EUR' : 'CZK');
  const [due, setDue] = useState('');
  const [account, setAccount] = useState('');
  const [deadline, setDeadline] = useState('7');
  // Today comes after mount: the server's date can differ from the visitor's.
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const long = (d: Date) => format.dateTime(d, { day: 'numeric', month: 'long', year: 'numeric' });
  const dueDate = fromInput(due);
  const value = parseAmount(amount);
  const params = {
    invoice: invoice.trim() || t('blank.invoice'),
    amount: value ? format.number(value, { style: 'currency', currency }) : t('blank.amount'),
    due: dueDate ? long(dueDate) : t('blank.due'),
    dayAfter: dueDate ? long(addDays(dueDate, 1)) : t('blank.dayAfter'),
    deadline: today ? long(addDays(today, Number(deadline))) : t('blank.deadline'),
    pay: account.trim() ? t('letter.payAccount', { account: account.trim() }) : t('letter.payInvoice')
  };
  const title = t(`letter.${kind}.title`);
  const letter = t.raw(`letter.${kind}.${tone}`) as Letter;
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? params[k as keyof typeof params] : m));
  const sender = creditor.trim() || t('blank.creditor');
  const head = [
    t('letter.from', { creditor: sender }),
    t('letter.to', { debtor: debtor.trim() || t('blank.debtor') }),
    t('letter.date', { date: today ? long(today) : t('blank.date') }),
    t('letter.subject', { title, invoice: params.invoice })
  ];
  const body = [letter.greeting, ...letter.body.map(fill), `${t('letter.closing')}\n${sender}`];
  const text = `${head.join('\n')}\n\n${body.join('\n\n')}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('errors.copy'));
    }
  }

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/public/guest-letter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language: locale, title, body: `${head.join('\n')}\n\n${body.join('\n\n')}` })
      });
      if (!res.ok) {
        setError(res.status === 429 ? t('errors.rateLimited') : res.status === 503 ? t('errors.busy') : t('errors.failed'));
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${t(`file.${kind}`)}${invoice.trim() ? `-${invoice.trim().replace(/[^\w.-]+/g, '_')}` : ''}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('errors.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" onSubmit={(e) => e.preventDefault()}>
        <h2 className="text-lg font-bold">{t('title')}</h2>
        {kinds.length > 1 && (
          <SelectField label={t('fields.kind')} value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: t(`letter.${k}.title`) }))} />
        )}
        <Segmented
          label={t('fields.tone')}
          value={tone}
          onChange={setTone}
          options={(['polite', 'firm'] as const).map((x) => ({ value: x, label: t(`fields.${x}`) }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('fields.creditor')} value={creditor} onChange={setCreditor} placeholder={t('fields.creditorPh')} maxLength={200} />
          <TextField label={t('fields.debtor')} value={debtor} onChange={setDebtor} placeholder={t('fields.debtorPh')} maxLength={200} />
          <TextField label={t('fields.invoice')} value={invoice} onChange={setInvoice} placeholder="2026-0042" maxLength={40} />
          <TextField label={t('fields.due')} type="date" value={due} onChange={setDue} />
          <AmountField label={t('fields.amount')} value={amount} onChange={setAmount} />
          <SelectField label={t('fields.currency')} value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          <TextField label={t('fields.account')} value={account} onChange={setAccount} placeholder={t('fields.accountPh')} hint={t('fields.accountHint')} maxLength={60} />
          <SelectField
            label={t('fields.deadline')}
            value={deadline}
            onChange={setDeadline}
            options={DEADLINES.map((d) => ({ value: d, label: t('fields.days', { n: Number(d) }) }))}
          />
        </div>
        {kind === 'preAction' && <p className="text-xs text-muted-foreground">{t('preActionHint')}</p>}
      </form>

      <section aria-labelledby="reminder-preview" className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/60 px-4 py-2 text-xs text-muted-foreground">
          <h2 id="reminder-preview" className="font-bold uppercase tracking-wider">
            {t('preview')}
          </h2>
          <span>{title}</span>
        </div>
        <div className="whitespace-pre-wrap break-words p-4 text-sm leading-relaxed sm:p-6" aria-live="polite">
          {text}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border p-4">
          <button type="button" onClick={copy} className={buttonClass.secondary}>
            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copied ? t('copied') : t('copy')}
          </button>
          <button type="button" onClick={download} disabled={busy} className={cn(buttonClass.primary)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            {t('pdf')}
          </button>
        </div>
        {error && (
          <p role="alert" className="px-4 pb-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
    </div>
  );
}
