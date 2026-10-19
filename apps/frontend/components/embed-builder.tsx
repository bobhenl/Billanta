'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { czechAccountToIban, isValidCzechBankAccount, isValidIban, normalizeIban } from '@faktur/cz-compliance';
import { AmountField, parseAmount, Segmented, SelectField, TextField } from '@/components/public-tools/fields';
import { toast } from '@/components/toaster';
import {
  badgeHtmlSnippet,
  badgeImageSnippet,
  badgeImageUrl,
  badgeWidth,
  embedLang,
  EMBED_LANGS,
  payButtonSnippet,
  publicInvoiceUrl,
  qrWidgetSnippet,
  qrWidgetSrc,
  vatWidgetSnippet,
  vatWidgetSrc,
  type BadgeKind,
  type EmbedLang,
  type EmbedTheme
} from '@/lib/embeds';
import { SITE_NAME } from '@/lib/site';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

export type EmbedTab = 'badge' | 'qr' | 'pay' | 'vat';

function validAccount(input: string): boolean {
  const value = input.replace(/\s+/g, '');
  if (!value) return false;
  if (/^[a-z]{2}/i.test(value)) return isValidIban(normalizeIban(value));
  return isValidCzechBankAccount(value) && !!czechAccountToIban(value);
}

/**
 * Copy-paste snippets for other people's websites: badges, the QR payment
 * widget, a "pay this invoice" button and the VAT calculator (lib/embeds.ts).
 * With `refCode` every link carries the owner's invite code. The preview
 * loads from this origin, the snippet points at SITE_URL.
 */
