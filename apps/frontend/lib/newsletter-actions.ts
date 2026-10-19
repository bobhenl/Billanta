'use server';

import { getLocale, getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { NewsletterCountry, NewsletterTopic } from '@/lib/newsletter';

export type MyNewsletter = {
  status: 'none' | 'pending' | 'confirmed' | 'unsubscribed';
  topics: NewsletterTopic[];
  country: NewsletterCountry;
};

export async function fetchMyNewsletter(): Promise<MyNewsletter | null> {
  try {
    return await apiFetch<MyNewsletter>('/api/v1/me/newsletter');
  } catch {
    return null;
  }
}

/**
 * Switch the newsletter on or off for the signed-in member, or change topics
 * and country. Turning it on sends the consent wording the settings card
 * shows, taken from our own messages here on the server.
 */
export async function saveMyNewsletter(patch: {
  subscribed: boolean;
  topics?: NewsletterTopic[];
  country?: NewsletterCountry;
}): Promise<{ ok: true; data: MyNewsletter } | { ok: false; error: string }> {
  try {
    const locale = await getLocale();
    const t = await getTranslations({ locale, namespace: 'newsletter.settings' });
    const data = await apiFetch<MyNewsletter>('/api/v1/me/newsletter', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, locale, ...(patch.subscribed ? { consentText: t('consent') } : {}) })
    });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
