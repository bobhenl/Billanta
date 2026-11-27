import { SITE_URL } from '@/lib/site';

/**
 * Origin of the public API (server-only: reads runtime env). In production it
 * lives under the app's origin (Caddy routes /api/v1 to the backend); in dev
 * there is no Caddy, so it points straight at the backend.
 */
export function publicApiBase(): string {
  return (
    process.env.PUBLIC_API_URL ??
    (process.env.NODE_ENV === 'development' ? process.env.BACKEND_URL ?? 'http://localhost:3000' : SITE_URL)
  ).replace(/\/$/, '');
}
