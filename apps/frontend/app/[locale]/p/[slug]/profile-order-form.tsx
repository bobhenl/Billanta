'use client';

import { useEffect, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { PaymentDetails, type PaymentDetailRow } from '@/app/[locale]/i/[token]/payment-details';
import { BuyerFields, buyerForSubmit, buyerInputClass, emptyBuyer, type BuyerFieldsValue } from '@/components/buyer-fields';
import { InfoHint } from '@/components/info-hint';
import { submitProfileOrder, type OrderPayment } from '@/lib/public-profile-actions';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const MAX_CUSTOM_ITEMS = 5;

interface Service {
  id: string;
  title: string;
  unitPrice: number | null;
  unit: string | null;
}

/**
 * "Objednat" on the public profile. The order becomes a draft the company
 * reviews and issues itself; the customer only gets the thank-you screen
 * (with payment details when the company asks for payment up front).
 */
export function ProfileOrderForm({
  slug,
  companyName,
  services,
  customItemsAllowed,
  currency
}: {
  slug: string;
  companyName: string;
  services: Service[];
  customItemsAllowed: boolean;
  currency: string;
}) {
  const t = useTranslations('publicProfile.order');
  const locale = useLocale();
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? '');
  // `?service=<id>` (the owner's shareable link) is read here and not on the
  // server, so the profile page stays static and cacheable.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('service');
    if (id && services.some((s) => s.id === id)) setServiceId(id);
  }, [services]);
  const [quantity, setQuantity] = useState('1');
  const [items, setItems] = useState<{ description: string; quantity: string }[]>([]);
  const [buyer, setBuyer] = useState<BuyerFieldsValue>(() => emptyBuyer());
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ payment: OrderPayment | null; qrSvg: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  const money = (n: number, cur = currency) => new Intl.NumberFormat(locale, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n);
  const service = services.find((s) => s.id === serviceId) ?? null;
  const qty = Number(quantity.replace(',', '.'));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    startTransition(async () => {
      const r = await submitProfileOrder(slug, {
        serviceId: serviceId || null,
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        customItems: items.map((i) => ({ description: i.description, quantity: Number(i.quantity.replace(',', '.')) || 1 })),
        buyer: buyerForSubmit(buyer),
        note,
        website
      });
      if (r.ok) {
        setDone({ payment: r.payment, qrSvg: r.qrSvg });
        return;
      }
      if (r.fields) setFields(r.fields);
      setError(t(`errors.${r.error}`));
    });
  };

  if (done) {
    const p = done.payment;
    const payRows: PaymentDetailRow[] = p
      ? [
          { label: t('payAmount'), value: money(p.amount, p.currency), copy: String(p.amount), strong: true },
          ...(p.accountNumber ? [{ label: t('payAccount'), value: p.accountNumber }] : []),
          ...(p.iban ? [{ label: 'IBAN', value: p.iban.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 '), copy: p.iban.replace(/\s+/g, '') }] : []),
          { label: t('payVs'), value: p.variableSymbol, strong: true },
          { label: t('payRecipient'), value: p.recipient, copy: null }
        ]
      : [];
    return (
      <div className="rounded-2xl border border-success/40 bg-card p-5 sm:p-6" role="status">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <CheckCircle2 className="h-5 w-5 text-success" />
          {t('doneTitle')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('doneText', { company: companyName })}</p>
        {p && (
          <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
            <h3 className="font-semibold">{t('payTitle')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('payHint', { company: companyName })}</p>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
              {done.qrSvg && (
                <div
                  className="mx-auto h-44 w-44 shrink-0 rounded-lg bg-white p-1 sm:mx-0 [&_svg]:h-full [&_svg]:w-full"
                  // Built by our own server action with the `qrcode` library from a SPAYD
                  // string of the backend's payment details; no visitor input in it.
                  dangerouslySetInnerHTML={{ __html: done.qrSvg }}
                />
              )}
              <PaymentDetails rows={payRows} className="min-w-0 flex-1" />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{t('payNote')}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <ShoppingCart className="h-5 w-5 text-primary" />
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('hint', { company: companyName })}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
        <label className="min-w-0 text-sm">
          <span className="mb-1 block font-medium">{t('service')}</span>
          <select className={buyerInputClass} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {customItemsAllowed && <option value="">{t('noService')}</option>}
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.unitPrice != null ? ` – ${money(s.unitPrice)}${s.unit ? ` / ${s.unit}` : ''}` : ''}
              </option>
            ))}
          </select>
        </label>
        {serviceId && (
          <label className="text-sm">
            <span className="mb-1 block font-medium">
              {t('quantity')}
              {service?.unit ? ` (${service.unit})` : ''}
            </span>
            <input
              className={buyerInputClass}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              required
              maxLength={9}
              aria-invalid={Boolean(fields.quantity)}
            />
          </label>
        )}
      </div>
      {service && (
        <p className="mt-2 text-xs text-muted-foreground">
          {service.unitPrice != null && Number.isFinite(qty) && qty > 0 ? t('estimate', { amount: money(service.unitPrice * qty) }) : t('priceLater')}
        </p>
      )}

      {customItemsAllowed && (
        <div className="mt-4">
          <InfoHint hint={t('customItemsHint')} rowClassName="text-sm font-medium">
            {t('customItems')}
          </InfoHint>
          <ul className="mt-2 space-y-2">
            {items.map((item, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_80px_auto] gap-2">
                <input
                  className={buyerInputClass}
                  value={item.description}
                  onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  maxLength={200}
                  required
                  minLength={2}
                  placeholder={t('itemDescription')}
                  aria-label={t('itemDescription')}
                />
                <input
                  className={buyerInputClass}
                  value={item.quantity}
                  onChange={(e) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                  inputMode="decimal"
                  maxLength={9}
                  aria-label={t('quantity')}
                />
                <button
                  type="button"
                  onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t('removeItem')}
                  aria-label={t('removeItem')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          {items.length < MAX_CUSTOM_ITEMS && (
            <button
              type="button"
              onClick={() => setItems((cur) => [...cur, { description: '', quantity: '1' }])}
              className={cn(buttonClass.secondary, 'mt-2')}
            >
              <Plus className="h-4 w-4" />
              {t('addItem')}
            </button>
          )}
          {fields.customItems && <p className="mt-1 text-xs text-destructive">{t('errors.items')}</p>}
        </div>
      )}

      <h3 className="mt-6 text-sm font-semibold">{t('buyerTitle')}</h3>
      <BuyerFields value={buyer} onChange={setBuyer} fields={fields} lookupUrl={`/api/public/profiles/${encodeURIComponent(slug)}/orders/lookup`} emailRequired />

      <label className="mt-4 block text-sm">
        <span className="mb-1 block font-medium">{t('note')}</span>
        <textarea className={`${buyerInputClass} h-auto py-2`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t('notePlaceholder')} />
      </label>

      {/* Honeypot: hidden from people and screen readers, bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={pending || (!serviceId && items.length === 0)}
        className={cn(buttonClass.primary, 'mt-5 h-10 w-full gap-2 px-5 sm:w-auto')}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('submit')}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">{t('legal')}</p>
    </form>
  );
}
