import { notFound } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/api-client';

/**
 * For staff pages that need no backend data of their own. The backend has
 * no "am I staff" endpoint, so this asks for the smallest list behind
 * PlatformAdminGuard. Anyone else gets a 404, as on the other admin pages.
 */
export async function requirePlatformAdmin(): Promise<void> {
  try {
    await apiFetch<unknown>('/api/v1/admin/partners');
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
