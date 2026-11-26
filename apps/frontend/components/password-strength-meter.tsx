'use client';

import { useTranslations } from 'next-intl';
import { passwordStrength } from '@/lib/password-strength';
import { cn } from '@/lib/utils';

const LEVELS = ['tooWeak', 'weak', 'fair', 'good', 'strong'] as const;
const BAR = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-success/80', 'bg-success'];

/** Four bars and a word under a new-password field; hidden until something is typed. */
export function PasswordStrengthMeter({ password, id }: { password: string; id?: string }) {
  const t = useTranslations('auth.passwordStrength');
  if (!password) return null;
  const score = passwordStrength(password);
  return (
    <div id={id} className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={cn('h-1.5 flex-1 rounded-full', n <= Math.max(score, 1) ? BAR[score] : 'bg-muted')} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{t('label', { level: t(LEVELS[score]) })}</span>
    </div>
  );
}
