import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { EmbedBuilder, type EmbedTab } from '@/components/embed-builder';
import type { BadgeKind } from '@/lib/embeds';
import { cn } from '@/lib/utils';

/**
 * The snippet builder with a heading. `embeds` is a server-only namespace
 * (lib/client-messages.ts): only the pages that show the builder send it
 * to the browser, through the provider here.
 */
export async function EmbedSection({
  section,
  tabs,
  badgeKinds,
  refCode,
  className
}: {
  section: 'settings' | 'partners' | 'accountants' | 'calculator';
  tabs: EmbedTab[];
  badgeKinds?: BadgeKind[];
  refCode?: string | null;
  className?: string;
}) {
  const t = await getTranslations(`embeds.sections.${section}`);
  const messages = await getMessages();
  return (
    <section className={cn('rounded-xl border border-border bg-card p-4 sm:p-6', className)}>
      <h2 className="text-lg font-bold tracking-tight">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      <NextIntlClientProvider messages={{ embeds: messages.embeds! }}>
        <EmbedBuilder tabs={tabs} badgeKinds={badgeKinds} refCode={refCode} className="mt-4" />
      </NextIntlClientProvider>
    </section>
  );
}
