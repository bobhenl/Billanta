import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * What an empty list shows: an icon, one line, an optional hint and at most
 * one primary action. Every list in the app uses it, so "nothing here yet"
 * looks the same everywhere. `framed={false}` drops the dashed box for a
 * table cell or list row that already has its own border.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  framed = true,
  className
}: {
  icon: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  framed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('px-4 py-10 text-center', framed && 'rounded-xl border border-dashed border-border', className)}>
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mx-auto mt-3 max-w-md text-sm font-semibold text-foreground">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
