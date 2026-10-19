import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { apiFetch } from '@/lib/api-client';
import { TEMPLATE_PRESETS } from '../templates/presets';
import { InvoiceForm } from './invoice-form';
import { UUID, loadContact, loadFormContext } from './load';
import type { DocumentType, DocLanguage, InvoiceTemplate, PaymentMethod } from './types';
import { writeGate } from '@/components/write-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invoiceForm');
  return { title: t('title') };
}

const NEW_TYPES: DocumentType[] = ['invoice', 'proforma', 'quote'];

/** `GET /api/v1/invoice-templates/:id` row (camelCase). */
interface SavedTemplate {
  id: string;
  name: string;
  contactId: string | null;
  documentType: DocumentType;
  currency: string;
  dueInDays: number | null;
  paymentMethod: PaymentMethod | null;
  noteAbove: string | null;
  noteBelow: string | null;
  language?: DocLanguage | null;
  lineItems: { description: string; quantity: number | string; unit?: string | null; unitPrice: number | string; vatRate: number | string | null; discountPercent?: number | string | null }[];
}

/**
 * Starting points, first match wins:
 * - `?preset=<key>` a built-in starter from the gallery,
 * - `?template=<id>` a saved invoice template (gallery → "Použít"),
 * - `?from=<invoiceId>` a copy of that invoice ("Duplikovat"); `?from=latest`
 *   the most recent one. With `&similar=1` ("Podle faktury", "Vystavit
 *   podobnou") the due date follows the default term, not the source's,
 * - `?contact=<contactId>` a chosen customer ("Nová faktura" in contacts).
 * `?type=proforma|quote` preselects the document type. Anything that cannot
 * be loaded just falls back to an empty form.
 */
async function loadTemplate(params: {
  preset?: string;
  template?: string;
  from?: string;
  similar?: string;
  contact?: string;
}): Promise<{ template: InvoiceTemplate | null; templateId: string | null }> {
  const preset = TEMPLATE_PRESETS.find((p) => p.key === params.preset);
  if (preset) {
    const t = await getTranslations(`templates.presets.${preset.key}`);
    return {
      templateId: null,
      template: {
        templateName: t('name'),
        contact: await loadContact(params.contact),
        documentType: preset.documentType,
        dueInDays: preset.dueInDays,
        items: preset.items.map((item, i) => ({ ...item, description: t(`items.${i}`), discountPercent: 0 }))
      }
    };
  }
  if (params.template && UUID.test(params.template)) {
    const saved = await apiFetch<SavedTemplate>(`/api/v1/invoice-templates/${params.template}`).catch(() => null);
    if (saved) {
      return {
        templateId: saved.id,
        template: {
          templateName: saved.name,
          contact: await loadContact(saved.contactId),
          documentType: saved.documentType === 'credit_note' ? 'invoice' : saved.documentType,
          currency: saved.currency,
          dueInDays: saved.dueInDays,
          paymentMethod: saved.paymentMethod ?? undefined,
          noteAbove: saved.noteAbove,
          noteBelow: saved.noteBelow,
          items: (saved.lineItems ?? []).map((item) => ({
            description: item.description,
            quantity: Number(item.quantity),
            unit: item.unit ?? null,
            unitPrice: Number(item.unitPrice),
            vatRate: item.vatRate == null ? null : Number(item.vatRate),
            discountPercent: Number(item.discountPercent ?? 0)
          }))
        }
      };
    }
  }
  if (params.from && (UUID.test(params.from) || params.from === 'latest')) {
    const copy = await apiFetch<InvoiceTemplate>(`/api/v1/invoices/${params.from}/duplicate`).catch(() => null);
    if (copy?.documentType === 'credit_note') copy.documentType = 'invoice';
    if (copy && params.similar === '1') copy.dueInDays = null;
    return { template: copy, templateId: null };
  }
  const contact = await loadContact(params.contact);
  return { template: contact ? { contact } : null, templateId: null };
}

export default async function NewInvoicePage(
  props: {
    searchParams: Promise<{ from?: string; similar?: string; contact?: string; template?: string; preset?: string; type?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const gate = await writeGate('invoices', '/invoices');
  if (gate) return gate;
  const t = await getTranslations('invoiceForm');
  const [{ defaults, ai, starred }, { template: loaded, templateId }] = await Promise.all([loadFormContext(), loadTemplate(searchParams)]);

  const type = NEW_TYPES.find((x) => x === searchParams.type);
  const template = type ? { contact: null, ...loaded, documentType: type } : loaded;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-extrabold tracking-tight">{t(`titles.${template?.documentType ?? 'invoice'}`)}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('lead')}</p>
      {searchParams.from === 'latest' && !loaded && (
        <Banner tone="info" className="mt-4">
          {t('copy.noneYet')}
        </Banner>
      )}
      {template?.templateName ? (
        <Banner tone="info" className="mt-4">
          {t('fromTemplate', { name: template.templateName })}
        </Banner>
      ) : (
        template?.items && (
          <Banner tone="info" className="mt-4">
            {searchParams.similar === '1'
              ? template.sourceNumber
                ? t('copy.fromNumber', { number: template.sourceNumber })
                : t('copy.fromDraft')
              : template.sourceNumber
                ? t('duplicate.fromNumber', { number: template.sourceNumber })
                : t('duplicate.fromDraft')}
          </Banner>
        )
      )}
      <div className="mt-6">
        {/* Keyed by the starting point, so "Podle faktury" on this page starts over with the copy. */}
        <InvoiceForm
          key={[searchParams.from, searchParams.template, searchParams.preset, searchParams.contact, searchParams.type].join('|')}
          mode={{ kind: 'create', templateId }} defaults={defaults} ai={ai} starred={starred} template={template} />
      </div>
    </div>
  );
}
