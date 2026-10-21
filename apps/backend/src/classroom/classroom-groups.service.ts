import { BadRequestException, ConflictException, GoneException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { buildDemoDataset, type DemoKind } from "../demo/dataset";
import { DemoSeedService } from "../demo/demo-seed.service";
import { accountantModes, accountantPermissions } from "./accountants";
import { ClassroomClassesService } from "./classroom-classes.service";
import type { AccountantDto, CreateCompanyDto, PartnersDto } from "./classroom.dto";
import { ClassroomTeachersService } from "./classroom-teachers.service";
import type { MilestoneCounts } from "./milestones";

type ClassRow = typeof schema.classroomClasses.$inferSelect;

const MAX_TEAMS = 20;

/** The 0083 functions' exceptions as HTTP answers. */
const SQL_CODES: Record<string, () => HttpException> = {
  classroom_closed: () => new GoneException("classroom_closed"),
  classroom_not_found: () => new NotFoundException(),
  classroom_invalid_kind: () => new BadRequestException("classroom_invalid_kind"),
  classroom_team_empty: () => new BadRequestException("classroom_team_empty"),
  classroom_company_limit: () => new ConflictException("classroom_company_limit"),
  classroom_team_taken: () => new ConflictException("classroom_team_taken"),
  classroom_team_full: () => new ConflictException("classroom_team_full"),
  classroom_accountant_member: () => new ConflictException("classroom_accountant_member"),
  classroom_accountant_limit: () => new ConflictException("classroom_accountant_limit"),
};

async function mapped<T>(run: Promise<T>): Promise<T> {
  try {
    return await run;
  } catch (err) {
    const code = SQL_CODES[(err as Error).message];
    if (code) throw code();
    throw err;
  }
}

/**
 * Phase 2 of classroom mode (docs/classroom-mode-plan.md §8): teams, the
 * companies beyond a student's home one, trading partners and students as
 * accountants. Every teacher of the class may arrange them; memberships
 * change only inside the classroom_* functions of migration 0083.
 */
@Injectable()
export class ClassroomGroupsService {
  private readonly logger = new Logger(ClassroomGroupsService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly teachers: ClassroomTeachersService,
    private readonly classes: ClassroomClassesService,
    private readonly seeder: DemoSeedService,
  ) {}

  /** What the class page adds to the students: teams, extra companies with their progress, accountants. */
  async overview(userId: string, classId: string) {
    const cls = await this.cls(userId, classId);
    const db = this.dbService.db;
    const teams = await db.select().from(schema.classroomTeams).where(eq(schema.classroomTeams.classId, cls.id)).orderBy(asc(schema.classroomTeams.name));
    const members = await db.select().from(schema.classroomTeamMembers).where(eq(schema.classroomTeamMembers.classId, cls.id));
    const companies = await db
      .select()
      .from(schema.classroomCompanies)
      .where(eq(schema.classroomCompanies.classId, cls.id))
      .orderBy(asc(schema.classroomCompanies.createdAt));
    const accountants = await db
      .select()
      .from(schema.classroomAccountants)
      .where(eq(schema.classroomAccountants.classId, cls.id))
      .orderBy(asc(schema.classroomAccountants.createdAt));
    const progress = new Map<string, MilestoneCounts>();
    for (const c of companies) progress.set(c.id, await this.classes.companyProgress(userId, c.tenantId, c.seededAt ?? c.createdAt));
    return {
      accountantModes: accountantModes(cls.track),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        studentIds: members.filter((m) => m.teamId === t.id).map((m) => m.studentId),
      })),
      companies: companies.map((c) => ({
        id: c.id,
        tenantId: c.tenantId,
        kind: c.kind,
        label: c.label,
        studentId: c.studentId,
        teamId: c.teamId,
        createdAt: c.createdAt.toISOString(),
        progress: progress.get(c.id)!,
      })),
      accountants: accountants.map((a) => ({ id: a.id, tenantId: a.tenantId, studentId: a.studentId, mode: a.mode })),
    };
  }

  async createTeam(userId: string, classId: string, name: string) {
    const cls = await this.open(userId, classId);
    const [{ n }] = await this.dbService.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.classroomTeams)
      .where(eq(schema.classroomTeams.classId, cls.id));
    if (n >= MAX_TEAMS) throw new ConflictException("classroom_team_limit");
    try {
      const [team] = await this.dbService.db.insert(schema.classroomTeams).values({ classId: cls.id, name }).returning();
      return { id: team.id, name: team.name, studentIds: [] as string[] };
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new ConflictException("classroom_team_name_taken");
      throw err;
    }
  }

  async renameTeam(userId: string, classId: string, teamId: string, name: string) {
    const cls = await this.cls(userId, classId);
    await this.team(cls.id, teamId);
    try {
      await this.dbService.db.update(schema.classroomTeams).set({ name }).where(eq(schema.classroomTeams.id, teamId));
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new ConflictException("classroom_team_name_taken");
      throw err;
    }
    return { ok: true };
  }

  /** The team goes with its companies; the members keep their home companies. */
  async deleteTeam(userId: string, classId: string, teamId: string) {
    const cls = await this.cls(userId, classId, { suspended: true });
    await this.team(cls.id, teamId);
    await this.dbService.sql`SELECT classroom_delete_team(${teamId})`;
    return { ok: true };
  }

  async setTeamMember(userId: string, classId: string, teamId: string, studentId: string, add: boolean) {
    const cls = add ? await this.open(userId, classId) : await this.cls(userId, classId, { suspended: true });
    await this.team(cls.id, teamId);
    await mapped(this.dbService.sql`SELECT classroom_team_member(${teamId}, ${studentId}, ${add})`);
    return { ok: true };
  }

  /**
   * A second company of a student or the company of a team, filled with the
   * kind's dataset like a home company. The label replaces the dataset's
   * name, so two companies of one kind can be told apart in the switcher
   * and on each other's invoices.
   */
  async createCompany(userId: string, classId: string, dto: CreateCompanyDto) {
    const cls = await this.open(userId, classId);
    if (!cls.kinds.includes(dto.kind)) throw new BadRequestException("classroom_invalid_kind");
    const kind = dto.kind as DemoKind;
    const { supplier, language } = buildDemoDataset(kind, new Date(), cls.language);
    const label = dto.label || null;
    const tenant = label ? { ...supplier.tenant, company_name: label, legal_name: label } : supplier.tenant;
    const [row] = await mapped(
      this.dbService.sql<{ company_id: string; tenant_id: string; seed_user_id: string }[]>`
        SELECT * FROM classroom_create_company(
          ${cls.id}, ${dto.studentId ?? null}, ${dto.teamId ?? null}, ${kind}, ${label},
          ${JSON.stringify(tenant)}::jsonb, ${JSON.stringify(supplier.bank)}::jsonb, ${JSON.stringify(cls.modules)}::jsonb
        )`,
    );
    try {
      if (cls.seeded) {
        await this.seeder.seed(row.tenant_id, row.seed_user_id, kind, language);
        await this.dbService.sql`UPDATE classroom_companies SET seeded_at = now() WHERE id = ${row.company_id}`;
      }
    } catch (err) {
      // As at joining: a half-filled company is worse than none.
      this.logger.error(`classroom company seed (${kind}) failed: ${(err as Error).message}`);
      await this.dbService.sql`SELECT classroom_delete_company(${row.company_id})`.catch(() => undefined);
      throw new HttpException("classroom_unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { id: row.company_id, tenantId: row.tenant_id };
  }

  async deleteCompany(userId: string, classId: string, companyId: string) {
    const cls = await this.cls(userId, classId, { suspended: true });
    const [company] = await this.dbService.db
      .select({ id: schema.classroomCompanies.id })
      .from(schema.classroomCompanies)
      .where(and(eq(schema.classroomCompanies.id, companyId), eq(schema.classroomCompanies.classId, cls.id)));
    if (!company) throw new NotFoundException();
    await this.dbService.sql`SELECT classroom_delete_company(${company.id})`;
    return { ok: true };
  }

  /**
   * Two companies of the class become each other's customers: each gets the
   * other as a contact, read from that company's own row. Nothing travels
   * between them later; an invoice from one is typed in by the other.
   */
  async pairPartners(userId: string, classId: string, dto: PartnersDto) {
    const cls = await this.open(userId, classId);
    const tenants = await this.classTenants(userId, cls.id);
    if (!tenants.has(dto.tenantA) || !tenants.has(dto.tenantB)) throw new NotFoundException();
    const added = await this.dbService.sql.begin(async (tx) => {
      const as = async (tenantId: string) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      };
      const read = async (tenantId: string) => {
        await as(tenantId);
        const [t] = await tx<PartnerRow[]>`
          SELECT company_name, legal_name, ico, dic, dic_vat_payer, address_street, address_city, address_postal_code, address_country
          FROM tenants WHERE id = ${tenantId}`;
        if (!t) throw new NotFoundException();
        return t;
      };
      const a = await read(dto.tenantA);
      const b = await read(dto.tenantB);
      let n = 0;
      for (const [into, partner] of [
        [dto.tenantA, b],
        [dto.tenantB, a],
      ] as const) {
        await as(into);
        const name = partner.legal_name || partner.company_name;
        const [exists] = await tx`SELECT 1 FROM contacts WHERE tenant_id = ${into} AND legal_name = ${name} LIMIT 1`;
        if (exists) continue;
        await tx`
          INSERT INTO contacts (tenant_id, legal_name, ico, dic, is_vat_payer, address_street, address_city, address_postal_code, address_country, is_starred)
          VALUES (${into}, ${name}, ${partner.ico}, ${partner.dic}, ${partner.dic_vat_payer}, ${partner.address_street},
                  ${partner.address_city}, ${partner.address_postal_code}, ${partner.address_country ?? "CZ"}, true)`;
        n++;
      }
      return n;
    });
    return { added };
  }

  async assignAccountant(userId: string, classId: string, dto: AccountantDto) {
    const cls = await this.open(userId, classId);
    if (!accountantModes(cls.track).includes(dto.mode)) throw new BadRequestException("classroom_invalid_mode");
    const permissions = accountantPermissions(dto.mode);
    const [row] = await mapped(
      this.dbService.sql<{ id: string }[]>`
        SELECT classroom_assign_accountant(
          ${cls.id}, ${dto.tenantId}, ${dto.studentId}, ${dto.mode}, ${permissions ? JSON.stringify(permissions) : null}::jsonb
        ) AS id`,
    );
    return { id: row.id };
  }

  async unassignAccountant(userId: string, classId: string, linkId: string) {
    const cls = await this.cls(userId, classId, { suspended: true });
    const [link] = await this.dbService.db
      .select({ id: schema.classroomAccountants.id })
      .from(schema.classroomAccountants)
      .where(and(eq(schema.classroomAccountants.id, linkId), eq(schema.classroomAccountants.classId, cls.id)));
    if (!link) throw new NotFoundException();
    await this.dbService.sql`SELECT classroom_unassign_accountant(${link.id})`;
    return { ok: true };
  }

  /** As ClassroomClassesService: in a suspended school only taking things away is left. */
  private async cls(userId: string, classId: string, opts: { suspended?: boolean } = {}): Promise<ClassRow> {
    const { teacher, school } = await this.teachers.approved(userId);
    return this.classes.access(teacher, school, classId, opts);
  }

  /** New teams, companies and pairings only while the class runs; the functions check the school too. */
  private async open(userId: string, classId: string): Promise<ClassRow> {
    const cls = await this.cls(userId, classId);
    if (cls.endsAt.getTime() <= Date.now()) throw new GoneException("classroom_closed");
    return cls;
  }

  private async team(classId: string, teamId: string) {
    const [team] = await this.dbService.db
      .select({ id: schema.classroomTeams.id })
      .from(schema.classroomTeams)
      .where(and(eq(schema.classroomTeams.id, teamId), eq(schema.classroomTeams.classId, classId)));
    if (!team) throw new NotFoundException();
    return team;
  }

  /** Every practice company of the class: the home ones (read as the teacher, RLS) and the extra ones. */
  private async classTenants(userId: string, classId: string): Promise<Set<string>> {
    const home = await this.classes.asTeacher(userId, (db) =>
      db.select({ id: schema.classroomStudents.tenantId }).from(schema.classroomStudents).where(eq(schema.classroomStudents.classId, classId)),
    );
    const extra = await this.dbService.db.select({ id: schema.classroomCompanies.tenantId }).from(schema.classroomCompanies).where(eq(schema.classroomCompanies.classId, classId));
    return new Set([...home, ...extra].map((r) => r.id));
  }
}

interface PartnerRow {
  company_name: string;
  legal_name: string | null;
  ico: string | null;
  dic: string | null;
  dic_vat_payer: boolean | null;
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  address_country: string | null;
}
