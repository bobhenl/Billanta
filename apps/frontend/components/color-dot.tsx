import { CONTACT_COLOR_DOT, isContactColor } from '@/lib/contact-colors';
import { cn } from '@/lib/utils';

/** The customer's colour label as a small dot; renders nothing without one. */
export function ColorDot({ color, className, label }: { color: string | null | undefined; className?: string; label?: string }) {
  if (!isContactColor(color)) return null;
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', CONTACT_COLOR_DOT[color], className)}
      aria-label={label}
      title={label}
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}
