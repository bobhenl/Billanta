import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { EmailService } from "../email/email.service";
import { platformAdminEmails } from "../partners/platform-admin.guard";
import { CLASSROOM_TERMS_VERSION, classroomConfig } from "./classroom-config";
import { approvedMail, inviteMail, mailLanguage, staffApplicationMail } from "./classroom-mail";
import type { ApplyDto } from "./classroom.dto";
import { domainFromUrl, onSchoolDomain } from "./email-domain";
import { suggestedTrack } from "./tracks";

export type Teacher = typeof schema.classroomTeachers.$inferSelect;
export type School = typeof schema.classroomSchools.$inferSelect;

/** Applications per school (IČO) a week that wait for staff; more is somebody trying names. */
const PENDING_PER_SCHOOL_WEEKLY = 3;
const INVITES_PER_TEACHER_DAILY = 20;

/**
 * Teachers and their schools. Global tables (no tenant), so the pool; who
 * may see what is checked here. A teacher is approved straight away when
 * the address is proven and either on the verified school's domain or
 * invited by a colleague; everything else waits for Billanta staff.
 */
@Injectable()
export class ClassroomTeachersService {
  private readonly logger = new Logger(ClassroomTeachersService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly email: EmailService,
  ) {}

  async status(userId: string) {
    await this.realUser(userId);
    const found = await this.find(userId);
    if (!found) return { teacher: null, school: null };
    const { teacher, school } = found;
    return {
      teacher: { id: teacher.id, name: teacher.name, subject: teacher.subject, status: teacher.status },
      school: {
        id: school.id,
        name: school.name,
        country: school.country,
        level: school.level,
        suggestedTrack: suggestedTrack(school.level),
        suspended: school.suspendedAt !== null,
      },
    };
  }

