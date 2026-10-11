'use server';

import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { NotificationEvent } from '@/lib/notifications';

export type WebhookKind = 'discord' | 'slack' | 'json';

export interface Webhook {
  id: string;
  name: string;
  url: string;
  kind: WebhookKind;
  events: NotificationEvent[];
  enabled: boolean;
  secret?: string;
}

export interface IntegrationsState {
  feedToken: string | null;
  canManageWebhooks: boolean;
  webhooks: Webhook[];
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

export async function fetchIntegrations(): Promise<IntegrationsState | null> {
  try {
    return await apiFetch<IntegrationsState>('/api/v1/integrations');
  } catch {
    return null;
  }
}

/** New secret feed address (`on`) or switch the feeds off. */
export async function setFeed(on: boolean): Promise<Result<{ feedToken: string | null }>> {
  return run(() => apiFetch<{ feedToken: string | null }>('/api/v1/integrations/feed', { method: on ? 'POST' : 'DELETE' }));
}

export async function saveWebhooks(
  webhooks: Array<Omit<Webhook, 'id' | 'secret' | 'kind'> & { id?: string; kind?: WebhookKind }>
): Promise<Result<{ webhooks: Webhook[] }>> {
  return run(() =>
    apiFetch<{ webhooks: Webhook[] }>('/api/v1/integrations/webhooks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhooks })
    })
  );
}

export async function testWebhook(id: string): Promise<Result<{ ok: boolean; status: number }>> {
  return run(() => apiFetch<{ ok: boolean; status: number }>(`/api/v1/integrations/webhooks/${id}/test`, { method: 'POST' }));
}
