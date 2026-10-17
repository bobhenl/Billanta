'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Briefcase, Building2, Check, CreditCard, Download, Gift, History, LogOut, Plus, Settings, User, UserCog, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { signOut, useSession } from 'next-auth/react';
import { Link, useRouter } from '@/i18n/navigation';
import { InstallAppButton } from '@/components/install-app-button';
import { switchTenant } from '@/lib/tenant-actions';

export interface MenuCompany {
  id: string;
  companyName: string;
}

const ITEMS = [
  { key: 'profile', href: '/settings/profile', icon: UserCog },
  { key: 'company', href: '/settings/company', icon: Building2 },
  { key: 'team', href: '/settings/team', icon: Users },
  { key: 'exports', href: '/settings/exports', icon: Download },
  { key: 'activity', href: '/activity', icon: History },
  { key: 'billing', href: '/billing', icon: CreditCard },
  { key: 'referrals', href: '/settings/referrals', icon: Gift },
  { key: 'settings', href: '/settings', icon: Settings }
] as const;

/**
 * Avatar button that opens the account menu: who is signed in, the
 * account-level sections (profile, company, team, exports, subscription,
 * settings), the company list (the active one is always shown; with more than one
 * company you switch here, `switchTenant`, see lib/api-client.ts), and "Log out" (Auth.js
 * `signOut`, back to the homepage).
 */
export function UserMenu({ companies = [], activeId = null }: { companies?: MenuCompany[]; activeId?: string | null }) {
  const t = useTranslations('common');
  const tMenu = useTranslations('common.userMenu');
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const email = session?.user?.email;
  const name = session?.user?.name;
  const initial = (name ?? email ?? '').trim().charAt(0).toUpperCase();
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [switching, startSwitch] = useTransition();
  const activeCompany = companies.find((c) => c.id === activeId);

  function handleSwitch(id: string) {
    startSwitch(async () => {
      const result = await switchTenant(id);
      if (!result.ok) return;
      setOpen(false);
      router.push('/dashboard');
      router.refresh();
    });
  }

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
        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
      >
        {initial || <User className="h-4 w-4" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 text-card-foreground shadow-lg"
        >
          <div className="flex items-center gap-2.5 border-b border-border px-2 pb-2.5 pt-1.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {initial || <User className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              {name && <p className="truncate text-sm font-semibold">{name}</p>}
              {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
              {activeCompany && <p className="truncate text-xs font-medium text-primary">{activeCompany.companyName}</p>}
            </div>
          </div>
          {companies.length > 0 && (
            <div className="border-b border-border py-1">
              <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tMenu('companies')}</p>
              {companies.length > 0 &&
                companies.map((company) => {
                  const active = company.id === activeId;
                  return (
                    <button
                      key={company.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      disabled={switching}
                      onClick={() => (active ? setOpen(false) : handleSwitch(company.id))}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
                    >
                      <Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{company.companyName}</span>
                      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              <Link
                href="/settings/companies"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Plus className="h-4 w-4" />
                {tMenu(companies.length > 1 ? 'manageCompanies' : 'addCompany')}
              </Link>
            </div>
          )}
          <div className="py-1">
            {ITEMS.map(({ key, href, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                {tMenu(key)}
              </Link>
            ))}
            <InstallAppButton
              onDone={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            />
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut({ callbackUrl: '/' });
            }}
            className="flex w-full items-center gap-2.5 rounded-md border-t border-border px-2 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            {t('logOut')}
          </button>
        </div>
      )}
    </div>
  );
}
