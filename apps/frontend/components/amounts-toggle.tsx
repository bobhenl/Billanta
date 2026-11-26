'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const KEY = 'billanta:hide-amounts';
const ATTR = 'data-hide-amounts';

/**
 * Runs before the dashboard paints, so a member who hid the amounts never
 * sees them flash on a reload. Only this browser remembers the choice: it is
 * for screen sharing or a café table, not an access control.
 */
export const HIDE_AMOUNTS_SCRIPT = `try{if(localStorage.getItem('${KEY}')==='1')document.documentElement.setAttribute('${ATTR}','')}catch(e){}`;

/** Eye in the header: blurs every element marked `.amount` (see globals.css). */
export function AmountsToggle({ className }: { className?: string }) {
  const t = useTranslations('amounts');
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    setHidden(document.documentElement.hasAttribute(ATTR));
  }, []);

  function toggle() {
    const next = !hidden;
    document.documentElement.toggleAttribute(ATTR, next);
    try {
      if (next) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      // Private mode: the choice lasts until the tab closes.
    }
    setHidden(next);
  }

  const label = hidden ? t('show') : t('hide');
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={hidden ?? false}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        hidden && 'text-primary',
        className
      )}
    >
      {hidden ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
    </button>
  );
}
