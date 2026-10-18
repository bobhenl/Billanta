import type { JoinInfo } from './promo';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * The join page's view of a code, or null when it can't be redeemed (or the
 * backend is down, so the page shows the "type the code" form instead of an error).
 */
export async function lookupJoinCode(code: string, ip: string): Promise<JoinInfo | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/promo-codes/${encodeURIComponent(code)}`, {
      headers: ip ? { 'x-guest-ip': ip } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(4000)
    });
    return res.ok ? ((await res.json()) as JoinInfo) : null;
  } catch {
    return null;
  }
}
