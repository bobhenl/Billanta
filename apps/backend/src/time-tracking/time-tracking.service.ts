import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { InvoicesService } from "../invoices/invoices.service";
import type {
  CreateProjectDto,
  CreateTimeEntryDto,
  InvoiceTimeDto,
  ListTimeEntriesQuery,
  StartTimerDto,
  UpdateProjectDto,
  UpdateTimeEntryDto,
} from "./dto/time-tracking.dto";

type TenantDb = PostgresJsDatabase<typeof schema>;
type Entry = typeof schema.timeEntries.$inferSelect;
type Project = typeof schema.projects.$inferSelect;

const MINUTE = 60_000;
const minutesBetween = (a: Date, b: Date) => Math.max(1, Math.round((b.getTime() - a.getTime()) / MINUTE));
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const czDate = (d: Date) => `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;

/**
 * Time tracking: projects with an hourly rate, a start/stop timer and typed-in
 * blocks of work, and "Vyfakturovat" — unbilled entries become line items of a
 * new draft (per entry, project or day), and the entries are tied to it so
 * they are not billed twice. Deleting that draft frees them again (FK set null).
 */
@Injectable()
export class TimeTrackingService {
  constructor(private readonly invoicesService: InvoicesService) {}

  // --- projects -------------------------------------------------------------

  async listProjects(db: TenantDb) {
    const rows = await db
      .select({
        project: schema.projects,
        contactName: schema.contacts.legalName,
        unbilledMinutes: sql<number>`coalesce((select sum(te.minutes) from time_entries te where te.project_id = ${schema.projects.id} and te.billable and te.invoice_id is null and te.ended_at is not null), 0)::int`,
        totalMinutes: sql<number>`coalesce((select sum(te.minutes) from time_entries te where te.project_id = ${schema.projects.id}), 0)::int`,
      })
      .from(schema.projects)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.projects.contactId))
      .orderBy(asc(schema.projects.archived), asc(schema.projects.name));
    return rows.map(({ project, ...rest }) => ({ ...project, ...rest }));
  }

  private async requireProject(db: TenantDb, id: string): Promise<Project> {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  private async requireContact(db: TenantDb, id: string | null | undefined) {
    if (!id) return;
    const [c] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, id));
    if (!c) throw new NotFoundException("Contact not found");
  }

  async createProject(db: TenantDb, tenantId: string, dto: CreateProjectDto) {
    await this.requireContact(db, dto.contact_id);
    const [project] = await db
      .insert(schema.projects)
      .values({
        tenantId,
        name: dto.name,
        contactId: dto.contact_id ?? null,
        hourlyRate: dto.hourly_rate == null ? null : dto.hourly_rate.toFixed(2),
        currency: dto.currency.toUpperCase(),
        color: dto.color || null,
      })
      .returning();
    return project;
  }

  async updateProject(db: TenantDb, id: string, dto: UpdateProjectDto) {
    await this.requireProject(db, id);
    await this.requireContact(db, dto.contact_id);
    const v: Partial<typeof schema.projects.$inferInsert> = {};
    if (dto.name !== undefined) v.name = dto.name;
    if (dto.contact_id !== undefined) v.contactId = dto.contact_id ?? null;
    if (dto.hourly_rate !== undefined) v.hourlyRate = dto.hourly_rate == null ? null : dto.hourly_rate.toFixed(2);
    if (dto.currency !== undefined) v.currency = dto.currency.toUpperCase();
    if (dto.color !== undefined) v.color = dto.color || null;
    if (dto.archived !== undefined) v.archived = dto.archived;
    const [project] = await db.update(schema.projects).set(v).where(eq(schema.projects.id, id)).returning();
    return project;
  }

  /** Entries keep their time; they just lose the project. */
  async removeProject(db: TenantDb, id: string) {
    await this.requireProject(db, id);
    await db.delete(schema.projects).where(eq(schema.projects.id, id));
    return { ok: true };
  }

  // --- entries --------------------------------------------------------------

  async list(db: TenantDb, q: ListTimeEntriesQuery) {
    const conditions = [isNotNull(schema.timeEntries.endedAt)];
    if (q.from) conditions.push(gte(schema.timeEntries.startedAt, q.from));
    if (q.to) conditions.push(lt(schema.timeEntries.startedAt, new Date(q.to.getTime() + 86_400_000)));
    if (q.project_id) conditions.push(eq(schema.timeEntries.projectId, q.project_id));
    if (q.contact_id)
      conditions.push(
        sql`coalesce(${schema.timeEntries.contactId}, ${schema.projects.contactId}) = ${q.contact_id}`,
      );
    if (q.state === "unbilled") conditions.push(eq(schema.timeEntries.billable, true), isNull(schema.timeEntries.invoiceId));
    if (q.state === "billed") conditions.push(isNotNull(schema.timeEntries.invoiceId));
    if (q.state === "nonbillable") conditions.push(eq(schema.timeEntries.billable, false));

    const rows = await db
      .select({
        entry: schema.timeEntries,
        projectName: schema.projects.name,
        projectColor: schema.projects.color,
        projectRate: schema.projects.hourlyRate,
        currency: schema.projects.currency,
        contactId: sql<string | null>`coalesce(${schema.timeEntries.contactId}, ${schema.projects.contactId})`,
        contactName: schema.contacts.legalName,
        invoiceNumber: schema.invoices.invoiceNumber,
      })
      .from(schema.timeEntries)
      .leftJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
      .leftJoin(
        schema.contacts,
        eq(schema.contacts.id, sql`coalesce(${schema.timeEntries.contactId}, ${schema.projects.contactId})`),
      )
      .leftJoin(schema.invoices, eq(schema.invoices.id, schema.timeEntries.invoiceId))
      .where(and(...conditions))
      .orderBy(desc(schema.timeEntries.startedAt))
      .limit(1000);

    return rows.map(({ entry, projectRate, currency, ...rest }) => {
      const rate = entry.hourlyRate != null ? Number(entry.hourlyRate) : projectRate != null ? Number(projectRate) : null;
      return {
        ...entry,
        ...rest,
        currency: currency ?? "CZK",
        rate,
        amount: rate == null ? null : round2((entry.minutes / 60) * rate),
      };
    });
  }

  /** Totals for the dashboard card and the page header. */
  async summary(db: TenantDb, userId?: string | null) {
    const weekStart = new Date();
    weekStart.setUTCHours(0, 0, 0, 0);
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const [row] = await db
      .select({
        weekMinutes: sql<number>`coalesce(sum(${schema.timeEntries.minutes}) filter (where ${schema.timeEntries.startedAt} >= ${weekStart.toISOString()}::timestamptz), 0)::int`,
        unbilledMinutes: sql<number>`coalesce(sum(${schema.timeEntries.minutes}) filter (where ${schema.timeEntries.billable} and ${schema.timeEntries.invoiceId} is null), 0)::int`,
      })
      .from(schema.timeEntries)
      .where(isNotNull(schema.timeEntries.endedAt));
    const amounts = await db
      .select({
        currency: sql<string>`coalesce(${schema.projects.currency}, 'CZK')`,
        amount: sql<string>`coalesce(sum(${schema.timeEntries.minutes} / 60.0 * coalesce(${schema.timeEntries.hourlyRate}, ${schema.projects.hourlyRate}, 0)), 0)`,
      })
      .from(schema.timeEntries)
      .leftJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
      .where(
        and(
          isNotNull(schema.timeEntries.endedAt),
          eq(schema.timeEntries.billable, true),
          isNull(schema.timeEntries.invoiceId),
        ),
      )
      .groupBy(sql`coalesce(${schema.projects.currency}, 'CZK')`);
    return {
      weekMinutes: row?.weekMinutes ?? 0,
      unbilledMinutes: row?.unbilledMinutes ?? 0,
      unbilled: amounts.map((a) => ({ currency: a.currency, amount: round2(Number(a.amount)) })).filter((a) => a.amount > 0),
      running: await this.running(db, userId),
    };
  }

  async running(db: TenantDb, userId?: string | null) {
    const [row] = await db
      .select({ entry: schema.timeEntries, projectName: schema.projects.name })
      .from(schema.timeEntries)
      .leftJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
      .where(and(isNull(schema.timeEntries.endedAt), userId ? eq(schema.timeEntries.userId, userId) : undefined))
      .orderBy(desc(schema.timeEntries.startedAt))
      .limit(1);
    return row ? { ...row.entry, projectName: row.projectName } : null;
  }

  private async requireEntry(db: TenantDb, id: string): Promise<Entry> {
    const [entry] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id));
    if (!entry) throw new NotFoundException("Time entry not found");
    return entry;
  }

  private assertEditable(entry: Entry) {
    if (entry.invoiceId) throw new BadRequestException("The entry is already invoiced; delete or cancel that draft first");
  }

  async create(db: TenantDb, tenantId: string, userId: string | null, dto: CreateTimeEntryDto) {
    if (dto.project_id) await this.requireProject(db, dto.project_id);
    await this.requireContact(db, dto.contact_id);
    const minutes = dto.minutes ?? minutesBetween(dto.started_at, dto.ended_at!);
    const [entry] = await db
      .insert(schema.timeEntries)
      .values({
        tenantId,
        userId,
        description: dto.description,
        projectId: dto.project_id ?? null,
        contactId: dto.contact_id ?? null,
        hourlyRate: dto.hourly_rate == null ? null : dto.hourly_rate.toFixed(2),
        billable: dto.billable,
        startedAt: dto.started_at,
        endedAt: dto.ended_at ?? new Date(dto.started_at.getTime() + minutes * MINUTE),
        minutes,
      })
      .returning();
    return entry;
  }

  /** Starts a timer; a timer this person already has running is stopped first. */
  async start(db: TenantDb, tenantId: string, userId: string | null, dto: StartTimerDto) {
    if (dto.project_id) await this.requireProject(db, dto.project_id);
    await this.requireContact(db, dto.contact_id);
    const current = await this.running(db, userId ?? undefined);
    if (current) await this.stop(db, current.id);
    const [entry] = await db
      .insert(schema.timeEntries)
      .values({
        tenantId,
        userId,
        description: dto.description,
        projectId: dto.project_id ?? null,
        contactId: dto.contact_id ?? null,
        billable: dto.billable,
        startedAt: new Date(),
      })
      .returning();
    return entry;
  }

  async stop(db: TenantDb, id: string) {
    const entry = await this.requireEntry(db, id);
    if (entry.endedAt) return entry;
    const endedAt = new Date();
    const [updated] = await db
      .update(schema.timeEntries)
      .set({ endedAt, minutes: minutesBetween(entry.startedAt, endedAt) })
      .where(eq(schema.timeEntries.id, id))
      .returning();
    return updated;
  }

  async update(db: TenantDb, id: string, dto: UpdateTimeEntryDto) {
    const entry = await this.requireEntry(db, id);
    this.assertEditable(entry);
    if (dto.project_id) await this.requireProject(db, dto.project_id);
    await this.requireContact(db, dto.contact_id);
    const v: Partial<typeof schema.timeEntries.$inferInsert> = {};
    if (dto.description !== undefined) v.description = dto.description;
    if (dto.project_id !== undefined) v.projectId = dto.project_id ?? null;
    if (dto.contact_id !== undefined) v.contactId = dto.contact_id ?? null;
    if (dto.hourly_rate !== undefined) v.hourlyRate = dto.hourly_rate == null ? null : dto.hourly_rate.toFixed(2);
    if (dto.billable !== undefined) v.billable = dto.billable;
    if (dto.started_at !== undefined) v.startedAt = dto.started_at;
    if (entry.endedAt && (dto.minutes !== undefined || dto.started_at !== undefined)) {
      const minutes = dto.minutes ?? entry.minutes;
      const start = dto.started_at ?? entry.startedAt;
      v.minutes = minutes;
      v.endedAt = new Date(start.getTime() + minutes * MINUTE);
    }
    const [updated] = await db.update(schema.timeEntries).set(v).where(eq(schema.timeEntries.id, id)).returning();
    return updated;
  }

  async remove(db: TenantDb, id: string) {
    const entry = await this.requireEntry(db, id);
    this.assertEditable(entry);
    await db.delete(schema.timeEntries).where(eq(schema.timeEntries.id, id));
    return { ok: true };
  }

  /**
   * Unbilled entries → one draft invoice. All entries must belong to the same
   * customer (their own, their project's, or `contact_id`) and currency.
   * Lines are hours × rate; a group with mixed rates splits by rate.
   */
  async invoice(db: TenantDb, tenantId: string, dto: InvoiceTimeDto) {
    const ids = [...new Set(dto.entry_ids)];
    const rows = await db
      .select({ entry: schema.timeEntries, project: schema.projects })
      .from(schema.timeEntries)
      .leftJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
      .where(inArray(schema.timeEntries.id, ids))
      .orderBy(asc(schema.timeEntries.startedAt));
    if (rows.length !== ids.length) throw new NotFoundException("Some time entries were not found");
    if (rows.some((r) => !r.entry.endedAt)) throw new BadRequestException("Stop the running timer first");
    if (rows.some((r) => r.entry.invoiceId)) throw new BadRequestException("Some entries are already invoiced");
    if (rows.some((r) => !r.entry.billable)) throw new BadRequestException("Some entries are not billable");

    const contacts = new Set(rows.map((r) => r.entry.contactId ?? r.project?.contactId ?? null).filter(Boolean));
    const contactId = dto.contact_id ?? (contacts.size === 1 ? [...contacts][0]! : null);
    if (!contactId) {
      throw new BadRequestException(contacts.size > 1 ? "The entries belong to different customers" : "Choose the customer to invoice");
    }
    const currencies = new Set(rows.map((r) => r.project?.currency ?? "CZK"));
    if (currencies.size > 1) throw new BadRequestException("The entries are in different currencies");
    const currency = [...currencies][0]!;

    const [tenant] = await db
      .select({ defaultDueDays: schema.tenants.defaultDueDays, vatPayer: schema.tenants.dicVatPayer })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    const vatRate = tenant?.vatPayer ? 21 : null;

    type Group = { label: string; minutes: number; rate: number; first: Date; last: Date };
    const groups = new Map<string, Group>();
    for (const { entry, project } of rows) {
      const rate = Number(entry.hourlyRate ?? project?.hourlyRate ?? 0);
      const base =
        dto.group_by === "entry"
          ? entry.id
          : dto.group_by === "day"
            ? `${dayKey(entry.startedAt)}|${project?.id ?? "none"}`
            : (project?.id ?? "none");
      const key = `${base}|${rate}`;
      const label =
        dto.group_by === "entry"
          ? [project?.name, entry.description].filter(Boolean).join(": ") || czDate(entry.startedAt)
          : dto.group_by === "day"
            ? `${project?.name || "Práce"} – ${czDate(entry.startedAt)}`
            : project?.name || "Práce";
      const g = groups.get(key);
      if (g) {
        g.minutes += entry.minutes;
        if (entry.startedAt > g.last) g.last = entry.startedAt;
      } else {
        groups.set(key, { label, minutes: entry.minutes, rate, first: entry.startedAt, last: entry.startedAt });
      }
    }

    const lineItems = [...groups.values()].map((g) => {
      const span =
        dto.group_by === "project"
          ? dayKey(g.first) === dayKey(g.last)
            ? ` (${czDate(g.first)})`
            : ` (${czDate(g.first)} – ${czDate(g.last)})`
          : "";
      return {
        description: `${g.label}${span}`.slice(0, 500),
        // Hours at the column's full scale (3 decimals) so the line stays close to the per-entry sums.
        quantity: Math.max(0.001, Math.round((g.minutes / 60) * 1000) / 1000),
        unit: "h",
        unit_price: g.rate,
        vat_rate: vatRate,
        discount_percent: 0,
      };
    });

    const issueDate = new Date();
    const invoice = await this.invoicesService.create(db, tenantId, {
      document_type: "invoice",
      contact_id: contactId,
      issue_date: issueDate,
      due_date: new Date(issueDate.getTime() + (tenant?.defaultDueDays ?? 14) * 86_400_000),
      currency,
      payment_method: "bank_transfer",
      language: "cs",
      reverse_charge: false,
      source_ai: false,
      line_items: lineItems,
    } as Parameters<InvoicesService["create"]>[2]);

    await db.update(schema.timeEntries).set({ invoiceId: invoice.id }).where(inArray(schema.timeEntries.id, ids));
    return invoice;
  }
}
