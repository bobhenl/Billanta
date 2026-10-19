import { cn } from '@/lib/utils';
import type { EmbedLang, EmbedTheme } from '@/lib/embeds';

/** The card every widget sits in; `dark` scopes the dark tokens to it. */
export function EmbedFrame({
  lang,
  theme,
  className,
  children
}: {
  lang: EmbedLang;
  theme: EmbedTheme;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div lang={lang} className={cn(theme === 'dark' && 'dark')}>
      <div className={cn('rounded-xl border border-border bg-card p-4 text-card-foreground', className)}>{children}</div>
    </div>
  );
}

export function embedTheme(value: string | string[] | undefined): EmbedTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}
