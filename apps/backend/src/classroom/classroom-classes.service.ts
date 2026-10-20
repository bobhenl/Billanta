import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { decryptSecret, encryptSecret } from "../backup-destinations/encryption.util";
import { DbService } from "../db/db.service";
import { CLASSROOM_GRACE_DAYS, classroomConfig } from "./classroom-config";
import type { CreateClassDto, ExtendClassDto, UpdateClassDto } from "./classroom.dto";
import { ClassroomTeachersService, type Teacher } from "./classroom-teachers.service";
import { formatCode, generateCode, hashCode } from "./codes";
import { MILESTONES, MILESTONE_SQL, toMilestoneCounts, type MilestoneCounts } from "./milestones";
import { defaultClassEnd, nextSchoolYearEnd, validClassEnd } from "./school-year";
import { classKinds, classModules } from "./tracks";

type ClassRow = typeof schema.classroomClasses.$inferSelect;

const GRACE_MS = CLASSROOM_GRACE_DAYS * 86_400_000;

/**
 * A teacher's classes. The class rows are global (pool); a student's
 * progress is read inside that student's company, through RLS, as the
 * teacher who is a viewer there.
 */
@Injectable()
export class ClassroomClassesService {
  constructor(
    private readonly dbService: DbService,
    private readonly teachers: ClassroomTeachersService,
  ) {}

  async list(userId: string) {
    const { teacher } = await this.teachers.approved(userId);
    const db = this.dbService.db;
    const classes = await db
      .select()
      .from(schema.classroomClasses)
      .where(or(eq(schema.classroomClasses.ownerTeacherId, teacher.id), inArray(schema.classroomClasses.id, this.coTaught(teacher.id))))
      .orderBy(asc(schema.classroomClasses.name));
    const counts = classes.length
      ? await db
          .select({ classId: schema.classroomStudents.classId, n: sql<number>`count(*)::int` })
          .from(schema.classroomStudents)
          .where(
            inArray(
              schema.classroomStudents.classId,
              classes.map((c) => c.id),
            ),
          )
          .groupBy(schema.classroomStudents.classId)
      : [];
    const byClass = new Map(counts.map((c) => [c.classId, c.n]));
    return classes.map((c) => ({ ...this.summary(c, teacher), students: byClass.get(c.id) ?? 0 }));
  }

  async create(userId: string, dto: CreateClassDto) {
    const { teacher, school } = await this.teachers.approved(userId);
    if (school.suspendedAt) throw new ForbiddenException("classroom_school_suspended");
    const cfg = classroomConfig();
    const db = this.dbService.db;
    const now = new Date();
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.classroomClasses)
      .where(
        and(
          eq(schema.classroomClasses.ownerTeacherId, teacher.id),
          gt(schema.classroomClasses.endsAt, new Date(now.getTime() - GRACE_MS)),
        ),
      );
    if (n >= cfg.maxActiveClassesPerTeacher) throw new ConflictException("classroom_class_limit");
    const endsAt = dto.endsAt ?? defaultClassEnd(now);
    if (!validClassEnd(endsAt, now)) throw new BadRequestException("classroom_invalid_end");

