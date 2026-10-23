'use client';

import { type FormEvent, useState, useTransition } from 'react';
import { Check, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { useLeaveOffline } from '@/components/offline-sync';
import { InfoHint } from '@/components/info-hint';
import type { CurrentTenant } from '@/lib/api-client';
import { createTenant, switchTenant } from '@/lib/tenant-actions';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

// Mirrors MAX_OWNED_TENANTS in apps/backend/src/me/me.service.ts.
const MAX_OWNED = 10;
const ROLES = ['owner', 'admin', 'accountant', 'viewer'];

/** The account's companies (switch with one click) and the "add a company" form. */
export function CompaniesManager({ companies, activeId }: { companies: CurrentTenant[]; activeId: string }) {
  const t = useTranslations('settings.companies');
  const leaveOffline = useLeaveOffline();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [tos, setTos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owned = companies.filter((c) => c.role === 'owner').length;
  const atLimit = owned >= MAX_OWNED;

  function handleSwitch(id: string) {
    setError(null);
    startTransition(async () => {
      if (!(await leaveOffline())) return;
      const result = await switchTenant(id);
      if (!result.ok) return setError(result.error);
      router.push('/dashboard');
      router.refresh();
    });
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      if (!(await leaveOffline())) return;
      const result = await createTenant(name, tos);
      if (!result.ok) return setError(result.error);
      router.push('/settings/company');
      router.refresh();
    });
  }

  const linkClass = 'font-medium text-foreground underline underline-offset-2 hover:no-underline';

  return (
    <div className="mt-6 space-y-6">
      {error && <Banner tone="err" title={t(`errors.${error}` as 'errors.generic')} />}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <ul className="divide-y divide-border">
          {companies.map((company) => {
            const active = company.id === activeId;
            return (
              <li key={company.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold" title={company.companyName}>
                    {company.companyName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`roles.${ROLES.includes(company.role) ? company.role : 'viewer'}` as 'roles.owner')}
                  </p>
                </div>
                {active ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                    <Check className="h-3.5 w-3.5" />
                    {t('active')}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleSwitch(company.id)}
                    className={cn(buttonClass.secondary, 'shrink-0 py-1.5')}
                  >
                    {t('switch')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section id="new" className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <InfoHint hint={t('add.hint', { max: MAX_OWNED })}>
          <h2 className="font-bold">{t('add.title')}</h2>
        </InfoHint>
        <p className="mt-1 text-sm text-muted-foreground">{t('add.description')}</p>
        {atLimit ? (
          <Banner tone="info" className="mt-3">
            {t('errors.tenant_limit', { max: MAX_OWNED })}
          </Banner>
        ) : (
          <form onSubmit={handleCreate} className="mt-4 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="companyName" className="text-sm font-medium">
                {t('add.nameLabel')}
              </label>
              <input
                id="companyName"
                required
                maxLength={200}
                aria-describedby="companyNameHint"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('add.namePlaceholder')}
                className={inputClass}
              />
              <p id="companyNameHint" className="text-xs text-muted-foreground">{t('add.nameHint')}</p>
            </div>
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                required
                checked={tos}
                onChange={(event) => setTos(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <span>
                {t.rich('add.tos', {
                  tos: (chunks) => (
                    <Link href="/legal/terms" target="_blank" className={linkClass}>
                      {chunks}
                    </Link>
                  ),
                  dpa: (chunks) => (
                    <Link href="/legal/dpa" target="_blank" className={linkClass}>
                      {chunks}
                    </Link>
                  )
                })}
              </span>
            </label>
            <button
              type="submit"
              disabled={pending || !tos || !name.trim()}
              className={buttonClass.primary}
            >
              <Plus className="h-4 w-4" />
              {pending ? t('add.creating') : t('add.submit')}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
