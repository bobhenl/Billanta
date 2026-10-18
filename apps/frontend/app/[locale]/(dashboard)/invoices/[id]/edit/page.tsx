import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { apiFetch } from '@/lib/api-client';
import { InvoiceForm } from '../../new/invoice-form';
import { UUID, loadFormContext } from '../../new/load';
import type { Contact, DocLanguage, DocumentType, InvoiceTemplate, PaymentMethod } from '../../new/types';

export async function generateMetadata(props: { searchParams: Promise<{ issued?: string }> }): Promise<Metadata> {
  const t = await getTranslations('invoiceForm');
  return { title: (await props.searchParams).issued === '1' ? t('editIssuedTitle', { number: '' }).trim() : t('editTitle') };
}

interface DetailResponse {
  invoice: {
    id: string;
    status: string;
    invoiceNumber: string | null;
    documentType: DocumentType;
    issueDate: string | null;
    dueDate: string | null;
    taxableSupplyDate: string | null;
    currency: string;
    paymentMethod: PaymentMethod;
    paymentMethodLabel: string | null;
    paymentInstructions: string | null;
    variableSymbol: string | null;
    constantSymbol: string | null;
    specificSymbol: string | null;
    orderNumber: string | null;
    buyerContactPerson: string | null;
    issuePlace: string | null;
    issuedByName: string | null;
    customFields: { label: string; value: string; kind?: 'text' | 'amount' | 'percent'; internal?: boolean }[] | null;
    noteAbove: string | null;
    noteBelow: string | null;
    internalNote: string | null;
    language: DocLanguage;
    reverseCharge: boolean;
    reverseChargeCode: string | null;
    exchangeRate: string | null;
    bankAccountId: string | null;
  };
  contact: Contact | null;
  items: { description: string; quantity: string; unit: string | null; code: string | null; unitPrice: string; vatRate: string | null; discountPercent: string | null }[];
}

const EDITABLE = new Set(['draft', 'pending_review']);
/** "Přesto upravit": issued or paid documents, with a reason that lands in the history. */
const EDITABLE_WITH_REASON = new Set(['issued', 'paid']);

/**
 * Edit a draft (or an AI draft waiting for review). An issued or paid
 * document opens here only via "Přesto upravit" (`?issued=1`); anything
 * else goes back to its detail.
 */
export default async function EditInvoicePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ issued?: string; reason?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  if (!UUID.test(params.id)) notFound();
  const t = await getTranslations('invoiceForm');
  const [detail, { defaults, ai, starred }] = await Promise.all([
    apiFetch<DetailResponse>(`/api/v1/invoices/${params.id}/detail`).catch(() => null),
    loadFormContext()
  ]);
  if (!detail) notFound();
  const { invoice } = detail;
  const issuedEdit = EDITABLE_WITH_REASON.has(invoice.status) && searchParams.issued === '1';
  if (!EDITABLE.has(invoice.status) && !issuedEdit) redirect({ href: `/invoices/${invoice.id}`, locale: await getLocale() });

  const template: InvoiceTemplate = {
    contact: detail.contact,
    documentType: invoice.documentType,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate == null ? null : Number(invoice.exchangeRate),
    bankAccountId: invoice.bankAccountId,
    paymentMethod: invoice.paymentMethod,
    paymentMethodLabel: invoice.paymentMethodLabel,
    paymentInstructions: invoice.paymentInstructions,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    taxableSupplyDate: invoice.taxableSupplyDate,
    variableSymbol: invoice.variableSymbol,
    constantSymbol: invoice.constantSymbol,
    specificSymbol: invoice.specificSymbol,
    orderNumber: invoice.orderNumber,
    buyerContactPerson: invoice.buyerContactPerson,
    issuePlace: invoice.issuePlace,
    issuedByName: invoice.issuedByName,
    customFields: invoice.customFields ?? [],
    noteAbove: invoice.noteAbove,
    noteBelow: invoice.noteBelow,
    internalNote: invoice.internalNote,
    language: invoice.language,
    reverseCharge: invoice.reverseCharge,
    reverseChargeCode: invoice.reverseChargeCode,
    items: detail.items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit,
      code: item.code,
      unitPrice: Number(item.unitPrice),
      vatRate: item.vatRate == null ? null : Number(item.vatRate),
      discountPercent: Number(item.discountPercent ?? 0)
    }))
  };

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-extrabold tracking-tight">
        {issuedEdit ? t('editIssuedTitle', { number: invoice.invoiceNumber ?? '' }) : t('editTitle')}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{issuedEdit ? t('editIssuedLead') : t('editLead')}</p>
      <div className="mt-6">
        <InvoiceForm
          mode={{ kind: 'edit', id: invoice.id, issued: issuedEdit, reason: issuedEdit ? searchParams.reason?.slice(0, 1000) : undefined }}
          defaults={defaults} ai={ai} starred={starred} template={template} />
      </div>
    </div>
  );
}
