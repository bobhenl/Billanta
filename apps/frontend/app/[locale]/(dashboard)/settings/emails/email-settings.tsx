'use client';

import { useRef, useState, useTransition } from 'react';
import { BellRing, Check, FileText, Loader2, Paperclip, Save, Send, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { Link, useRouter } from '@/i18n/navigation';
import type { EmailPrefs } from '@/lib/tenant';
import { fillSample, sampleValues, type TemplateVar } from '@/lib/template-vars';
import { cn } from '@/lib/utils';
import { PDF_ACCENTS } from '../../invoices/new/types';
import { updateEmailPrefs } from '../actions';

/** The built-ins offered as chips; the rest are listed in Settings → Proměnné. */
const PLACEHOLDERS = ['number', 'amount', 'due_date', 'vs', 'customer', 'link', 'company', 'reminder_no'] as const;

/**
 * The backend's built-in texts (email.service.ts) — shown as placeholders so
 * an empty field visibly means "the default". The emails go out in Czech.
 */
const DEFAULTS = {
  invoice: { subject: 'Faktura {number}', message: 'Byla vám vystavena nová faktura. Podrobnosti a možnosti úhrady najdete níže.' },
  reminder: {
    subject: 'Upomínka: faktura {number} je po splatnosti',
    message: 'Tato faktura je po splatnosti a podle našich záznamů dosud nebyla uhrazena.'
  }
} as const;

type Kind = keyof typeof DEFAULTS;
type Field = 'subject' | 'message' | 'signature';

export function EmailSettings({
  prefs,
  companyName,
  companyEmail,
  customVars,
  readOnly
}: {
  prefs: EmailPrefs;
  companyName: string;
  companyEmail: string | null;
  customVars: TemplateVar[];
  readOnly: boolean;
}) {
  const t = useTranslations('settings.emails');
  const router = useRouter();
  const [fromName, setFromName] = useState(prefs.fromName ?? '');
  const [replyTo, setReplyTo] = useState(prefs.replyTo ?? '');
  const [bccMe, setBccMe] = useState(prefs.bccMe);
  const [texts, setTexts] = useState({
    invoice: { subject: prefs.invoiceSubject ?? '', message: prefs.invoiceMessage ?? '' },
    reminder: { subject: prefs.reminderSubject ?? '', message: prefs.reminderMessage ?? '' }
  });
  const [signature, setSignature] = useState(prefs.signature ?? '');
  const [attachPdf, setAttachPdf] = useState(prefs.attachPdf);
  const [attachIsdoc, setAttachIsdoc] = useState(prefs.attachIsdoc);
  const [accent, setAccent] = useState(prefs.accent);
  const [kind, setKind] = useState<Kind>('invoice');
  const [focused, setFocused] = useState<Field>('message');
  const [saving, startSave] = useTransition();
  const refs = {
    subject: useRef<HTMLInputElement>(null),
    message: useRef<HTMLTextAreaElement>(null),
    signature: useRef<HTMLTextAreaElement>(null)
  };

  const replyToValid = replyTo.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo.trim());

  const setField = (field: Field, value: string) => {
    if (field === 'signature') setSignature(value);
    else setTexts((all) => ({ ...all, [kind]: { ...all[kind], [field]: value } }));
  };
  const valueOf = (field: Field) => (field === 'signature' ? signature : texts[kind][field]);

  /** Drops `{placeholder}` at the cursor of the last focused field. */
  const insert = (placeholder: string) => {
    const el = refs[focused].current;
    const current = valueOf(focused);
    const token = `{${placeholder}}`;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    setField(focused, current.slice(0, start) + token + current.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = () =>
    startSave(async () => {
      const clean = (v: string) => v.trim() || null;
      const result = await updateEmailPrefs({
        from_name: clean(fromName),
        reply_to: replyTo.trim(),
        bcc_me: bccMe,
        invoice_subject: clean(texts.invoice.subject),
        invoice_message: clean(texts.invoice.message),
        reminder_subject: clean(texts.reminder.subject),
        reminder_message: clean(texts.reminder.message),
        signature: clean(signature),
        attach_pdf: attachPdf,
        attach_isdoc: attachIsdoc,
        accent
      });
      toast(result.ok ? { text: t('saved'), tone: 'ok' } : { text: `${t('saveFailed')}: ${result.error}`, tone: 'err' });
      if (result.ok) router.refresh();
    });

  const sample = sampleValues({ companyName, email: companyEmail }, customVars);
  const fill = (template: string) => fillSample(template, sample);

  const card = 'rounded-xl border border-border bg-card p-5';
  const label = 'mb-1 block text-xs font-semibold text-muted-foreground';
  const check = 'flex items-center gap-2.5 text-sm';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (replyToValid) save();
      }}
      className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      <fieldset disabled={readOnly} className="min-w-0 space-y-6">
        <section className={card}>
          <InfoHint hint={t('senderHint')}>
            <h2 className="flex items-center gap-2 font-bold">
              <UserRound className="h-4 w-4 text-primary" />
              {t('senderTitle')}
            </h2>
          </InfoHint>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={label}>{t('fromName')}</span>
              <input value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={80} placeholder={companyName} className={inputClass} />
            </label>
            <label className="block">
              <InfoHint hint={t('replyToHint')} className={label}>
                <span>{t('replyTo')}</span>
              </InfoHint>
              <input
                type="email"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                maxLength={200}
                placeholder={companyEmail ?? 'fakturace@firma.cz'}
                aria-invalid={!replyToValid}
                className={cn(inputClass, !replyToValid && 'border-destructive')}
              />
              {!replyToValid && <span className="mt-1 block text-xs text-destructive">{t('replyToInvalid')}</span>}
            </label>
          </div>
          <label className={cn(check, 'mt-4')}>
            <input type="checkbox" checked={bccMe} onChange={(e) => setBccMe(e.target.checked)} className="accent-[hsl(var(--primary))]" />
            <InfoHint hint={t('bccHint', { email: companyEmail ?? '–' })}>
              <span>{t('bcc')}</span>
            </InfoHint>
          </label>
        </section>

        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <InfoHint hint={t('textsHint')}>
              <h2 className="font-bold">{t('textsTitle')}</h2>
            </InfoHint>
            <div className="inline-flex rounded-full bg-muted p-0.5" role="tablist">
              {(['invoice', 'reminder'] as const).map((k) => {
                const Icon = k === 'invoice' ? Send : BellRing;
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold transition-colors',
                      kind === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t(`kinds.${k}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <label className="block">
              <span className={label}>{t('subject')}</span>
              <input
                ref={refs.subject}
                value={texts[kind].subject}
                onChange={(e) => setField('subject', e.target.value)}
                onFocus={() => setFocused('subject')}
                maxLength={200}
                placeholder={DEFAULTS[kind].subject}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={label}>{t('message')}</span>
              <textarea
                ref={refs.message}
                value={texts[kind].message}
                onChange={(e) => setField('message', e.target.value)}
                onFocus={() => setFocused('message')}
                maxLength={2000}
                rows={4}
                placeholder={DEFAULTS[kind].message}
                className={inputClass}
              />
            </label>
            <label className="block">
              <InfoHint hint={t('signatureHint')} className={label}>
                <span>{t('signature')}</span>
              </InfoHint>
              <textarea
                ref={refs.signature}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                onFocus={() => setFocused('signature')}
                maxLength={500}
                rows={3}
                placeholder={t('signaturePlaceholder', { company: companyName })}
                className={inputClass}
              />
            </label>
            <div>
              <InfoHint hint={t('placeholdersHint')} className={label}>
                <span>{t('placeholders')}</span>
              </InfoHint>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.filter((p) => kind === 'reminder' || p !== 'reminder_no').map((p) => (
                  <button
                    key={p}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert(p)}
                    title={t(`ph.${p}`)}
                    className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs hover:border-primary hover:text-primary"
                  >
                    {`{${p}}`}
                    <span className="ml-1.5 font-sans text-muted-foreground">{t(`ph.${p}`)}</span>
                  </button>
                ))}
                {customVars.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert(v.key)}
                    title={v.value}
                    className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 font-mono text-xs text-primary hover:border-primary"
                  >
                    {`{${v.key}}`}
                    {v.label && <span className="ml-1.5 font-sans opacity-70">{v.label}</span>}
                  </button>
                ))}
                <Link href="/settings/variables" className="rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:underline">
                  {t('moreVars')}
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className={card}>
          <h2 className="flex items-center gap-2 font-bold">
            <Paperclip className="h-4 w-4 text-primary" />
            {t('attachTitle')}
          </h2>
          <div className="mt-3 space-y-2">
            <label className={check}>
              <input type="checkbox" checked={attachPdf} onChange={(e) => setAttachPdf(e.target.checked)} className="accent-[hsl(var(--primary))]" />
              <InfoHint hint={t('attachPdfHint')}>
                <span>{t('attachPdf')}</span>
              </InfoHint>
            </label>
            <label className={check}>
              <input type="checkbox" checked={attachIsdoc} onChange={(e) => setAttachIsdoc(e.target.checked)} className="accent-[hsl(var(--primary))]" />
              <InfoHint hint={t('attachIsdocHint')}>
                <span>{t('attachIsdoc')}</span>
              </InfoHint>
            </label>
          </div>
          <div className="mt-5">
            <span className={label}>{t('accent')}</span>
            <div className="flex flex-wrap items-center gap-2">
              {PDF_ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccent(c)}
                  aria-label={c}
                  aria-pressed={accent.toLowerCase() === c}
                  style={{ backgroundColor: c }}
                  className={cn('flex h-7 w-7 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-card', accent.toLowerCase() === c && 'ring-2 ring-foreground/40')}
                >
                  {accent.toLowerCase() === c && <Check className="h-4 w-4" />}
                </button>
              ))}
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label={t('accentCustom')} title={t('accentCustom')} className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent" />
            </div>
          </div>
        </section>

        {!readOnly && (
          <div className="sticky bottom-20 z-10 flex justify-end md:bottom-4">
            <button type="submit" disabled={saving || !replyToValid} className={cn(buttonClass.primary, 'shadow-lg')}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t('save')}
            </button>
          </div>
        )}
      </fieldset>

      <aside className="lg:sticky lg:top-20">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('preview')}</p>
        <div className="overflow-hidden rounded-xl border border-border bg-[#f6f7f9] text-[#111827] shadow-sm">
          <div className="space-y-0.5 border-b border-black/10 bg-white px-4 py-3 text-xs text-[#6b7280]">
            <p>
              <span className="font-semibold text-[#111827]">{fromName.trim() || companyName}</span> &lt;{t('previewFromAddress')}&gt;
            </p>
            {(replyTo.trim() || companyEmail) && (
              <p>
                {t('previewReplyTo')}: {replyTo.trim() || companyEmail}
              </p>
            )}
            <p className="pt-1 text-sm font-bold text-[#111827]">{fill(texts[kind].subject || DEFAULTS[kind].subject)}</p>
          </div>
          <div className="p-4">
            <div className="rounded-lg bg-white p-5">
              <p className="text-base font-bold">
                {kind === 'invoice' ? `Nová faktura ${sample.number}` : `Upomínka – faktura ${sample.number} po splatnosti`}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#374151]">{fill(texts[kind].message || DEFAULTS[kind].message)}</p>
              <div className="mt-4 rounded-md bg-[#f6f7f9] p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#6b7280]">Částka</span>
                  <span className="font-bold">{sample.amount}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-[#6b7280]">Splatnost</span>
                  <span>{sample.due_date}</span>
                </div>
              </div>
              <span className="mt-4 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: accent }}>
                Zobrazit a zaplatit fakturu
              </span>
              {(attachPdf || attachIsdoc) && (
                <p className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-[#6b7280]">
                  <FileText className="h-3.5 w-3.5" />
                  {[attachPdf && `faktura-${sample.number}.pdf`, attachIsdoc && `faktura-${sample.number}.isdoc`].filter(Boolean).join(', ')}
                </p>
              )}
              {signature.trim() && <p className="mt-4 whitespace-pre-line border-t border-black/10 pt-3 text-sm text-[#374151]">{fill(signature)}</p>}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('previewNote')}</p>
      </aside>
    </form>
  );
}
