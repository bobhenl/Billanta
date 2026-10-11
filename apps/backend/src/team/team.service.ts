import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { EmailService } from "../email/email.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";
import type { CreateInvitationDto } from "./dto/create-invitation.dto";

type Db = PostgresJsDatabase<typeof schema>;

const INVITATION_TTL_DAYS = 7;

export const ROLE_LABEL_CS: Record<string, string> = {
  owner: "Vlastník",
  admin: "Administrátor",
  accountant: "Účetní",
  viewer: "Pouze čtení",
};

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function requireManager(user: AuthenticatedUser) {
  if (user.role !== "owner" && user.role !== "admin") {
    throw new ForbiddenException("Only the owner or an admin can manage the team");
  }
}

type PreviewRow = { company_name: string; role: string; email: string; expired: boolean; accepted: boolean };

/**
 * Tenant team: who has access, pending invitations, and the pre-tenant
 * invitation preview/accept pair (those two go through the SECURITY DEFINER
 * functions in rls-policies.sql, since the invitee has no membership yet).
 */
@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly emailService: EmailService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async list(db: Db) {
    const members = await db
      .select({
        id: schema.tenantMemberships.id,
        userId: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        image: schema.users.image,
        role: schema.tenantMemberships.role,
        permissions: schema.tenantMemberships.permissions,
        createdAt: schema.tenantMemberships.createdAt,
      })
      .from(schema.tenantMemberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
      .orderBy(schema.tenantMemberships.createdAt);

    const invitations = await db
      .select({
        id: schema.tenantInvitations.id,
        email: schema.tenantInvitations.email,
        role: schema.tenantInvitations.role,
        permissions: schema.tenantInvitations.permissions,
        expiresAt: schema.tenantInvitations.expiresAt,
        createdAt: schema.tenantInvitations.createdAt,
      })
      .from(schema.tenantInvitations)
      .where(isNull(schema.tenantInvitations.acceptedAt))
      .orderBy(desc(schema.tenantInvitations.createdAt));

    const now = Date.now();
    return {
      members,
      invitations: invitations.map((i) => ({ ...i, expired: i.expiresAt.getTime() < now })),
    };
  }

  async invite(db: Db, user: AuthenticatedUser, dto: CreateInvitationDto) {
    requireManager(user);

    const [existingMember] = await db
      .select({ id: schema.tenantMemberships.id })
      .from(schema.tenantMemberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
      .where(sql`lower(${schema.users.email}) = ${dto.email}`)
      .limit(1);
    if (existingMember) throw new ConflictException("This person is already a member");

    // A fresh invite to the same address replaces any pending one.
    await db
      .delete(schema.tenantInvitations)
      .where(and(eq(schema.tenantInvitations.email, dto.email), isNull(schema.tenantInvitations.acceptedAt)));

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [invitation] = await db
      .insert(schema.tenantInvitations)
      .values({
        tenantId: user.tenantId,
        email: dto.email,
        role: dto.role,
        permissions: dto.role === "admin" ? null : dto.permissions ?? null,
        tokenHash: hashInvitationToken(token),
        invitedByUserId: user.id,
        expiresAt,
      })
      .returning();
    await this.audit?.record(db, user.tenantId, {
      entityType: "member",
      entityLabel: dto.email,
      action: "invited",
      changes: [{ field: "role", from: null, to: dto.role }],
    });

    const [tenant] = await db
      .select({ companyName: schema.tenants.companyName })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, user.tenantId));

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
    const acceptUrl = `${siteUrl}/invite/${token}`;

    let emailSent = true;
    try {
      await this.emailService.sendInvitationEmail({
        to: dto.email,
        companyName: tenant?.companyName ?? "",
        role: ROLE_LABEL_CS[dto.role] ?? dto.role,
        acceptUrl,
      });
    } catch (err) {
      emailSent = false;
      this.logger.warn(`Invitation email to ${dto.email} failed: ${(err as Error).message}`);
    }

    // The link is returned so the inviter can pass it on manually (and so
    // local dev without a mail provider still works).
    return { id: invitation!.id, email: invitation!.email, role: invitation!.role, expiresAt, acceptUrl, emailSent };
  }

  async revokeInvitation(db: Db, user: AuthenticatedUser, id: string) {
    requireManager(user);
    const deleted = await db
      .delete(schema.tenantInvitations)
      .where(and(eq(schema.tenantInvitations.id, id), isNull(schema.tenantInvitations.acceptedAt)))
      .returning({ id: schema.tenantInvitations.id, email: schema.tenantInvitations.email });
    if (deleted.length === 0) throw new NotFoundException("Invitation not found");
    await this.audit?.record(db, user.tenantId, { entityType: "member", entityLabel: deleted[0].email, action: "invitation_revoked" });
    return { ok: true };
  }

  async updateMember(
    db: Db,
    user: AuthenticatedUser,
    membershipId: string,
    role: "admin" | "accountant" | "viewer",
    permissions?: Record<string, string> | null,
  ) {
    requireManager(user);
    const member = await this.requireMember(db, membershipId);
    if (member.role === "owner") throw new BadRequestException("The owner's role cannot be changed");
    await db
      .update(schema.tenantMemberships)
      .set({ role, permissions: role === "admin" ? null : permissions ?? null })
      .where(eq(schema.tenantMemberships.id, membershipId));
    const changes = [
      ...(member.role !== role ? [{ field: "role", from: member.role, to: role }] : []),
      ...(JSON.stringify(member.permissions ?? null) !== JSON.stringify(role === "admin" ? null : permissions ?? null)
        ? [{ field: "permissions", from: null, to: null }]
        : []),
    ];
    if (changes.length > 0) {
      await this.audit?.record(db, user.tenantId, {
        entityType: "member",
        entityId: member.userId,
        entityLabel: await this.memberEmail(db, member.userId),
        action: "updated",
        changes,
      });
    }
    return { ok: true };
  }

  async removeMember(db: Db, user: AuthenticatedUser, membershipId: string) {
    const member = await this.requireMember(db, membershipId);
    // Anyone may leave; removing someone else needs owner/admin.
    if (member.userId !== user.id) requireManager(user);
    if (member.role === "owner") throw new BadRequestException("The owner cannot be removed");
    const label = await this.memberEmail(db, member.userId);
    await db.delete(schema.tenantMemberships).where(eq(schema.tenantMemberships.id, membershipId));
    await this.audit?.record(db, user.tenantId, {
      entityType: "member",
      entityId: member.userId,
      entityLabel: label,
      action: member.userId === user.id ? "left" : "removed",
    });
    return { ok: true };
  }

  private async memberEmail(db: Db, userId: string) {
    const [row] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return row?.email ?? null;
  }

  private async requireMember(db: Db, membershipId: string) {
    const [member] = await db
      .select()
      .from(schema.tenantMemberships)
      .where(eq(schema.tenantMemberships.id, membershipId));
    if (!member) throw new NotFoundException("Member not found");
    return member;
  }

  async preview(token: string) {
    const rows = await this.dbService.db.execute<PreviewRow>(
      sql`SELECT * FROM get_tenant_invitation_preview(${hashInvitationToken(token)})`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundException("Invitation not found");
    return {
      companyName: row.company_name,
      role: row.role,
      email: row.email,
      expired: row.expired,
      accepted: row.accepted,
    };
  }

  async accept(token: string, userId: string) {
    const rows = await this.dbService.db.execute<{ tenant_id: string | null }>(
      sql`SELECT accept_tenant_invitation(${hashInvitationToken(token)}, ${userId}) AS tenant_id`,
    );
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) {
      throw new BadRequestException(
        "The invitation is invalid, expired, already used, or addressed to a different email",
      );
    }
    const [user] = await this.dbService.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    this.notifications?.notify(tenantId, "member_joined", {
      title: "Do firmy se přidal nový člen",
      body: user?.email ?? null,
      link: "/settings/team",
    });
    return { tenantId };
  }
}