    const values = {
      schoolId: school.id,
      ownerTeacherId: teacher.id,
      name: dto.name,
      track: dto.track,
      language: dto.language,
      kinds: classKinds(dto.track, school.country, dto.kinds),
      seeded: dto.seeded ?? true,
      modules: classModules(dto.track, dto.modules),
      maxStudents: cfg.maxStudentsPerClass,
      endsAt,
    };
    const created = await this.withFreshJoinCode((joinCode) => db.insert(schema.classroomClasses).values({ ...values, joinCode }).returning());
    return this.summary(created[0], teacher);
  }

  /** The class with every student: re-entry code, company type and what they have done so far. */
  async get(userId: string, classId: string) {
    const { teacher, school } = await this.teachers.approved(userId);
    const cls = await this.access(teacher, classId);
    const db = this.dbService.db;
    const students = await db
      .select()
      .from(schema.classroomStudents)
      .where(eq(schema.classroomStudents.classId, classId))
      .orderBy(asc(schema.classroomStudents.nickname));
    const key = classroomConfig().encryptionKey;
    const progress = await this.progress(userId, students);
    const coTeachers = await db
      .select({ id: schema.classroomTeachers.id, name: schema.classroomTeachers.name })
      .from(schema.classroomClassTeachers)
      .innerJoin(schema.classroomTeachers, eq(schema.classroomTeachers.id, schema.classroomClassTeachers.teacherId))
      .where(eq(schema.classroomClassTeachers.classId, classId));
    const [owner] = await db
      .select({ id: schema.classroomTeachers.id, name: schema.classroomTeachers.name })
      .from(schema.classroomTeachers)
      .where(eq(schema.classroomTeachers.id, cls.ownerTeacherId));
    return {
      ...this.summary(cls, teacher),
      school: { name: school.name, country: school.country },
      owner,
      coTeachers,
      milestones: MILESTONES,
      students: students.map((s) => ({
        id: s.id,
        nickname: s.nickname,
        kind: s.kind,
        tenantId: s.tenantId,
        joinedAt: s.createdAt.toISOString(),
        code: formatCode(decryptSecret(s.reentryCodeEncrypted, key)),
        progress: progress.get(s.id)!,
      })),
    };
  }

  /** The progress table as CSV, for the teacher to keep after the class is deleted. */
  async progressCsv(userId: string, classId: string): Promise<{ name: string; csv: string }> {
    const view = await this.get(userId, classId);
    const header = ["nickname", "company", "joined", ...MILESTONES];
    const rows = view.students.map((s) => [s.nickname, s.kind, s.joinedAt.slice(0, 10), ...MILESTONES.map((m) => String(s.progress[m]))]);
    return { name: view.name, csv: toCsv([header, ...rows]) };
  }

  async update(userId: string, classId: string, dto: UpdateClassDto) {
    const { teacher, school } = await this.teachers.approved(userId);
    const cls = await this.access(teacher, classId);
    if (dto.enrolmentOpen && school.suspendedAt) throw new ForbiddenException("classroom_school_suspended");
    const [row] = await this.dbService.db
      .update(schema.classroomClasses)
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.enrolmentOpen !== undefined ? { enrolmentOpen: dto.enrolmentOpen } : {}),
        // Only for new students; a company keeps the type it was created as.
        ...(dto.kinds !== undefined ? { kinds: classKinds(cls.track, school.country, dto.kinds) } : {}),
      })
      .where(eq(schema.classroomClasses.id, classId))
      .returning();
    return this.summary(row, teacher);
  }

  /** A new class code, when the old one got out of the classroom. */
  async rotateJoinCode(userId: string, classId: string) {
    const { teacher } = await this.teachers.approved(userId);
    await this.access(teacher, classId);
    const [row] = await this.withFreshJoinCode((joinCode) =>
      this.dbService.db.update(schema.classroomClasses).set({ joinCode }).where(eq(schema.classroomClasses.id, classId)).returning(),
    );
    return this.summary(row, teacher);
  }

  /** Another school year, or the date the teacher picked; the companies' deletion moves with it. */
  async extend(userId: string, classId: string, dto: ExtendClassDto) {
    const { teacher } = await this.teachers.approved(userId);
    const cls = await this.access(teacher, classId);
    const now = new Date();
    const endsAt = dto.endsAt ?? nextSchoolYearEnd(cls.endsAt, now);
    if (!validClassEnd(endsAt, now)) throw new BadRequestException("classroom_invalid_end");
    await this.dbService.sql`SELECT classroom_extend(${classId}, ${endsAt})`;
    return this.summary({ ...cls, endsAt, remindedDays: null }, teacher);
  }

  async addCoTeacher(userId: string, classId: string, colleagueId: string) {
    const { teacher } = await this.teachers.approved(userId);
    const cls = await this.ownClass(teacher, classId);
    if (colleagueId === teacher.id) throw new BadRequestException("classroom_invalid_teacher");
    const [colleague] = await this.dbService.db
      .select({ id: schema.classroomTeachers.id })
      .from(schema.classroomTeachers)
      .where(
        and(
          eq(schema.classroomTeachers.id, colleagueId),
          eq(schema.classroomTeachers.schoolId, cls.schoolId),
          eq(schema.classroomTeachers.status, "approved"),
        ),
      );
    if (!colleague) throw new BadRequestException("classroom_invalid_teacher");
    await this.dbService.sql`SELECT classroom_add_teacher(${classId}, ${colleagueId})`;
    return { ok: true };
  }

  async removeCoTeacher(userId: string, classId: string, colleagueId: string) {
    const { teacher } = await this.teachers.approved(userId);
    await this.ownClass(teacher, classId);
    await this.dbService.sql`SELECT classroom_remove_teacher(${classId}, ${colleagueId})`;
    return { ok: true };
  }

  /** A forgotten code: the old one stops working and signs the student out everywhere. */
  async regenerateStudentCode(userId: string, classId: string, studentId: string) {
    const { teacher } = await this.teachers.approved(userId);
    await this.access(teacher, classId);
    const cfg = classroomConfig();
    const student = await this.student(classId, studentId);
    const code = generateCode();
    await this.dbService.sql.begin(async (tx) => {
      await tx`
        UPDATE classroom_students
        SET reentry_code_hash = ${hashCode(code, cfg.codeSecret)}, reentry_code_encrypted = ${encryptSecret(code, cfg.encryptionKey)}
        WHERE id = ${student.id}`;
      await tx`DELETE FROM sessions WHERE user_id = ${student.userId}`;
    });
    return { code: formatCode(code) };
  }

  async removeStudent(userId: string, classId: string, studentId: string) {
    const { teacher } = await this.teachers.approved(userId);
    await this.access(teacher, classId);
    const student = await this.student(classId, studentId);
    await this.dbService.sql`SELECT classroom_remove_student(${student.id})`;
    return { ok: true };
  }

  async remove(userId: string, classId: string) {
    const { teacher } = await this.teachers.approved(userId);
    await this.ownClass(teacher, classId);
    await this.dbService.sql`SELECT classroom_delete_class(${classId})`;
    return { ok: true };
  }

  private summary(c: ClassRow, teacher: Teacher) {
    const now = Date.now();
    return {
      id: c.id,
      name: c.name,
      track: c.track,
      language: c.language,
      kinds: c.kinds,
      modules: c.modules,
      seeded: c.seeded,
      joinCode: formatCode(c.joinCode),
      joinUrl: `${classroomConfig().siteUrl}/${c.language}/join/${c.joinCode}`,
      enrolmentOpen: c.enrolmentOpen,
      maxStudents: c.maxStudents,
      endsAt: c.endsAt.toISOString(),
      deletesAt: new Date(c.endsAt.getTime() + GRACE_MS).toISOString(),
      ended: c.endsAt.getTime() <= now,
      isOwner: c.ownerTeacherId === teacher.id,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private coTaught(teacherId: string) {
    return this.dbService.db
      .select({ id: schema.classroomClassTeachers.classId })
      .from(schema.classroomClassTeachers)
      .where(eq(schema.classroomClassTeachers.teacherId, teacherId));
  }

  /** The class if the teacher teaches it; 404 otherwise, so ids reveal nothing. */
  async access(teacher: Teacher, classId: string): Promise<ClassRow> {
    const [cls] = await this.dbService.db
      .select()
      .from(schema.classroomClasses)
      .where(
        and(
          eq(schema.classroomClasses.id, classId),
          or(eq(schema.classroomClasses.ownerTeacherId, teacher.id), inArray(schema.classroomClasses.id, this.coTaught(teacher.id))),
        ),
      );
    if (!cls) throw new NotFoundException();
    return cls;
  }

  /** Co-teachers and deleting the class are the owner's. */
  private async ownClass(teacher: Teacher, classId: string): Promise<ClassRow> {
    const cls = await this.access(teacher, classId);
    if (cls.ownerTeacherId !== teacher.id) throw new ForbiddenException("classroom_owner_only");
    return cls;
  }

  private async student(classId: string, studentId: string) {
    const [student] = await this.dbService.db
      .select()
      .from(schema.classroomStudents)
      .where(and(eq(schema.classroomStudents.id, studentId), eq(schema.classroomStudents.classId, classId)));
    if (!student) throw new NotFoundException();
    return student;
  }

  private async progress(userId: string, students: (typeof schema.classroomStudents.$inferSelect)[]) {
    const out = new Map<string, MilestoneCounts>();
    for (const s of students) out.set(s.id, await this.companyProgress(userId, s.tenantId, s.seededAt ?? s.createdAt));
    return out;
  }

  /** One company's milestones since `since`, read as the teacher who is a viewer there. */
  async companyProgress(userId: string, tenantId: string, since: Date): Promise<MilestoneCounts> {
    const [row] = await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return tx.unsafe(MILESTONE_SQL, [since.toISOString()]);
    });
    return toMilestoneCounts(row as Record<string, unknown> | undefined);
  }

  /** Join codes are unique; a clash (one in a billion) just draws again. */
  private async withFreshJoinCode<T>(write: (joinCode: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await write(generateCode());
      } catch (err) {
        if ((err as { code?: string }).code !== "23505" || attempt >= 4) throw err;
      }
    }
  }
}

/** RFC 4180, and no cell a spreadsheet would run as a formula. */
export function toCsv(rows: string[][]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
