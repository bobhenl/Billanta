import type { ComponentType } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { FEATURE_PAGES } from '@/lib/feature-pages';
import { CALCULATORS, GUIDES, isPublishedIn } from '@/lib/public-tools';
import { cn } from '@/lib/utils';

type Icon = ComponentType<{ className?: string }>;

/**
 * Building blocks of the pages by experience level (/your-first-invoice,
 * /invoicing-for-beginners, /invoicing-for-advanced) and by team role
 * (/team-roles, /for-owners, /for-assistants). Copy lives in the
 * server-only `learnPages` namespace; the cards and FAQ come from
 * components/segment-page.tsx.
 */
export function PageIntro({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children?: React.ReactNode }) {
  return (
    <>
      <p className="text-sm font-bold uppercase tracking-wider text-primary">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{lead}</p>
      {children && <div className="mt-6 flex flex-wrap gap-2">{children}</div>}
    </>
  );
}

export function NumberedSteps({ steps, className }: { steps: { title: string; body: string }[]; className?: string }) {
  return (
    <ol className={cn('mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {steps.map(({ title, body }, i) => (
        <li key={title} className="rounded-xl border border-border bg-card p-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
          <h3 className="mt-3 font-bold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        </li>
      ))}
    </ol>
  );
}

export function CheckList({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cn('space-y-2 text-sm', className)}>
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Icon cards that each lead to the page explaining the topic in depth. */
export function LinkCards({ items, more }: { items: { icon: Icon; title: string; body: string; href: string }[]; more: string }) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(({ icon: Icon, title, body, href }) => (
        <Link key={href} href={href} className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <h3 className="mt-3 font-bold">{title}</h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">{body}</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:underline">
            {more}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </Link>
      ))}
    </div>
  );
}

type FeatureSlug = (typeof FEATURE_PAGES)[number]['slug'];
type CalculatorSlug = (typeof CALCULATORS)[number]['slug'];

/**
 * Related free tools: every guide and the chosen calculators published in
 * this locale (a Czech-rules page is not offered to Slovak readers), then
 * the chosen feature pages. New guides in lib/public-tools.ts show up here
 * by themselves.
 */
export async function ToolLinks({
  locale,
  title,
  lead,
  calculators,
  features
}: {
  locale: string;
  title: string;
  lead?: string;
  calculators: CalculatorSlug[];
  features: FeatureSlug[];
}) {
  const tTools = await getTranslations('tools');
  const tFeatures = await getTranslations('featurePages');
  const links = [
    ...GUIDES.filter((g) => isPublishedIn(g, locale)).map((g) => ({ href: `/guides/${g.slug}`, label: tTools(`guides.items.${g.key}.name`) })),
    ...calculators
      .map((slug) => CALCULATORS.find((c) => c.slug === slug)!)
      .filter((c) => isPublishedIn(c, locale))
      .map((c) => ({ href: `/calculators/${c.slug}`, label: tTools(`calculators.items.${c.key}.name`) })),
    ...features.map((slug) => FEATURE_PAGES.find((f) => f.slug === slug)!).map((f) => ({ href: `/features/${f.slug}`, label: tFeatures(`items.${f.key}.name`) }))
  ];
  return (
    <>
      <h2 className="mt-12 text-xl font-bold tracking-tight">{title}</h2>
      {lead && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{lead}</p>}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {links.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} className="flex gap-2 rounded-lg border border-border bg-card p-3 text-sm hover:border-primary/40">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/calculators" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        {tTools('common.allCalculators')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </>
  );
}

/** "Where to next" between the level and role pages. */
export function NextPages({ title, items }: { title: string; items: { href: string; title: string; body: string }[] }) {
  return (
    <>
      <h2 className="mt-12 text-xl font-bold tracking-tight">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {items.map(({ href, title: itemTitle, body }) => (
          <Link key={href} href={href} className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
            <p className="flex items-center justify-between gap-2 font-bold">
              {itemTitle}
              <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
