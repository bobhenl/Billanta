'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';
import { czechAccountToIban, generateSpaydString, isValidCzechBankAccount, isValidIban, normalizeIban } from '@faktur/cz-compliance';
import { AmountField, parseAmount, Segmented, TextField } from '@/components/public-tools/fields';
import { buttonClass } from '@/components/modal';
import { cn } from '@/lib/utils';

/** Domestic "19-2000145399/0800" or an IBAN → IBAN, or an error key. */
function resolveAccount(input: string): { iban: string } | { error: 'empty' | 'invalidAccount' | 'invalidIban' } {
  const value = input.trim();
  if (!value) return { error: 'empty' };
  if (/^[a-z]{2}/i.test(value)) return isValidIban(value) ? { iban: normalizeIban(value) } : { error: 'invalidIban' };
  const compact = value.replace(/\s+/g, '');
  if (!isValidCzechBankAccount(compact)) return { error: 'invalidAccount' };
  return { iban: czechAccountToIban(compact)! };
}

/**
 * QR Platba (SPAYD) generated in the browser: nothing is sent anywhere, the
 * same generateSpaydString the invoices use builds the string and the
 * `qrcode` package draws it.
 */
export function QrPaymentGenerator() {
  const t = useTranslations('tools.calculators.items.qrPayment');
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('1 500');
  const [currency, setCurrency] = useState<'CZK' | 'EUR'>('CZK');
  const [vs, setVs] = useState('');
  const [message, setMessage] = useState('');
  const [png, setPng] = useState<string | null>(null);

  const resolved = resolveAccount(account);
  const value = parseAmount(amount);
  const spayd =
    'iban' in resolved
      ? generateSpaydString({
          iban: resolved.iban,
          amount: value > 0 ? value : undefined,
          currency,
          variableSymbol: vs.replace(/\D/g, '').slice(0, 10) || undefined,
          message: message.trim().slice(0, 60) || undefined
        })
      : null;

  useEffect(() => {
    let live = true;
    if (!spayd) {
      setPng(null);
      return;
    }
    QRCode.toDataURL(spayd, { errorCorrectionLevel: 'M', margin: 2, width: 480 })
      .then((url) => live && setPng(url))
      .catch(() => live && setPng(null));
    return () => {
      live = false;
    };
  }, [spayd]);

  const error = 'error' in resolved && resolved.error !== 'empty' ? t(`errors.${resolved.error}`) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={(e) => e.preventDefault()}>
        <div>
          <TextField label={t('fields.account')} value={account} onChange={setAccount} placeholder="123456789/0800" hint={t('fields.accountHint')} />
          {error && (
            <p role="alert" className="mt-1 text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <AmountField label={t('fields.amount')} value={amount} onChange={setAmount} />
          <Segmented
            label={t('fields.currency')}
            value={currency}
            onChange={setCurrency}
            options={[
              { value: 'CZK', label: 'CZK' },
              { value: 'EUR', label: 'EUR' }
            ]}
          />
        </div>
        <TextField label={t('fields.vs')} value={vs} onChange={setVs} inputMode="numeric" maxLength={10} hint={t('fields.vsHint')} />
        <TextField label={t('fields.message')} value={message} onChange={setMessage} maxLength={60} />
      </form>
      <section aria-live="polite" className="flex flex-col items-center justify-center rounded-xl border border-border bg-card p-5 text-center">
        {png && spayd && 'iban' in resolved ? (
          <>
            {/* White plate: banking apps read dark-on-light codes most reliably, also in dark mode. */}
            <div className="rounded-lg bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={png} alt={t('result.alt')} width={240} height={240} className="h-60 w-60" />
            </div>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">QR Platba</p>
            <p className="mt-3 break-all font-mono text-xs text-muted-foreground">{resolved.iban}</p>
            <a href={png} download="qr-platba.png" className={cn(buttonClass.secondary, 'mt-4')}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('result.download')}
            </a>
            <details className="mt-4 w-full text-left text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('result.spayd')}</summary>
              <code className="mt-2 block break-all rounded-md bg-secondary p-2">{spayd}</code>
            </details>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('result.empty')}</p>
        )}
      </section>
    </div>
  );
}
