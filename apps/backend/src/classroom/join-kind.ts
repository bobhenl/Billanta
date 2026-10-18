import { BadRequestException, ConflictException, GoneException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { encryptSecret } from "../backup-destinations/encryption.util";
import { DbService } from "../db/db.service";
import { buildDemoDataset, isDemoKind } from "../demo/dataset";
import { DemoSeedService } from "../demo/demo-seed.service";
import { CLASSROOM_GRACE_DAYS, classroomConfig } from "./classroom-config";
import { normalizeNickname } from "./classroom.dto";
import { formatCode, generateCode, hashCode, normalizeCode } from "./codes";

/**
 * The interface the shared group codes (`/join/CODE`, promo-codes branch)
 * will dispatch to, see docs/classroom-mode-plan.md §1.5. Until that lands
 * the class code is `classroom_classes.join_code` and the public classroom
 * controller calls this handler directly.
 */
export interface JoinPreview {
  kind: "school_class";
  className: string;
  schoolName: string;
  language: "cs" | "sk" | "en";
  companyKinds: string[];
  /** New students may join; re-entry works while the class's companies exist. */
  enrolmentOpen: boolean;
  ended: boolean;
}

export interface JoinResult {
  userId: string;
  tenantId: string;
  sessionExpiresAt: string;
  redirect: string;
}

export interface JoinKindHandler {
  kind: "school_class";
  preview(code: string): Promise<JoinPreview | null>;
  join(code: string, input: unknown, ctx: { ipBucket: string }): Promise<JoinResult>;
  reenter?(code: string, personalCode: string, ctx: { ipBucket: string }): Promise<JoinResult>;
}

/** What a new student needs once: their own code, to get back in from another device. */
export interface ClassroomJoinResult extends JoinResult {
  nickname: string;
  reentryCode: string;
}

const CLOSED_CODES: Record<string, () => HttpException> = {
  classroom_closed: () => new GoneException("classroom_closed"),
  classroom_invalid_kind: () => new BadRequestException("classroom_invalid_kind"),
  classroom_class_full: () => new ConflictException("classroom_class_full"),
  classroom_school_full: () => new ConflictException("classroom_school_full"),
  classroom_nickname_taken: () => new ConflictException("classroom_nickname_taken"),
};

@Injectable()
export class ClassroomJoinHandler implements JoinKindHandler {
  readonly kind = "school_class" as const;
  private readonly logger = new Logger(ClassroomJoinHandler.name);

  constructor(
    private readonly dbService: DbService,
    private readonly seeder: DemoSeedService,
  ) {}

  async preview(code: string): Promise<JoinPreview | null> {
    const found = await this.findClass(code);
    if (!found) return null;
    const { cls, school } = found;
    const ended = cls.endsAt.getTime() <= Date.now();
    return {
      kind: this.kind,
      className: cls.name,
      schoolName: school.name,
      language: cls.language,
      companyKinds: cls.kinds,
      enrolmentOpen: cls.enrolmentOpen && !ended && school.suspendedAt === null,
      ended,
    };
  }

  async join(code: string, input: unknown): Promise<ClassroomJoinResult> {
    const found = await this.findClass(code);
    if (!found) throw new NotFoundException("classroom_not_found");
    const { cls } = found;
    const body = (input ?? {}) as { nickname?: unknown; kind?: unknown };
    const nickname = normalizeNickname(body.nickname);
    if (!nickname) throw new BadRequestException("classroom_invalid_nickname");
    // A class with one company type doesn't ask.
    const kind = body.kind ?? (cls.kinds.length === 1 ? cls.kinds[0] : undefined);
    if (!isDemoKind(kind) || !cls.kinds.includes(kind)) throw new BadRequestException("classroom_invalid_kind");

    const cfg = classroomConfig();
    const personal = generateCode();
    const { supplier, language } = buildDemoDataset(kind, new Date(), cls.language);
    let row: { student_id: string; tenant_id: string; user_id: string; expires_at: Date };
    try {
      [row] = await this.dbService.sql<{ student_id: string; tenant_id: string; user_id: string; expires_at: Date }[]>`
        SELECT * FROM classroom_join(
          ${cls.id}, ${nickname}, ${kind}, ${hashCode(personal, cfg.codeSecret)}, ${encryptSecret(personal, cfg.encryptionKey)},
          ${JSON.stringify(supplier.tenant)}::jsonb, ${JSON.stringify(supplier.bank)}::jsonb, ${JSON.stringify(cls.modules)}::jsonb
        )`;
    } catch (err) {
      const mapped = CLOSED_CODES[(err as Error).message];
      if (mapped) throw mapped();
      // Two students typing the same nickname at once: the unique index answers.
      if ((err as { code?: string }).code === "23505") throw new ConflictException("classroom_nickname_taken");
      throw err;
    }

    try {
      if (cls.seeded) {
        await this.seeder.seed(row.tenant_id, row.user_id, kind, language);
        await this.dbService.sql`UPDATE classroom_students SET seeded_at = now() WHERE id = ${row.student_id}`;
      }
    } catch (err) {
      // A half-filled company is worse than none; the student tries again.
      this.logger.error(`classroom seed (${kind}) failed: ${(err as Error).message}`);
      await this.dbService.sql`SELECT classroom_remove_student(${row.student_id})`.catch(() => undefined);
      throw new HttpException("classroom_unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      userId: row.user_id,
      tenantId: row.tenant_id,
      sessionExpiresAt: new Date(row.expires_at).toISOString(),
      redirect: `/${cls.language}/dashboard`,
      nickname,
      reentryCode: formatCode(personal),
    };
  }

  /** Same answer for an unknown class and a wrong code; the function counts the misses. */
  async reenter(code: string, personalCode: string): Promise<JoinResult> {
    const found = await this.findClass(code);
    const personal = normalizeCode(personalCode);
    if (!found || !personal) throw new UnauthorizedException("classroom_reenter_invalid");
    let rows: { tenant_id: string; user_id: string; expires_at: Date }[];
    try {
      rows = await this.dbService.sql<{ tenant_id: string; user_id: string; expires_at: Date }[]>`
        SELECT * FROM classroom_reenter(${found.cls.id}, ${hashCode(personal, classroomConfig().codeSecret)})`;
    } catch (err) {
      if ((err as Error).message === "classroom_locked_out") throw new HttpException("classroom_locked_out", HttpStatus.TOO_MANY_REQUESTS);
      throw err;
    }
    const [row] = rows;
    if (!row) throw new UnauthorizedException("classroom_reenter_invalid");
    return {
      userId: row.user_id,
      tenantId: row.tenant_id,
      sessionExpiresAt: new Date(row.expires_at).toISOString(),
      redirect: `/${found.cls.language}/dashboard`,
    };
  }

  /** A class whose companies still exist (up to the grace period after its end). */
  private async findClass(code: string) {
    const joinCode = normalizeCode(code);
    if (!joinCode) return null;
    const [found] = await this.dbService.db
      .select({ cls: schema.classroomClasses, school: schema.classroomSchools })
      .from(schema.classroomClasses)
      .innerJoin(schema.classroomSchools, eq(schema.classroomSchools.id, schema.classroomClasses.schoolId))
      .where(eq(schema.classroomClasses.joinCode, joinCode));
    if (!found || found.cls.endsAt.getTime() + CLASSROOM_GRACE_DAYS * 86_400_000 <= Date.now()) return null;
    return found;
  }
}
