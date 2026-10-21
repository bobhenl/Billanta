import { Controller, Get, NotFoundException, Req, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { sql } from "drizzle-orm";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { decryptSecret } from "../backup-destinations/encryption.util";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { CLASSROOM_GRACE_DAYS, classroomConfig } from "./classroom-config";
import { formatCode } from "./codes";

interface CompanyContext extends Record<string, unknown> {
  class_id: string;
  class_name: string;
  join_code: string;
  language: string;
  ends_at: Date | string;
  company: "home" | "team" | "second";
  label: string | null;
  owner_nickname: string | null;
  team_name: string | null;
  relation: "owner" | "accountant" | "teacher";
  mode: string | null;
  reentry_code_encrypted: string | null;
}

/**
 * Inside a practice company (tenant context): what the classroom banner
 * shows. A student sees their own re-entry code; in a team's or a client's
 * company they see whose it is and in what role they are there, and so
 * does a teacher looking in as a viewer. classroom_company_context reads
 * across the class's tables, which RLS keeps from the tenant connection.
 */
@ApiExcludeController()
@UseGuards(JwtAuthGuard)
@Controller("v1/classroom/student")
export class ClassroomStudentController {
  @Get()
  async get(@Req() req: TenantScopedRequest) {
    if (!req.user!.classroom) throw new NotFoundException();
    const rows = await req.tenantDb!.execute<CompanyContext>(
      sql`SELECT * FROM classroom_company_context(${req.user!.tenantId}, ${req.user!.id})`,
    );
    const [row] = rows as unknown as CompanyContext[];
    if (!row) throw new NotFoundException();
    const endsAt = new Date(row.ends_at);
    // A student here, as owner or accountant; the code is their own either way.
    const own = row.relation !== "teacher";
    return {
      // The teacher's "back to the class" link.
      classId: row.class_id,
      className: row.class_name,
      nickname: row.owner_nickname,
      company: row.company,
      label: row.label,
      team: row.team_name,
      relation: row.relation,
      mode: row.mode,
      own,
      joinUrl: `${classroomConfig().siteUrl}/${row.language}/join/${row.join_code}`,
      reentryCode: own && row.reentry_code_encrypted ? formatCode(decryptSecret(row.reentry_code_encrypted, classroomConfig().encryptionKey)) : null,
      endsAt: endsAt.toISOString(),
      deletesAt: new Date(endsAt.getTime() + CLASSROOM_GRACE_DAYS * 86_400_000).toISOString(),
      readOnly: req.user!.classroomReadOnly === true,
    };
  }
}
