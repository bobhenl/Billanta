import { cn } from '@/lib/utils';

/**
 * The Billanta mark: the document "B" from the logo (public/brand/logo.png),
 * same picture as app/icon.png. A plain <img> rather than next/image: it is a
 * few dozen pixels, always the same file, and the image optimizer would only
 * add a request. Identical in light and dark; the wordmark next to it is text.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/mark.png" alt="" aria-hidden="true" width={28} height={28} className={cn('h-7 w-7 shrink-0', className)} />
  );
}
