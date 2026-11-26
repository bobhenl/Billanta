import { cn } from '@/lib/utils';

/**
 * A row of jump or filter chips. On a phone it is one line that swipes
 * sideways inside its own box (bleeding to the screen edge, so the last
 * chip visibly runs off and reads as scrollable); from `sm` up it wraps.
 */
export function ChipRow({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label} className={cn('-mx-4 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0', className)}>
      <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">{children}</ul>
    </nav>
  );
}

export const chipClass =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary';
