import { AlertTriangle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { SITE_NAME } from '@/lib/site';

/**
 * A demo company's invoice link can be opened by anyone it is pasted to, so
 * it says plainly that nothing on it is real: a notice above the invoice and
 * a faint stamp across it (the PDF carries the same stamp).
 */
export async function PublicDemoNotice({ watermark = false }: { watermark?: boolean }) {
  const t = await getTranslations('demo');
  if (watermark) {
    return (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex select-none items-center justify-center text-[96px] font-black tracking-widest text-destructive/10 sm:text-[140px]"
        style={{ transform: 'rotate(-30deg)' }}
      >
        {t('watermark')}
      </span>
    );
  }
  return (
    <div role="note" className="mb-6 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p>{t('publicNotice', { site: SITE_NAME })}</p>
    </div>
  );
}
