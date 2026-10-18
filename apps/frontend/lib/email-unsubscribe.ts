const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** `base64url(claims).base64url(hmac)`; anything else never reaches the backend. */
export const UNSUBSCRIBE_TOKEN = /^[A-Za-z0-9_-]{20,300}\.[A-Za-z0-9_-]{20,100}$/;

export type UnsubscribePreview =
  | { ok: true; type: string; companyName: string | null; unsubscribed: boolean }
  | { ok: false; error: 'invalid' | 'unavailable' };

export function unsubscribeBackendUrl(token: string): string {
  return `${BACKEND_URL}/api/v1/public/email/unsubscribe/${encodeURIComponent(token)}`;
}

/** Read-only: what the link would switch off. Mail scanners open links, so GET never unsubscribes. */
export async function fetchUnsubscribePreview(token: string): Promise<UnsubscribePreview> {
  if (!UNSUBSCRIBE_TOKEN.test(token)) return { ok: false, error: 'invalid' };
  try {
    const res = await fetch(unsubscribeBackendUrl(token), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (res.status === 400 || res.status === 404) return { ok: false, error: 'invalid' };
    if (!res.ok) return { ok: false, error: 'unavailable' };
    const body = (await res.json()) as { type: string; companyName: string | null; unsubscribed: boolean };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
