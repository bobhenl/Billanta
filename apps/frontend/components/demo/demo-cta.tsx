import { PlayCircle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { DemoViewRole } from '@/lib/demo';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/**
 * "Try it in the demo" for public pages. `view` opens the demo through a
 * colleague's eyes (the accountant, a read-only member), so a page about
 * roles or the accountant shows exactly that. `feature` names what to look
 * for, in the page's own words.
 */
export async function DemoCta({ view = 'owner', feature, className }: { view?: DemoViewRole; feature?: string; className?: string }) {
  const t = await getTranslations('demo.ctaCard');
  const tRoles = await getTranslations('demo.roles');
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex gap-3">
        <PlayCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="font-semibold">{feature ? t('titleFeature', { feature }) : t('title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{view === 'owner' ? t('lead') : t('leadView', { role: tRoles(`${view}.label`) })}</p>
        </div>
      </div>
      <Link href={view === 'owner' ? '/demo' : `/demo?view=${view}`} className={cn(buttonClass.secondary, 'shrink-0')}>
        {view === 'owner' ? t('button') : t('buttonView', { role: tRoles(`${view}.label`) })}
      </Link>
    </div>
  );
}
