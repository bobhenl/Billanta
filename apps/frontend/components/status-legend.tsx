import { getTranslations } from 'next-intl/server';
import { InfoHint } from '@/components/info-hint';
import { CONTACT_COLOR_DOT } from '@/lib/contact-colors';
import { DOCUMENT_TYPES, INVOICE_STATUSES, STATUS_BADGE_CLASSES, TYPE_BADGE_CLASSES } from '@/lib/invoice-ui';
import { cn } from '@/lib/utils';

/**
 * "What do the coloured labels mean": every status and document-type badge
 * with a one-line explanation, behind an (i) so it costs one line. The same
 * texts are the badges' `title` tooltips (`glossary.*`).
 */
export async function StatusLegend({ className }: { className?: string }) {
  const t = await getTranslations('glossary');
  const tStatus = await getTranslations('invoices.status');
  const tDoc = await getTranslations('doc');
  const statuses = [...INVOICE_STATUSES.slice(0, 3), 'overdue' as const, ...INVOICE_STATUSES.slice(3)];
  const badge = 'inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold';

  return (
    <InfoHint
      className={className}
      bodyClassName="block"
      hint={
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="font-semibold text-foreground">{t('statusTitle')}</p>
            <dl className="mt-2 space-y-2">
              {statuses.map((s) => (
                <div key={s} className="flex items-start gap-2">
                  <dt className={cn(badge, STATUS_BADGE_CLASSES[s])}>{s === 'overdue' ? tDoc('overdue') : tStatus(s)}</dt>
                  <dd>{t(`status.${s}`)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <p className="font-semibold text-foreground">{t('typeTitle')}</p>
            <dl className="mt-2 space-y-2">
              {DOCUMENT_TYPES.map((d) => (
                <div key={d} className="flex items-start gap-2">
                  <dt className={cn(badge, TYPE_BADGE_CLASSES[d])}>{tDoc(`type.${d}`)}</dt>
                  <dd>{t(`type.${d}`)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4">
              <span className="mr-1.5 inline-flex gap-0.5 align-middle" aria-hidden="true">
                {(['red', 'amber', 'green', 'sky'] as const).map((c) => (
                  <span key={c} className={cn('h-2.5 w-2.5 rounded-full', CONTACT_COLOR_DOT[c])} />
                ))}
              </span>
              {t('contactColorPlain')}
            </p>
          </div>
        </div>
      }
    >
      <span className="text-sm text-muted-foreground">{t('legendLabel')}</span>
    </InfoHint>
  );
}
