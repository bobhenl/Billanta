import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BannerTone = 'ok' | 'err' | 'warn' | 'info';

const TONES: Record<BannerTone, { box: string; icon: string; Icon: LucideIcon }> = {
  ok: { box: 'border-l-success bg-success/10', icon: 'text-success', Icon: CheckCircle2 },
  err: { box: 'border-l-destructive bg-destructive/10', icon: 'text-destructive', Icon: AlertCircle },
  warn: { box: 'border-l-warning bg-warning/10', icon: 'text-warning', Icon: AlertTriangle },
  info: { box: 'border-l-primary bg-accent/60', icon: 'text-primary', Icon: Info }
};

/**
 * Inline status banner, after VoxelRank's `.flash`: a thin border with a
 * 4px coloured left edge on a lightly tinted panel. Use it for messages
 * that belong to a place on the page (a form's error, an OAuth callback
 * result, a load failure); use `toast()` for "done" confirmations that need
 * no reading. Text stays in the normal foreground colour for contrast; only
 * the edge and the icon carry the tone.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  action,
  className
}: {
  tone?: BannerTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      role={tone === 'err' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-lg border border-l-4 border-border px-3.5 py-2.5 text-sm', box, className)}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-relaxed [&_a]:font-semibold [&_a]:underline">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5 text-muted-foreground')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
