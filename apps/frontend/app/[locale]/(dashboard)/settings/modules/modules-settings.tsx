'use client';

import { useState, useTransition } from 'react';
import { Bot, Check, FileQuestion, Landmark, Loader2, Receipt, Download, Timer, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { BUSINESS_PRESETS, presetForModules, sameModules, TOGGLEABLE_MODULES, type ModuleSet, type ToggleableModule } from '@/lib/business-presets';
import { cn } from '@/lib/utils';
import { updateModules } from '../actions';

const ICONS: Record<ToggleableModule, LucideIcon> = {
  expenses: Receipt,
  bank: Landmark,
  quotes: FileQuestion,
  time: Timer,
  reports: Download,
  ai: Bot
};

export function ModulesSettings({ initial, readOnly }: { initial: ModuleSet; readOnly: boolean }) {
  const t = useTranslations('settings.modules');
  const router = useRouter();
  const [modules, setModules] = useState<ModuleSet>(initial);
  const [saved, setSaved] = useState<ModuleSet>(initial);
  const [pending, startTransition] = useTransition();
  const active = presetForModules(modules);
  const dirty = !sameModules(modules, saved);

  const save = () =>
    startTransition(async () => {
      const result = await updateModules(modules);
      if (!result.ok) {
        toast({ text: `${t('failed')}: ${result.error}`, tone: 'err' });
        return;
      }
      setSaved(modules);
      toast({ text: t('saved'), tone: 'ok' });
      router.refresh();
    });

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-bold">{t('presetsTitle')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('presetsHint')}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {BUSINESS_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={readOnly}
              aria-pressed={active === p.key}
              onClick={() => setModules(p.modules)}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed',
                active === p.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                  active === p.key ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                )}
              >
                {active === p.key && <Check className="h-3 w-3" />}
              </span>
              <span>
                <span className="block text-sm font-semibold">{t(`presets.${p.key}.title`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`presets.${p.key}.description`)}</span>
              </span>
            </button>
          ))}
        </div>
        {!active && <p className="mt-2 text-xs font-medium text-muted-foreground">{t('customMix')}</p>}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <h2 className="border-b border-border p-4 font-bold">{t('modulesTitle')}</h2>
        <ul className="divide-y divide-border">
          {TOGGLEABLE_MODULES.map((m) => {
            const Icon = ICONS[m];
            return (
              <li key={m}>
                <label className={cn('flex items-center gap-3 p-4', readOnly ? 'cursor-not-allowed' : 'cursor-pointer')}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t(`items.${m}.title`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`items.${m}.description`)}</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="h-5 w-5 accent-primary"
                    checked={modules[m]}
                    disabled={readOnly}
                    onChange={(e) => setModules({ ...modules, [m]: e.target.checked })}
                  />
                </label>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border p-4 text-xs text-muted-foreground">{t('dataKept')}</p>
      </section>

      {!readOnly && (
        <div className="flex justify-end gap-2">
          {dirty && (
            <button type="button" className={buttonClass.secondary} onClick={() => setModules(saved)} disabled={pending}>
              {t('reset')}
            </button>
          )}
          <button type="button" className={buttonClass.primary} onClick={save} disabled={pending || !dirty}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </button>
        </div>
      )}
    </div>
  );
}
