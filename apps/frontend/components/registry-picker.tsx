'use client';

import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** Company registers the customer typeahead can ask (mirrors the backend's COMPANY_REGISTRIES). */
export const COMPANY_REGISTRIES = ['auto', 'CZ', 'SK', 'EU', 'DE', 'AT', 'IT', 'PL', 'FR', 'GB', 'NO', 'FI', 'DK', 'CH', 'US', 'WORLD'] as const;
export type CompanyRegistry = (typeof COMPANY_REGISTRIES)[number];

const STORAGE_KEY = 'billanta.registry';

/** The picked register, remembered per browser (falls back to "auto"). */
export function useCompanyRegistry(): [CompanyRegistry, (r: CompanyRegistry) => void] {
  const [registry, setRegistry] = useState<CompanyRegistry>('auto');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (COMPANY_REGISTRIES as readonly string[]).includes(saved)) setRegistry(saved as CompanyRegistry);
    } catch {
      // storage blocked — keep "auto"
    }
  }, []);
  const pick = (r: CompanyRegistry) => {
    setRegistry(r);
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {
      // not remembered, still works
    }
  };
  return [registry, pick];
}

/** Compact "which register" select shown next to a company search box. */
export function RegistryPicker({
  value,
  onChange,
  className
}: {
  value: CompanyRegistry;
  onChange: (r: CompanyRegistry) => void;
  className?: string;
}) {
  const t = useTranslations('registry');
  return (
    <label className={cn('relative inline-flex shrink-0 items-center', className)} title={t('label')}>
      <Globe className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <select
        aria-label={t('label')}
        value={value}
        onChange={(e) => onChange(e.target.value as CompanyRegistry)}
        className="h-10 rounded-lg border border-border bg-card pl-8 pr-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {COMPANY_REGISTRIES.map((r) => (
          <option key={r} value={r}>
            {t(`options.${r}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
