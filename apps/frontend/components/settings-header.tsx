import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/** Back-to-settings link, page title and one-line description of a settings sub-page. */
export async function SettingsHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  const t = await getTranslations('settings');
  return (
    <div>
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        {t('backToSettings')}
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
