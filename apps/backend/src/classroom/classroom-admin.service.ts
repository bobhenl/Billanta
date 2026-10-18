import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { EmailService } from "../email/email.service";
import { classroomConfig } from "./classroom-config";
import { approvedMail, mailLanguage, rejectedMail } from "./classroom-mail";
import type { DecisionDto } from "./classroom.dto";
import { schoolDomainOnApproval } from "./classroom-teachers.service";

/** Billanta staff: teacher applications and schools (`PLATFORM_ADMIN_EMAILS`). */
@Injectable()
export class ClassroomAdminService {
  private readonly logger = new Logger(ClassroomAdminService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly email: EmailService,
  ) {}

  async teachers() {
    return this.dbService.db
      .select({
        id: schema.classroomTeachers.id,
        name: schema.classroomTeachers.name,
        subject: schema.classroomTeachers.subject,
        expectedStudents: schema.classroomTeachers.expectedStudents,
        status: schema.classroomTeachers.status,
        invited: schema.classroomTeachers.invitedBy,
        createdAt: schema.classroomTeachers.createdAt,
        email: schema.users.email,
        emailVerified: schema.users.emailVerified,
        school: schema.classroomSchools,
      })
      .from(schema.classroomTeachers)
      .innerJoin(schema.users, eq(schema.users.id, schema.classroomTeachers.userId))
      .innerJoin(schema.classroomSchools, eq(schema.classroomSchools.id, schema.classroomTeachers.schoolId))
      .orderBy(desc(schema.classroomTeachers.createdAt))
      .limit(500);
  }

  /** Approving a teacher verifies the school too, so colleagues on its domain get in without waiting. */
  async decide(teacherId: string, dto: DecisionDto) {
    const db = this.dbService.db;
    const [row] = await db
      .select({ teacher: schema.classroomTeachers, school: schema.classroomSchools, email: schema.users.email })
      .from(schema.classroomTeachers)
      .innerJoin(schema.users, eq(schema.users.id, schema.classroomTeachers.userId))
      .innerJoin(schema.classroomSchools, eq(schema.classroomSchools.id, schema.classroomTeachers.schoolId))
      .where(eq(schema.classroomTeachers.id, teacherId));
    if (!row) throw new NotFoundException();
    const lang = mailLanguage(row.school.country);
    const now = new Date();

    if (dto.decision === "approve") {
      await db.update(schema.classroomTeachers).set({ status: "approved", decidedAt: now }).where(eq(schema.classroomTeachers.id, teacherId));
      await db
        .update(schema.classroomSchools)
        .set({
          verification: "verified",
          verifiedAt: row.school.verifiedAt ?? now,
          emailDomain: schoolDomainOnApproval(dto.emailDomain, row.school),
          reviewNote: dto.note || row.school.reviewNote,
        })
        .where(eq(schema.classroomSchools.id, row.school.id));
      await this.send(row.email, approvedMail(lang, classroomConfig().siteUrl));
    } else {
      await db.update(schema.classroomTeachers).set({ status: "rejected", decidedAt: now }).where(eq(schema.classroomTeachers.id, teacherId));
      await this.send(row.email, rejectedMail(lang, dto.note));
    }
    return { ok: true };
  }

  /** Closes (or reopens) every class of a school; classroom_join refuses a suspended school. */
  async suspend(schoolId: string, suspended: boolean, note?: string) {
    const db = this.dbService.db;
    const [school] = await db
      .update(schema.classroomSchools)
      .set({ suspendedAt: suspended ? new Date() : null, ...(note ? { reviewNote: note } : {}) })
      .where(eq(schema.classroomSchools.id, schoolId))
      .returning({ id: schema.classroomSchools.id });
    if (!school) throw new NotFoundException();
    if (suspended) await db.update(schema.classroomClasses).set({ enrolmentOpen: false }).where(eq(schema.classroomClasses.schoolId, schoolId));
    return { ok: true };
  }

  private async send(to: string, mail: { title: string; body: string }) {
    try {
      await this.email.sendPlatformEmail({ to, ...mail });
    } catch (err) {
      this.logger.error(`classroom e-mail failed: ${(err as Error).message}`);
    }
  }
}
