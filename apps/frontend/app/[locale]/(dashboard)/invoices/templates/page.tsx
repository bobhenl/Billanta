import type { Metadata } from 'next';
import { ArrowLeft, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/api-client';
import { TEMPLATE_PRESETS } from './presets';
import { TemplateGallery, type SavedTemplateRow } from './template-gallery';
import { writeGate } from '@/components/write-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('templates');
  return { title: t('title') };
}

/**
 * Template gallery: the tenant's saved templates (most used first) and a row
 * of built-in starters. A card opens the invoice form pre-filled; its menu
 * offers bulk invoicing, rename and delete.
 */
export default async function TemplatesPage() {
  // Every card and menu item here makes or changes something.
  const gate = await writeGate('invoices', '/invoices');
  if (gate) return gate;
  const t = await getTranslations('templates');
  const tInv = await getTranslations('invoices');
  let loadError = false;
  const saved = await apiFetch<SavedTemplateRow[]>('/api/v1/invoice-templates').catch(() => {
    loadError = true;
    return [] as SavedTemplateRow[];
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/invoices" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {tInv('title')}
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('lead')}</p>
        </div>
        <Link
          href="/invoices/bulk"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary"
        >
          <Users className="h-4 w-4" />
          {t('bulkCta')}
        </Link>
      </div>
      {loadError && (
        <Banner tone="err" className="mt-4">
          {t('loadError')}
        </Banner>
      )}
      <TemplateGallery saved={saved} presets={TEMPLATE_PRESETS} />
    </div>
  );
}
