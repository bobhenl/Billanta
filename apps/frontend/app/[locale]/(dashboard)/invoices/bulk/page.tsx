import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/api-client';
import type { Contact } from '../new/types';
import type { SavedTemplateRow } from '../templates/template-gallery';
import { BulkForm } from './bulk-form';
import { writeGate } from '@/components/write-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bulk');
  return { title: t('title') };
}

/** Bulk invoicing: one document per chosen customer from a saved template (`?template=<id>` preselects it). */
export default async function BulkInvoicePage(props: { searchParams: Promise<{ template?: string }> }) {
  const searchParams = await props.searchParams;
  const gate = await writeGate('invoices', '/invoices');
  if (gate) return gate;
  const t = await getTranslations('bulk');
  const tTpl = await getTranslations('templates');
  const [templates, contacts] = await Promise.all([
    apiFetch<SavedTemplateRow[]>('/api/v1/invoice-templates').catch(() => [] as SavedTemplateRow[]),
    apiFetch<Contact[]>('/api/v1/contacts').catch(() => [] as Contact[])
  ]);
  const initial = templates.find((tpl) => tpl.id === searchParams.template)?.id ?? templates[0]?.id ?? null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/invoices/templates" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {tTpl('title')}
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{t('title')}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('lead')}</p>
      {templates.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="font-semibold">{t('noTemplates')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('noTemplatesHint')}</p>
          <Link href="/invoices/templates" className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
            {tTpl('title')}
          </Link>
        </div>
      ) : (
        <BulkForm templates={templates} contacts={contacts} initialTemplateId={initial} />
      )}
    </div>
  );
}
