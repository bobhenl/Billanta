import { getLocale, getTranslations } from 'next-intl/server';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/**
 * "Type the code from the poster": a plain GET form to `/join?code=`, which
 * redirects to `/join/CODE`, so it works before any JavaScript loads.
 */
export async function JoinCodeForm({ defaultValue }: { defaultValue?: string }) {
  const [t, locale] = await Promise.all([getTranslations('join'), getLocale()]);
  return (
    <form action={`/${locale}/join`} method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
        {t('form.label')}
        <input
          name="code"
          required
          maxLength={32}
          defaultValue={defaultValue}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('form.placeholder')}
          className={cn(inputClass, 'font-mono uppercase')}
        />
      </label>
      <button type="submit" className={buttonClass.primary}>
        {t('form.submit')}
      </button>
    </form>
  );
}
