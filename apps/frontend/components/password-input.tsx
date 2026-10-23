'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * A password field with an eye button that shows what was typed, so people
 * on a phone can check a long password before they submit it.
 */
export function PasswordInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const t = useTranslations('common');
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <span className="relative block">
      <input {...props} type={visible ? 'text' : 'password'} className={cn(className, 'w-full pr-10')} />
      <button
        type="button"
        aria-label={visible ? t('hidePassword') : t('showPassword')}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    </span>
  );
}
