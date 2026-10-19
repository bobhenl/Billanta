import { getTranslations } from 'next-intl/server';
import QRCode from 'qrcode';
import {
  czechAccountToIban,
  generateSpaydString,
  isValidCzechBankAccount,
  isValidIban,
  normalizeIban,
  paymentQrScheme
} from '@faktur/cz-compliance';
import { generatePayBySquareString } from '@faktur/cz-compliance/pay-by-square';
import { embedLang } from '@/lib/embeds';
import { EmbedFrame, embedTheme, one } from '../embed-frame';

type Search = Record<string, string | string[] | undefined>;

function toIban(input: string): string | null {
  const value = input.replace(/\s+/g, '');
  if (/^[a-z]{2}/i.test(value)) return isValidIban(value) ? normalizeIban(value) : null;
  return isValidCzechBankAccount(value) ? czechAccountToIban(value) : null;
}

/**
 * `/embed/qr?acc=…&am=…&cc=…`: a payment QR code for someone's own site
 * (a donation box, a price list, a shop without a gateway). Drawn on the
 * server as SVG, so the frame runs no script at all. Same scheme rule as
 * invoices: a Slovak IBAN gets PAY by square, the rest QR Platba.
 */
export default async function EmbedQrPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const lang = embedLang(one(q.lang));
  const theme = embedTheme(q.theme);
  const t = await getTranslations({ locale: lang, namespace: 'embeds.qr' });

  const iban = toIban(one(q.acc));
  const amount = Math.round(Number(one(q.am).replace(',', '.')) * 100) / 100;
  const currency = one(q.cc).toUpperCase() === 'EUR' ? 'EUR' : 'CZK';
  const vs = one(q.vs).replace(/\D/g, '').slice(0, 10) || undefined;
  const message = one(q.msg).trim().slice(0, 60) || undefined;
  const name = one(q.name).trim().slice(0, 70);

  if (!iban) {
    return (
      <EmbedFrame lang={lang} theme={theme} className="text-center text-sm text-muted-foreground">
        {t('invalid')}
      </EmbedFrame>
    );
  }

  const pay = { iban, amount: amount > 0 ? amount : undefined, currency, variableSymbol: vs, message };
  let svg: string;
  let bySquare = false;
  if (paymentQrScheme({ payeeIban: iban, currency }) === 'pay_by_square' && name) {
    try {
      svg = await QRCode.toString(generatePayBySquareString({ ...pay, beneficiaryName: name }), { type: 'svg', margin: 1 });
      bySquare = true;
    } catch {
      svg = await QRCode.toString(generateSpaydString(pay), { type: 'svg', margin: 1 });
    }
  } else {
    svg = await QRCode.toString(generateSpaydString(pay), { type: 'svg', margin: 1 });
  }

  const money = new Intl.NumberFormat(lang, { style: 'currency', currency, maximumFractionDigits: 2 });

  return (
    <EmbedFrame lang={lang} theme={theme} className="mx-auto max-w-[280px] text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{bySquare ? 'PAY by square' : t('title')}</p>
      {name && <p className="mt-1 truncate text-sm font-semibold">{name}</p>}
      {/* White plate: banking apps read dark-on-light codes most reliably, also in dark mode. */}
      <div
        className="mx-auto mt-3 w-48 rounded-lg bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
        role="img"
        aria-label={t('alt')}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {pay.amount && <p className="mt-3 text-xl font-bold tabular-nums">{money.format(pay.amount)}</p>}
      <p className="mt-1 text-xs text-muted-foreground">{t('scan')}</p>
      <dl className="mt-3 space-y-0.5 text-left text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t('account')}</dt>
          <dd className="break-all font-mono">{iban}</dd>
        </div>
        {vs && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('vs')}</dt>
            <dd className="font-mono">{vs}</dd>
          </div>
        )}
        {message && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t('message')}</dt>
            <dd className="truncate">{message}</dd>
          </div>
        )}
      </dl>
    </EmbedFrame>
  );
}
