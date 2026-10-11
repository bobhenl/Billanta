import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Standard shadcn/ui class-merging helper. Components generated via the
 * shadcn CLI (`pnpm dlx shadcn@latest add ...`) expect this to exist at
 * `@/lib/utils`, per components.json's `aliases.utils`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
