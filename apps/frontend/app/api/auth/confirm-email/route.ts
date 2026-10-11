/**
 * `GET /api/auth/confirm-email?token=…&locale=…` — second half of the
 * "change sign-in email" flow (`requestEmailChange` in
 * `app/[locale]/(dashboard)/settings/profile/actions.ts`). Looks the token up
 * by its SHA-256 hash among pending `email-change:<userId>:<newEmail>` rows,
 * re-checks that the new address is still free, swaps it in and marks it
 * verified (the user just proved they read that inbox). Single-use.
 */
import { createHash } from 'node:crypto';
import { and, eq, gt, like } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, verificationTokens } from '@/lib/auth-schema';

const PREFIX = 'email-change:';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const raw = url.searchParams.get('token') ?? '';
  const localeParam = url.searchParams.get('locale') ?? 'cs';
  const locale = ['cs', 'sk', 'en'].includes(localeParam) ? localeParam : 'cs';
  const done = (result: string) => NextResponse.redirect(new URL(`/${locale}/settings/profile?toast=${result}`, url));

  if (!raw) return done('emailChangeInvalid');
  const hashed = createHash('sha256').update(raw, 'utf8').digest('hex');
  const [row] = await db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.token, hashed), like(verificationTokens.identifier, `${PREFIX}%`), gt(verificationTokens.expires, new Date())))
    .limit(1);
  if (!row) return done('emailChangeInvalid');

  await db.delete(verificationTokens).where(eq(verificationTokens.token, hashed));
  const rest = row.identifier.slice(PREFIX.length);
  const sep = rest.indexOf(':');
  const userId = rest.slice(0, sep);
  const newEmail = rest.slice(sep + 1);

  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmail)).limit(1);
  if (taken) return done('emailChangeTaken');
  const updated = await db
    .update(users)
    .set({ email: newEmail, emailVerified: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return done(updated.length ? 'emailChanged' : 'emailChangeInvalid');
}
