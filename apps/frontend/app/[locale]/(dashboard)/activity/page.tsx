import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuditLogList, type AuditMember } from '@/components/audit-log-list';
import { Banner } from '@/components/banner';
import { apiFetch } from '@/lib/api-client';
import { fetchAuditLog } from '@/lib/audit';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audit');
  return { title: t('title') };
}

/** Historie změn: everything important that happened in the company, visible to every member. */
export default async function ActivityPage() {
  const t = await getTranslations('audit');
  const [initial, team] = await Promise.all([
    fetchAuditLog(),
    apiFetch<{ members: AuditMember[] }>('/api/v1/team').catch(() => ({ members: [] as AuditMember[] }))
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      <div className="mt-6">
        {initial ? <AuditLogList initial={initial} showFilters members={team.members} /> : <Banner tone="err" title={t('loadError')} />}
      </div>
    </div>
  );
}
