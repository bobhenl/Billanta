import 'server-only';
import { getTranslations } from 'next-intl/server';
import { planRefusalIn } from './usage';

/** The translated "monthly documents used up" reason, or null when the refusal is something else. */
export async function documentsOutText(body: string): Promise<string | null> {
  const refusal = planRefusalIn(body);
  if (refusal?.feature !== 'documents') return null;
  const t = await getTranslations('planLimits');
  return t('documentsOut', { limit: refusal.limit ?? 10, plan: t(`plans.${refusal.plan}`) });
}