  async apply(userId: string, dto: ApplyDto) {
    const user = await this.realUser(userId);
    const db = this.dbService.db;
    const existing = await this.find(userId);
    if (existing?.teacher.status === "approved") throw new ConflictException("classroom_already_teacher");
    if (existing?.teacher.status === "pending") throw new ConflictException("classroom_application_pending");

    await db
      .insert(schema.classroomSchools)
      .values({
        country: dto.country,
        ico: dto.ico,
        name: dto.schoolName,
        level: dto.level,
        legalForm: dto.legalForm || null,
        address: dto.address || null,
        webUrl: dto.webUrl || null,
      })
      .onConflictDoNothing();
    const [school] = await db
      .select()
      .from(schema.classroomSchools)
      .where(and(eq(schema.classroomSchools.country, dto.country), eq(schema.classroomSchools.ico, dto.ico)));

    const email = user.email.toLowerCase();
    const proven = user.verified || (await this.hasGoogle(userId));
    const [invite] = await db
      .select()
      .from(schema.classroomTeacherInvites)
      .where(and(eq(schema.classroomTeacherInvites.schoolId, school.id), sql`lower(${schema.classroomTeacherInvites.email}) = ${email}`));
    const open = school.suspendedAt === null && school.verification !== "rejected";
    const approved =
      proven && open && (Boolean(invite) || (school.verification === "verified" && onSchoolDomain(email, school.emailDomain)));

    if (!approved) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.classroomTeachers)
        .where(
          and(
            eq(schema.classroomTeachers.schoolId, school.id),
            eq(schema.classroomTeachers.status, "pending"),
            gt(schema.classroomTeachers.createdAt, sql`now() - interval '7 days'`),
          ),
        );
      if (n >= PENDING_PER_SCHOOL_WEEKLY) throw new HttpException("classroom_too_many_applications", HttpStatus.TOO_MANY_REQUESTS);
    }

    const fields = {
      schoolId: school.id,
      name: dto.name,
      subject: dto.subject || null,
      expectedStudents: dto.expectedStudents ?? null,
      status: approved ? ("approved" as const) : ("pending" as const),
      invitedBy: invite?.invitedBy ?? null,
      termsVersion: CLASSROOM_TERMS_VERSION,
      termsAcceptedAt: new Date(),
      decidedAt: approved ? new Date() : null,
    };
    // A rejected teacher may try again (another school, a better address).
    if (existing) await db.update(schema.classroomTeachers).set(fields).where(eq(schema.classroomTeachers.id, existing.teacher.id));
    else await db.insert(schema.classroomTeachers).values({ userId, ...fields });
    if (invite) await db.delete(schema.classroomTeacherInvites).where(eq(schema.classroomTeacherInvites.id, invite.id));

    if (!approved) await this.notifyStaff(dto.name, school);
    return this.status(userId);
  }

  /** An approved teacher vouches for a colleague; one who already applied is approved now. */
  async invite(userId: string, inviteeEmail: string) {
    const { teacher, school } = await this.approved(userId);
    if (school.suspendedAt) throw new ForbiddenException("classroom_school_suspended");
    const db = this.dbService.db;
    const email = inviteeEmail.toLowerCase();
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.classroomTeacherInvites)
      .where(and(eq(schema.classroomTeacherInvites.invitedBy, teacher.id), gt(schema.classroomTeacherInvites.createdAt, sql`now() - interval '1 day'`)));
    if (n >= INVITES_PER_TEACHER_DAILY) throw new HttpException("classroom_too_many_invites", HttpStatus.TOO_MANY_REQUESTS);

    const lang = mailLanguage(school.country);
    const [waiting] = await db
      .select({ id: schema.classroomTeachers.id, userId: schema.classroomTeachers.userId, verified: schema.users.emailVerified })
      .from(schema.classroomTeachers)
      .innerJoin(schema.users, eq(schema.users.id, schema.classroomTeachers.userId))
      .where(
        and(
          eq(schema.classroomTeachers.schoolId, school.id),
          eq(schema.classroomTeachers.status, "pending"),
          sql`lower(${schema.users.email}) = ${email}`,
        ),
      );
    if (waiting && (waiting.verified || (await this.hasGoogle(waiting.userId)))) {
      await db
        .update(schema.classroomTeachers)
        .set({ status: "approved", invitedBy: teacher.id, decidedAt: new Date() })
        .where(eq(schema.classroomTeachers.id, waiting.id));
      await this.send(email, approvedMail(lang, classroomConfig().siteUrl));
      return { approved: true };
    }

    const [row] = await db
      .insert(schema.classroomTeacherInvites)
      .values({ schoolId: school.id, email, invitedBy: teacher.id })
      .onConflictDoNothing()
      .returning({ id: schema.classroomTeacherInvites.id });
    if (row) await this.send(email, inviteMail(lang, classroomConfig().siteUrl, teacher.name, school.name));
    return { approved: false };
  }

  /** Approved teachers of the same school, for adding a co-teacher to a class. */
  async colleagues(userId: string) {
    const { teacher, school } = await this.approved(userId);
    return this.dbService.db
      .select({ id: schema.classroomTeachers.id, name: schema.classroomTeachers.name, subject: schema.classroomTeachers.subject })
      .from(schema.classroomTeachers)
      .where(
        and(
          eq(schema.classroomTeachers.schoolId, school.id),
          eq(schema.classroomTeachers.status, "approved"),
          ne(schema.classroomTeachers.id, teacher.id),
        ),
      )
      .orderBy(schema.classroomTeachers.name);
  }

  /** The caller as an approved teacher, or 403. */
  async approved(userId: string): Promise<{ teacher: Teacher; school: School }> {
    await this.realUser(userId);
    const found = await this.find(userId);
    if (!found || found.teacher.status !== "approved") throw new ForbiddenException("classroom_not_teacher");
    return found;
  }

  private async find(userId: string): Promise<{ teacher: Teacher; school: School } | null> {
    const [row] = await this.dbService.db
      .select({ teacher: schema.classroomTeachers, school: schema.classroomSchools })
      .from(schema.classroomTeachers)
      .innerJoin(schema.classroomSchools, eq(schema.classroomSchools.id, schema.classroomTeachers.schoolId))
      .where(eq(schema.classroomTeachers.userId, userId));
    return row ?? null;
  }

  /** A student's (or demo visitor's) token must not open the teacher side. */
  private async realUser(userId: string) {
    const [user] = await this.dbService.db
      .select({ email: schema.users.email, verified: schema.users.emailVerified, isDemo: schema.users.isDemo })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user || user.isDemo) throw new ForbiddenException("demo_disabled");
    return { email: user.email, verified: user.verified !== null };
  }

  private async hasGoogle(userId: string): Promise<boolean> {
    const [google] = await this.dbService.db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.provider, "google")));
    return Boolean(google);
  }

  private async notifyStaff(teacherName: string, school: School) {
    const mail = staffApplicationMail(classroomConfig().siteUrl, teacherName, school.name, school.ico);
    for (const to of platformAdminEmails()) await this.send(to, mail);
  }

  /** A lost e-mail must not fail the request; the state is in the database either way. */
  private async send(to: string, mail: { title: string; body: string }) {
    try {
      await this.email.sendPlatformEmail({ to, ...mail });
    } catch (err) {
      this.logger.error(`classroom e-mail failed: ${(err as Error).message}`);
    }
  }
}

/** For staff: the school's mail domain to trust, from what they confirmed or the school's web. */
export function schoolDomainOnApproval(confirmed: string | undefined, school: Pick<School, "emailDomain" | "webUrl">): string | null {
  const domain = confirmed?.trim().toLowerCase() || school.emailDomain || domainFromUrl(school.webUrl);
  return domain && domainFromUrl(domain) === domain ? domain : null;
}
