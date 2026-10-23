import { ArrowRight } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

type Href = ComponentProps<typeof Link>['href'];

/**
 * An action on an audience page. `href` strings starting with `mailto:` stay
 * plain anchors; everything else goes through the locale-aware Link.
 */
export type AudienceAction = { href: Href; label: string; locale?: string };

function ActionLink({ action, className, children }: { action: AudienceAction; className: string; children: React.ReactNode }) {
  if (typeof action.href === 'string' && action.href.startsWith('mailto:')) {
    return (
      <a href={action.href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={action.href} locale={action.locale} className={className}>
      {children}
    </Link>
  );
}

/** One primary button and at most one secondary text link, the same pattern as home and pricing. */
export function AudienceActions({ primary, secondary, className }: { primary: AudienceAction; secondary?: AudienceAction | null; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6', className)}>
      <ActionLink action={primary} className={cn(buttonClass.primary, 'w-full px-6 py-3 sm:w-auto')}>
        {primary.label}
      </ActionLink>
      {secondary && (
        <ActionLink action={secondary} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
          {secondary.label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </ActionLink>
      )}
    </div>
  );
}

/** Headline, one lead line and the page's single primary action. */
export function AudienceHero({ title, lead, primary, secondary }: { title: string; lead: string; primary: AudienceAction; secondary?: AudienceAction | null }) {
  return (
    <>
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground sm:text-lg">{lead}</p>
      <AudienceActions primary={primary} secondary={secondary} className="mt-6" />
    </>
  );
}

export function SectionTitle({ title, lead }: { title: string; lead?: string }) {
  return (
    <>
      <h2 className="mt-12 text-xl font-bold tracking-tight">{title}</h2>
      {lead && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{lead}</p>}
    </>
  );
}

/** The closing box: repeats the primary action once at the end of a long page. */
export function ClosingCta({ title, body, primary, secondary }: { title: string; body?: string; primary: AudienceAction; secondary?: AudienceAction | null }) {
  return (
    <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {body && <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{body}</p>}
      <AudienceActions primary={primary} secondary={secondary} className="mt-5" />
    </div>
  );
}
