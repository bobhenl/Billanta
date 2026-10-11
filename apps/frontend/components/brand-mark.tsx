import { cn } from '@/lib/utils';

/**
 * The Billanta mark: a geometric "B" on an indigo-to-violet tile, with a
 * small green "paid" dot. Same drawing as app/icon.svg. Fixed brand colours
 * rather than theme tokens, so the logo is identical in light and dark.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('h-7 w-7 shrink-0', className)}>
      <defs>
        <linearGradient id="brand-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#brand-mark-g)" />
      <path
        d="M10.5 7.5h6.3a4.25 4.25 0 0 1 0 8.5H10.5zM10.5 16h7.4a4.5 4.5 0 0 1 0 9h-7.4z"
        fill="none"
        stroke="#fff"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <circle cx="24.6" cy="8.4" r="2.6" fill="#4ade80" />
    </svg>
  );
}
