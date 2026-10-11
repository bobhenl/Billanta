'use client';

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu, Plus, type LucideIcon } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

type Icon = LucideIcon;

export interface TabItem {
  key: string;
  href: string;
  label: string;
  icon: Icon;
  /** The one call to action in the bar: a solid accent circle, accent label. */
  cta?: boolean;
  /** Treat only an exact path match as active (for "/"-style home tabs). */
  exact?: boolean;
}

export interface PanelLink {
  key: string;
  href: string;
  label: string;
  icon: Icon;
}

/**
 * Phone navigation, modelled on VoxelRank's `.bottom-nav`
 * (public/css/header.css there):
 *
 * - a fixed 64px bar of up to five destinations, icon over a 10px label;
 * - the active destination in the accent colour, its icon on a raised chip
 *   (secondary fill + hairline), the same language as a segmented control;
 * - at most one CTA, drawn as a solid accent circle with an accent label, so
 *   it is never confused with "you are here";
 * - "More" opens a floating panel just above the bar (12px from the edges,
 *   rounded, shadowed) listing the remaining destinations plus `panelFooter`
 *   (language, theme), rather than a full-screen sheet. An open panel is
 *   that item's own active state;
 * - `actions` adds a "+" CTA in the middle of the bar that opens the same
 *   kind of panel with the create actions (new invoice, expense, contact…).
 *
 * Hidden from `md` up, where the header carries the same links.
 */
export function MobileTabBar({
  label,
  items,
  moreLabel,
  panelTitle,
  links,
  panelFooter,
  actions,
  actionsLabel
}: {
  label: string;
  items: TabItem[];
  moreLabel?: string;
  panelTitle?: string;
  links?: PanelLink[];
  panelFooter?: ReactNode;
  actions?: PanelLink[];
  actionsLabel?: string;
}) {
  const pathname = usePathname();
  const [panel, setPanel] = useState<'more' | 'actions' | null>(null);
  const open = panel === 'more';
  const setOpen = (value: boolean | ((v: boolean) => boolean)) =>
    setPanel((current) => ((typeof value === 'function' ? value(current === 'more') : value) ? 'more' : null));
  const rootRef = useRef<HTMLElement>(null);
  const hasPanel = Boolean(moreLabel && (links?.length || panelFooter));
  const hasActions = Boolean(actions?.length && actionsLabel);
  // The "+" sits in the middle of the destinations.
  const ctaAt = Math.ceil(items.length / 2);

  useEffect(() => setPanel(null), [pathname]);
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [panel]);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const panelActive = open || Boolean(links?.some((link) => isActive(link.href)));

  return (
    <nav ref={rootRef} aria-label={label} className="bottom-nav fixed inset-x-0 bottom-0 z-40 md:hidden">
      {hasActions && panel === 'actions' && (
        <div
          id="bottom-nav-actions"
          className="fixed inset-x-3 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-xl animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
          style={{ bottom: 'calc(var(--tabbar-h) + 12px + env(safe-area-inset-bottom, 0px))' }}
        >
          <p className="mb-2 px-2 text-sm font-bold">{actionsLabel}</p>
          <ul className="grid grid-cols-2 gap-2">
            {actions!.map(({ key, href, label: actionLabel, icon: ActionIcon }) => (
              <li key={key}>
                <Link
                  href={href}
                  onClick={() => setPanel(null)}
                  className="flex h-full flex-col items-start gap-2 rounded-lg border border-border px-3 py-3 text-sm font-semibold transition-colors hover:bg-secondary active:bg-secondary"
                >
                  <ActionIcon className="h-5 w-5 text-primary" />
                  {actionLabel}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasPanel && open && (
        <div
          id="bottom-nav-panel"
          className="fixed inset-x-3 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-xl animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
          style={{ bottom: 'calc(var(--tabbar-h) + 12px + env(safe-area-inset-bottom, 0px))' }}
        >
          {panelTitle && <p className="mb-2 px-2 text-sm font-bold">{panelTitle}</p>}
          {links && links.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {links.map(({ key, href, label: linkLabel, icon: LinkIcon }) => {
                const active = isActive(href);
                return (
                  <li key={key}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-2 py-2.5 text-sm font-medium transition-colors',
                        active ? 'bg-secondary text-primary' : 'text-foreground hover:bg-secondary'
                      )}
                    >
                      <LinkIcon className="h-[18px] w-[18px] text-muted-foreground" />
                      {linkLabel}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {panelFooter && (
            <div className={cn('space-y-3 px-2', links?.length && 'mt-3 border-t border-border pt-3')}>{panelFooter}</div>
          )}
        </div>
      )}

      <ul
        className="flex items-stretch border-t border-border bg-card"
        style={{
          height: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}
      >
        {items.map(({ key, href, label: itemLabel, icon: ItemIcon, cta, exact }, index) => {
          const active = isActive(href, exact);
          return (
            <Fragment key={key}>
            {hasActions && index === ctaAt && (
              <li className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setPanel((current) => (current === 'actions' ? null : 'actions'))}
                  aria-expanded={panel === 'actions'}
                  aria-controls="bottom-nav-actions"
                  className={cn(itemClass, 'w-full text-primary')}
                >
                  <TabIcon icon={Plus} active={false} cta />
                  <span className="max-w-full truncate">{actionsLabel}</span>
                </button>
              </li>
            )}
            <li className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                // Close the "More" panel at once; waiting for the route change
                // leaves it open over the old page while the next one loads.
                onClick={() => setOpen(false)}
                className={cn(itemClass, cta ? 'text-primary' : active ? 'text-primary' : 'text-muted-foreground')}
              >
                <TabIcon icon={ItemIcon} active={active} cta={cta} />
                <span className="max-w-full truncate">{itemLabel}</span>
              </Link>
            </li>
            </Fragment>
          );
        })}
        {hasPanel && (
          <li className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="bottom-nav-panel"
              className={cn(itemClass, 'w-full', panelActive ? 'text-primary' : 'text-muted-foreground')}
            >
              <TabIcon icon={Menu} active={panelActive} />
              <span className="max-w-full truncate">{moreLabel}</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}

const itemClass =
  'flex h-full flex-col items-center justify-center gap-0.5 px-0.5 pb-1 pt-1.5 text-[10px] font-semibold leading-none transition-[color,opacity] active:opacity-70';

function TabIcon({ icon: ItemIcon, active, cta }: { icon: Icon; active: boolean; cta?: boolean }) {
  if (cta) {
    return (
      <span className="mb-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-primary text-primary-foreground">
        <ItemIcon className="h-4 w-4" strokeWidth={2.75} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'mb-0.5 flex h-[22px] w-[30px] items-center justify-center rounded-full transition-[background-color,box-shadow]',
        active && 'bg-secondary shadow-[inset_0_0_0_1px_hsl(var(--border))]'
      )}
    >
      <ItemIcon className="h-[18px] w-[18px]" strokeWidth={active ? 2.4 : 2} />
    </span>
  );
}
