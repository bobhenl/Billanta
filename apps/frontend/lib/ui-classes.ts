/**
 * Shared button and input classes. Kept out of `components/modal.tsx`
 * because that is a client module: a server component importing a plain
 * object from it gets a client reference, and every class comes out
 * `undefined`.
 */
export const buttonClass = {
  // Solid buttons give a slight press; colour changes stay at 150ms everywhere.
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition duration-150 ease-out hover:opacity-90 motion-safe:active:scale-[0.98] disabled:opacity-50 motion-safe:disabled:scale-100',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors duration-150 hover:bg-accent hover:text-primary active:bg-accent disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground transition duration-150 ease-out hover:opacity-90 motion-safe:active:scale-[0.98] disabled:opacity-50 motion-safe:disabled:scale-100',
  ghost:
    'inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-primary active:bg-accent disabled:opacity-50'
};

export const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20';
