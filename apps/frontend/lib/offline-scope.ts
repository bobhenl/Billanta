import { auth } from '@/auth';
import { fetchMyCompanies } from './api-client';

/**
 * Who the offline queue belongs to: `${userId}:${activeTenantId}`. The
 * dashboard layout hands it to the browser, and the sync actions check it
 * again, so a draft written for one account or company is never sent with
 * another one's session (see docs/offline-drafts-plan.md).
 */
export async function currentOfflineScope(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const companies = await fetchMyCompanies().catch(() => null);
  return companies ? `${session.user.id}:${companies.active.id}` : null;
}
