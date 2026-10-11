'use server';

import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';

import type { AppNotification, NotificationEvent, NotificationPrefs } from '@/lib/notifications';

export async function fetchNotifications(limit = 20): Promise<{ items: AppNotification[]; unread: number } | null> {
  try {
    const [items, count] = await Promise.all([
      apiFetch<AppNotification[]>(`/api/v1/me/notifications?limit=${limit}`),
      apiFetch<{ unread: number }>('/api/v1/me/notifications/unread-count')
    ]);
    return { items, unread: count.unread };
  } catch {
    return null;
  }
}

export async function fetchUnreadCount(): Promise<number | null> {
  try {
    return (await apiFetch<{ unread: number }>('/api/v1/me/notifications/unread-count')).unread;
  } catch {
    return null;
  }
}

export async function markNotificationsRead(id?: string): Promise<void> {
  try {
    await apiFetch(id ? `/api/v1/me/notifications/${id}/read` : '/api/v1/me/notifications/read', { method: 'POST' });
  } catch {
    // The bell just stays lit; nothing to tell the user.
  }
}

export async function fetchNotificationPrefs(): Promise<NotificationPrefs | null> {
  try {
    return await apiFetch<NotificationPrefs>('/api/v1/me/notifications/prefs');
  } catch {
    return null;
  }
}

export async function saveNotificationPrefs(patch: {
  events?: Partial<Record<NotificationEvent, { app?: boolean; email?: boolean }>>;
  browser_popups?: boolean;
}): Promise<{ ok: true; data: NotificationPrefs } | { ok: false; error: string }> {
  try {
    const data = await apiFetch<NotificationPrefs>('/api/v1/me/notifications/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
