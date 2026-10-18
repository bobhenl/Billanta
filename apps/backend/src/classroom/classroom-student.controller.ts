import { Controller, Get, NotFoundException, Req, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { decryptSecret } from "../backup-destinations/encryption.util";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { CLASSROOM_GRACE_DAYS, classroomConfig } from "./classroom-config";
import { formatCode } from "./codes";

/**
 * Inside a practice company (tenant context): what the classroom banner
 * shows. The student sees their own re-entry code; a teacher looking in
 * as a viewer sees whose company it is.
 */
@ApiExcludeController()
@UseGuards(JwtAuthGuard)
@Controller("v1/classroom/student")
export class ClassroomStudentController {
  @Get()
  async get(@Req() req: TenantScopedRequest) {
    if (!req.user!.classroom) throw new NotFoundException();
    const [row] = await req
      .tenantDb!.select({
        nickname: schema.classroomStudents.nickname,
        kind: schema.classroomStudents.kind,
        userId: schema.classroomStudents.userId,
        code: schema.classroomStudents.reentryCodeEncrypted,
        className: schema.classroomClasses.name,
        joinCode: schema.classroomClasses.joinCode,
        language: schema.classroomClasses.language,
        endsAt: schema.classroomClasses.endsAt,
      })
      .from(schema.classroomStudents)
      .innerJoin(schema.classroomClasses, eq(schema.classroomClasses.id, schema.classroomStudents.classId))
      .where(eq(schema.classroomStudents.tenantId, req.user!.tenantId));
    if (!row) throw new NotFoundException();
    const own = row.userId === req.user!.id;
    return {
      className: row.className,
      nickname: row.nickname,
      kind: row.kind,
      own,
      joinUrl: `${classroomConfig().siteUrl}/${row.language}/join/${row.joinCode}`,
      reentryCode: own ? formatCode(decryptSecret(row.code, classroomConfig().encryptionKey)) : null,
      endsAt: row.endsAt.toISOString(),
      deletesAt: new Date(row.endsAt.getTime() + CLASSROOM_GRACE_DAYS * 86_400_000).toISOString(),
      readOnly: req.user!.classroomReadOnly === true,
    };
  }
}
