import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export interface InvitationPreview {
  companyName: string;
  role: string;
  email: string;
  expired: boolean;
  accepted: boolean;
}

/** The stored form of an invitation token (same as `hashInvitationToken` in the backend's TeamService). */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * What an invitation link is for, read before anyone is signed in: the
 * invitee may not have an account yet. Goes through the same SECURITY
 * DEFINER function as the backend's preview, which shows only this one
 * invitation's company name, role and email. Null for an unknown token.
 */
export async function invitationPreview(token: string): Promise<InvitationPreview | null> {
  if (!token || token.length > 200) return null;
  const rows = await db.execute<{ company_name: string; role: string; email: string; expired: boolean; accepted: boolean }>(
    sql`SELECT * FROM get_tenant_invitation_preview(${hashInviteToken(token)})`
  );
  const row = rows[0];
  if (!row) return null;
  return { companyName: row.company_name, role: row.role, email: row.email, expired: row.expired, accepted: row.accepted };
}

/** A same-site path to return to after signing in; anything else (another host, `//x`) is dropped. */
export function safeNext(raw: string | string[] | undefined): string | null {
  const next = Array.isArray(raw) ? raw[0] : raw;
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next.slice(0, 500);
}