export function EmbedBuilder({
  tabs,
  badgeKinds = ['customer'],
  refCode,
  className
}: {
  tabs: EmbedTab[];
  badgeKinds?: BadgeKind[];
  refCode?: string | null;
  className?: string;
}) {
  const t = useTranslations('embeds');
  const locale = useLocale();
  const [tab, setTab] = useState<EmbedTab>(tabs[0]!);
  const [lang, setLang] = useState<EmbedLang>(embedLang(locale));
  const [theme, setTheme] = useState<EmbedTheme>('light');
  const [kind, setKind] = useState<BadgeKind>(badgeKinds[0]!);
  const [format, setFormat] = useState<'image' | 'html'>('image');
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CZK' | 'EUR'>(locale === 'sk' ? 'EUR' : 'CZK');
  const [vs, setVs] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [invoice, setInvoice] = useState('');
  const [copied, setCopied] = useState(false);
  const codeId = useId();

  // Labels of the snippet follow the language picked for it, not the dashboard's.
  const tl = (key: string) => t(`snippet.${lang}.${key}`, { name: SITE_NAME });
  const badgeLabel = tl(kind);

  let code = '';
  let preview: React.ReactNode = null;
  let problem: string | null = null;

  if (tab === 'badge') {
    const input = { kind, lang, theme, label: badgeLabel, ref: refCode };
    code = format === 'image' ? badgeImageSnippet(input) : badgeHtmlSnippet(input);
    preview =
      format === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={badgeImageUrl(kind, lang, theme, '')} alt={badgeLabel} width={badgeWidth(badgeLabel)} height={40} />
      ) : (
        <span dangerouslySetInnerHTML={{ __html: badgeHtmlSnippet(input) }} />
      );
  } else if (tab === 'qr') {
    const value = parseAmount(amount);
    const qr = {
      lang,
      theme,
      account,
      amount: value > 0 ? value : undefined,
      currency,
      vs: vs.replace(/\D/g, '').slice(0, 10) || undefined,
      message: message.trim().slice(0, 60) || undefined,
      name: name.trim().slice(0, 70) || undefined
    };
    if (validAccount(account)) {
      code = qrWidgetSnippet({ ...qr, title: tl('qrTitle'), linkText: tl('qrLink'), ref: refCode });
      preview = <iframe src={qrWidgetSrc(qr, '')} title={tl('qrTitle')} width={280} height={390} className="max-w-full border-0" />;
    } else {
      problem = account.trim() ? t('builder.invalidAccount') : t('builder.needAccount');
    }
  } else if (tab === 'pay') {
    const url = publicInvoiceUrl(invoice, lang);
    if (url) {
      code = payButtonSnippet({ lang, invoiceUrl: url, label: tl('payButton'), linkText: tl('payLink'), ref: refCode });
      preview = <span dangerouslySetInnerHTML={{ __html: code }} />;
    } else {
      problem = invoice.trim() ? t('builder.invalidInvoice') : t('builder.needInvoice');
    }
  } else {
    code = vatWidgetSnippet({ lang, theme, title: tl('vatTitle'), linkText: tl('vatLink'), ref: refCode });
    preview = <iframe src={vatWidgetSrc(lang, theme, '')} title={tl('vatTitle')} width="100%" height={680} className="max-w-[480px] border-0" />;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ text: t('builder.copyFailed'), tone: 'err' });
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {tabs.length > 1 && (
        <div role="tablist" className="inline-flex max-w-full flex-wrap rounded-lg border border-border bg-secondary p-0.5">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === tab}
              onClick={() => setTab(key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
                key === tab ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(`builder.tabs.${key}`)}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t('builder.lang')}
          value={lang}
          onChange={setLang}
          options={EMBED_LANGS.map((l) => ({ value: l, label: t(`builder.langs.${l}`) }))}
        />
        {tab !== 'pay' && (
          <Segmented
            label={t('builder.theme')}
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: t('builder.light') },
              { value: 'dark', label: t('builder.dark') }
            ]}
          />
        )}
        {tab === 'badge' && badgeKinds.length > 1 && (
          <SelectField label={t('builder.kind')} value={kind} onChange={setKind} options={badgeKinds.map((k) => ({ value: k, label: tl(k) }))} />
        )}
        {tab === 'badge' && (
          <Segmented
            label={t('builder.format')}
            value={format}
            onChange={setFormat}
            options={[
              { value: 'image', label: t('builder.image') },
              { value: 'html', label: t('builder.html') }
            ]}
          />
        )}
        {tab === 'qr' && (
          <>
            <TextField label={t('builder.account')} value={account} onChange={setAccount} placeholder="123456789/0800" />
            <TextField label={t('builder.name')} value={name} onChange={setName} maxLength={70} hint={t('builder.nameHint')} />
            <AmountField label={t('builder.amount')} value={amount} onChange={setAmount} />
            <Segmented
              label={t('builder.currency')}
              value={currency}
              onChange={setCurrency}
              options={[
                { value: 'CZK', label: 'CZK' },
                { value: 'EUR', label: 'EUR' }
              ]}
            />
            <TextField label={t('builder.vs')} value={vs} onChange={setVs} inputMode="numeric" maxLength={10} />
            <TextField label={t('builder.message')} value={message} onChange={setMessage} maxLength={60} />
          </>
        )}
        {tab === 'pay' && (
          <div className="sm:col-span-2">
            <TextField label={t('builder.invoice')} value={invoice} onChange={setInvoice} placeholder="https://…/i/…" hint={t('builder.invoiceHint')} />
          </div>
        )}
      </div>

      {problem ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{problem}</p>
      ) : (
        <>
          <div>
            <p className="text-sm font-medium">{t('builder.preview')}</p>
            <div className={cn('mt-1.5 overflow-x-auto rounded-lg border border-border p-4', theme === 'dark' && tab !== 'pay' ? 'bg-[#0b0c14]' : 'bg-white')}>
              {preview}
            </div>
          </div>
          <div>
            <label htmlFor={codeId} className="text-sm font-medium">
              {t('builder.code')}
            </label>
            <textarea
              id={codeId}
              readOnly
              value={code}
              rows={4}
              onFocus={(e) => e.currentTarget.select()}
              className={cn(inputClass, 'mt-1.5 h-auto resize-y font-mono text-xs')}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" onClick={copy} className={buttonClass.secondary}>
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copied ? t('builder.copied') : t('builder.copy')}
              </button>
              {tab !== 'badge' && <p className="text-xs text-muted-foreground">{t('builder.keepLink')}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
