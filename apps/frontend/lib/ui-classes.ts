/**
 * Shared button and input classes. Kept out of `components/modal.tsx`
 * because that is a client module: a server component importing a plain
 * object from it gets a client reference, and every class comes out
 * `undefined`.
 */
export const buttonClass = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50',
  ghost:
    'inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:opacity-50'
};

export const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20';
