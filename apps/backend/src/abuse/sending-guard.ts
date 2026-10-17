import { ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
import { and, count, eq, gt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Daily caps on e-mails a company sends to its customers (invoices and
 * reminders), the main lever against using the service to mass-mail fake
 * invoices. A brand-new account gets a low cap until it has some history;
 * paid plans get a high one. Overridable per deployment via env.
 */
export const SENDING_CAPS = {
  newAccount: envInt("EMAIL_CAP_NEW_ACCOUNT", 20),
  trial: envInt("EMAIL_CAP_TRIAL", 100),
  paid: envInt("EMAIL_CAP_PAID", 1000),
  newAccountDays: envInt("EMAIL_CAP_NEW_ACCOUNT_DAYS", 7),
};

/** Distinct recipients reporting a company within 7 days before its sending is paused. */
export const ABUSE_PAUSE_THRESHOLD = envInt("ABUSE_PAUSE_THRESHOLD", 3);

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface SendingTenant {
  createdAt: Date;
  subscriptionStatus: string;
  suspendedAt: Date | null;
  emailPausedAt: Date | null;
}

/** The cap that applies to a tenant right now (pure, unit-tested). */
export function dailyCapFor(tenant: Pick<SendingTenant, "createdAt" | "subscriptionStatus">, now = new Date()): number {
  const ageDays = (now.getTime() - tenant.createdAt.getTime()) / 86_400_000;
  if (ageDays < SENDING_CAPS.newAccountDays) return SENDING_CAPS.newAccount;
  return tenant.subscriptionStatus === "active" ? SENDING_CAPS.paid : SENDING_CAPS.trial;
}

/**
 * Why a tenant may not send right now, or null. Codes are stable strings the
 * frontend maps to a translated message.
 */
export function sendingBlock(tenant: SendingTenant, sentLast24h: number, now = new Date()): string | null {
  if (tenant.suspendedAt) return "ACCOUNT_SUSPENDED";
  if (tenant.emailPausedAt) return "EMAIL_PAUSED";
  if (sentLast24h >= dailyCapFor(tenant, now)) return "EMAIL_DAILY_LIMIT";
  return null;
}

/** Throws 403/429 when the tenant behind `db` may not e-mail a customer now. */
export async function assertCanSendEmail(db: Db, tenantId: string): Promise<void> {
  const [tenant] = await db
    .select({
      createdAt: schema.tenants.createdAt,
      subscriptionStatus: schema.tenants.subscriptionStatus,
      suspendedAt: schema.tenants.suspendedAt,
      emailPausedAt: schema.tenants.emailPausedAt,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  if (!tenant) return;
  const since = new Date(Date.now() - 86_400_000);
  const [{ sent }] = await db
    .select({ sent: count() })
    .from(schema.outboundEmails)
    .where(and(eq(schema.outboundEmails.tenantId, tenantId), gt(schema.outboundEmails.createdAt, since)));
  const block = sendingBlock(tenant, Number(sent));
  if (!block) return;
  if (block === "EMAIL_DAILY_LIMIT") {
    throw new HttpException({ statusCode: 429, code: block, message: `Daily e-mail limit (${dailyCapFor(tenant)}) reached` }, HttpStatus.TOO_MANY_REQUESTS);
  }
  throw new ForbiddenException({ statusCode: 403, code: block, message: block === "ACCOUNT_SUSPENDED" ? "Account suspended" : "E-mail sending paused" });
}

/** Counts one e-mail sent to an outside address towards the daily cap. */
export async function recordEmailSent(db: Db, tenantId: string, kind: "invoice" | "reminder" | "invitation" | "buyer_details", recipient: string): Promise<void> {
  await db.insert(schema.outboundEmails).values({ tenantId, kind, recipient: recipient.slice(0, 320) });
}
