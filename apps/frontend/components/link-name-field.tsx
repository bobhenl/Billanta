'use client';

import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { customSlugPreview, withLinkName } from '@/lib/public-link';
import { cn } from '@/lib/utils';

/**
 * "Vlastní název odkazu": the readable part in front of a customer link's
 * key (/i/web-redesign-k3Fq9Xa2Lm7P). Purely cosmetic, the key stays the
 * secret, so the preview only swaps what is in front of it. Shared by the
 * invoice detail and the client-portal card.
 */
export function LinkNameField({
  base,
  link,
  defaultLink,
  slug,
  onSave,
  className
}: {
  /** Everything before the segment, e.g. `https://…/i/`. */
  base: string;
  /** The current segment as the customer gets it. */
  link: string;
  /** The segment without a custom name (the Settings prefix). */
  defaultLink: string;
  slug: string | null;
  onSave: (slug: string | null) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  className?: string;
}) {
  const t = useTranslations('linkName');
  const [value, setValue] = useState(slug ?? '');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const name = customSlugPreview(value);
  const invalid = value.trim() !== '' && !name;
  const preview = withLinkName(link, name, defaultLink);
  const dirty = (name || null) !== (slug ?? null);

  const save = () =>
    startTransition(async () => {
      const result = await onSave(name || null);
      if (!result.ok) {
        toast({ text: result.error.includes('invalid_slug') ? t('invalid') : t('failed'), tone: 'err' });
        return;
      }
      setValue(name);
      toast({ text: name ? t('saved') : t('cleared'), tone: 'ok' });
      router.refresh();
    });

  return (
    <div className={cn('text-sm', className)}>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('label')}</span>
        <div className="flex gap-2">
          <input
            className={cn(inputClass, 'min-w-0 flex-1')}
            value={value}
            maxLength={80}
            placeholder={t('placeholder')}
            aria-invalid={invalid || undefined}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty && !invalid) {
                e.preventDefault();
                save();
              }
            }}
          />
          <button type="button" className={buttonClass.secondary} disabled={pending || !dirty || invalid} onClick={save}>
            <Check className="h-4 w-4" />
            {t('save')}
          </button>
        </div>
      </label>
      <p className={cn('mt-1 break-all font-mono text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}>
        {invalid ? t('invalid') : `${base}${preview}`}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t('hint')}</p>
    </div>
  );
}
