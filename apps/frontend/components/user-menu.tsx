'use client';

import { useEffect, useRef, useState } from 'react';
import { LogOut, User } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * User-menu placeholder for the dashboard navbar — an avatar circle that
 * opens a small dropdown with "Log out". Purely UI: there is no Auth.js
 * session anywhere in this scaffold yet (see (dashboard)/layout.tsx's
 * existing TODO), so this doesn't know who's signed in and "Log out" is a
 * no-op. Wire this up to a real session once auth exists.
 */
export function UserMenu() {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('accountMenu')}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
      >
        <User className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-44 rounded-md border border-border bg-card p-1 text-card-foreground shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              // TODO: wire this up once Auth.js sessions exist — no real
              // sign-out flow is possible yet.
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            {t('logOut')}
          </button>
        </div>
      )}
    </div>
  );
}
