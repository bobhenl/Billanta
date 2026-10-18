import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { CALCULATORS, GUIDES, isPublishedIn } from '@/lib/public-tools';
import { cn } from '@/lib/utils';
import { ToolTabsStrip } from '@/components/public-tools/tool-tabs-strip';

/**
 * Tab row at the top of the calculators (and guides) hub and every page in
 * it. Each tab is a plain link to its own URL: the pages stay separate,
 * indexable documents, this only makes hopping between them one tap.
 * Only pages published in this language are listed, and the row is not
 * drawn when there is just one, since a single tab switches nothing.
 *
 * Scrolls sideways inside its own box on a phone, so a long row never
 * widens the page. `ToolTabsStrip` keeps that sideways position from page
 * to page and keeps the active tab in view.
 */
export async function ToolTabs({ kind, current }: { kind: 'calculators' | 'guides'; current?: string }) {
  const t = await getTranslations('tools');
  const locale = await getLocale();
  const tools = (kind === 'calculators' ? CALCULATORS : GUIDES).filter((x) => isPublishedIn(x, locale));
  if (tools.length < 2) return null;

  const tabs = [
    { href: `/${kind}`, label: t('common.overview'), active: !current },
    ...tools.map((x) => ({ href: `/${kind}/${x.slug}`, label: t(`${kind}.items.${x.key}.name`), active: x.slug === current }))
  ];
  return (
    <ToolTabsStrip storageKey={kind} label={t(`menu.${kind}`)} className="mb-8 max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
      <ul className="flex w-max gap-1 rounded-xl border border-border bg-card p-1">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                'block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                tab.active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </ToolTabsStrip>
  );
}
