import { ConflictException, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { EPO_SCHEMA_FORMS, epoSchemaSamples } from "@faktur/cz-compliance";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { EmailService } from "../email/email.service";
import { platformAdminEmails } from "../partners/platform-admin.guard";
import { checkSamples, nextFormState, validateAgainstXsd, type FormSchemaRow, type SchemaAlert, type SchemaOutcome } from "./form-schema-check";

const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "BillantaLegislationMonitor/1.0 (+https://billanta.cz; daily check of EPO form schemas)";
/** The guard reads the state at most this often per process; a block takes effect within a minute. */
const STATE_TTL_MS = 60_000;

/**
 * Watches the XSD of every EPO form Billanta exports. Platform-level: a
 * global table, no tenant. A form whose sample exports fail the current
 * schema is refused (409 form_blocked) until a fixed release passes again;
 * nothing is changed automatically.
 */
@Injectable()
export class FormSchemasService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FormSchemasService.name);
  private cache: { at: number; rows: Map<string, FormSchemaRow> } | null = null;

  constructor(
    private readonly dbService: DbService,
    private readonly email: EmailService,
  ) {}

  /** After a deploy that fixes a blocked form, unblock it now rather than next morning. */
  onApplicationBootstrap() {
    if (process.env.NODE_ENV === "test") return;
    void this.rows()
      .then((rows) => ([...rows.values()].some((r) => r.status === "blocked") ? this.runCheck() : null))
      .catch((err) => this.logger.warn(`form schema recheck on start failed: ${(err as Error).message}`));
  }

  async runCheck(): Promise<{ form: string; status: string; error: string | null }[]> {
    const samples = epoSchemaSamples();
    const prev = await this.rows(true);
    const now = new Date();
    const results: { form: string; status: string; error: string | null }[] = [];
    // One host for all forms: one request at a time.
    for (const { form, xsdUrl } of EPO_SCHEMA_FORMS) {
      const outcome = await this.fetchAndCheck(xsdUrl, samples.filter((s) => s.form === form));
      const { row, alerts } = nextFormState(form, xsdUrl, prev.get(form) ?? null, outcome, now);
      const { form: _f, ...rest } = row;
      await this.dbService.db.insert(schema.formSchemas).values(row).onConflictDoUpdate({ target: schema.formSchemas.form, set: rest });
      for (const a of alerts) await this.alert(form, a);
      results.push({ form, status: row.status, error: row.lastError });
    }
    this.cache = null;
    return results;
  }

  private async fetchAndCheck(url: string, samples: ReturnType<typeof epoSchemaSamples>): Promise<SchemaOutcome> {
    let xsd: string;
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
      if (!res.ok) throw new Error(`http_${res.status}`);
      xsd = await res.text();
    } catch (err) {
      const e = err as Error;
      return { kind: "unavailable", error: e.name === "TimeoutError" ? "timeout" : e.message.slice(0, 200) };
    }
    return checkSamples(xsd, samples);
  }

  private async alert(form: string, a: SchemaAlert) {
    await this.dbService.db.insert(schema.platformAlerts).values({ kind: a.kind, sourceKey: `xsd:${form}`, message: a.message });
    this.logger.warn(`${a.kind}: ${form}`);
    const title = {
      form_schema_blocked: `Billanta: ${form.toUpperCase()} zablokován – export neprošel novým XSD`,
      form_schema_unblocked: `Billanta: ${form.toUpperCase()} odblokován`,
      form_schema_changed: `Billanta: změna XSD ${form.toUpperCase()} (export stále prochází)`,
      form_schema_check_failed: `Billanta: XSD ${form.toUpperCase()} se nepodařilo zkontrolovat`,
    }[a.kind];
    for (const to of platformAdminEmails()) {
      try {
        await this.email.sendPlatformEmail({ to, title, body: a.message });
      } catch (err) {
        this.logger.warn(`form schema alert e-mail failed: ${(err as Error).message}`);
      }
    }
  }

  private async rows(fresh = false): Promise<Map<string, FormSchemaRow>> {
    if (!fresh && this.cache && Date.now() - this.cache.at < STATE_TTL_MS) return this.cache.rows;
    const list = await this.dbService.db.select().from(schema.formSchemas);
    const rows = new Map(list.map((r) => [r.form, r as FormSchemaRow]));
    this.cache = { at: Date.now(), rows };
    return rows;
  }

  /** 409 form_blocked while the form's samples fail the current XSD. A form never checked yet is open. */
  async assertAvailable(form: string): Promise<void> {
    const row = (await this.rows()).get(form);
    if (row?.status === "blocked") throw new ConflictException("form_blocked");
  }

  /**
   * A real export against the stored XSD: the rules it breaks, as paths
   * without values ("VetaP/@c_telef: maxLength"), so EPO's rejection can
   * be named before the person uploads it. Empty when it passes or no XSD
   * is stored yet.
   */
  async exportProblems(form: string, xml: string): Promise<string[]> {
    const row = (await this.rows()).get(form);
    if (!row?.xsd) return [];
    try {
      const r = await validateAgainstXsd(row.xsd, xml);
      if (r.schemaBroken) return [];
      return [...new Set(r.errors.map((e) => e.path))].slice(0, 20);
    } catch (err) {
      this.logger.warn(`export schema check failed for ${form}: ${(err as Error).message}`);
      return [];
    }
  }

  async overview() {
    const rows = await this.dbService.db
      .select({
        form: schema.formSchemas.form,
        url: schema.formSchemas.url,
        status: schema.formSchemas.status,
        errors: schema.formSchemas.errors,
        lastError: schema.formSchemas.lastError,
        lastCheckedAt: schema.formSchemas.lastCheckedAt,
        lastChangedAt: schema.formSchemas.lastChangedAt,
        blockedAt: schema.formSchemas.blockedAt,
      })
      .from(schema.formSchemas);
    return EPO_SCHEMA_FORMS.map((f) => ({ ...f, state: rows.find((r) => r.form === f.form) ?? null }));
  }
}
