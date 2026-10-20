import { Lock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { fetchCanWrite, type PermissionArea } from '@/lib/tenant';

/**
 * A "you can only look here" card in place of a create or edit form the
 * member can't save (opened by URL or an old bookmark; the app no longer
 * links them there). Returns null when they may write. Usage:
 * `const gate = await writeGate('invoices', '/invoices'); if (gate) return gate;`
 */
export async function writeGate(area: PermissionArea, back: string): Promise<React.ReactElement | null> {
  if (await fetchCanWrite(area)) return null;
  const t = await getTranslations('app.readOnly');
  return (
    <div className="mx-auto mt-6 max-w-lg rounded-xl border border-border bg-card p-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Lock className="h-5 w-5" />
      </span>
      <h1 className="mt-4 text-lg font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('body')}</p>
      <Link href={back} className={cn(buttonClass.secondary, 'mt-5')}>
        {t('back')}
      </Link>
    </div>
  );
}
