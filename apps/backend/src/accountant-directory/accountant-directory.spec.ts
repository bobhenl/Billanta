import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import type { ExecutionContext } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { DbService } from "../db/db.service";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AccountantDirectoryService } from "./accountant-directory.service";
import { AdminAccountantsController, PublicAccountantsController } from "./public-accountants.controller";

const dialect = new PgDialect();
const MIGRATIONS = join(__dirname, "../../drizzle/migrations");

/** Body of the newest migration that (re)defines `name`, so a later redefinition is what gets checked. */
function latestFunction(name: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files.reverse()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const start = sql.search(new RegExp(`CREATE (OR REPLACE )?FUNCTION ${name}\\(`));
    if (start >= 0) return sql.slice(start, sql.indexOf("$$;", start));
  }
  throw new Error(`${name} not found`);
}

describe("public accountant directory", () => {
  // Team → invite and /accountants both read this function. A listing that
  // is pending, rejected or withdrawn must never reach either.
  // The listing no longer depends on the partner tier (0079): staff approve
  // the listing first, and only then the tier.
  it("lists only approved listings of active companies", () => {
    const body = latestFunction("public_accountant_listings").replace(/\s+/g, " ");
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/WHERE l\.status = 'approved'/);
    expect(body).toMatch(/t\.suspended_at IS NULL/);
    expect(body).not.toMatch(/referral_program/);
  });


  it("reads through the SECURITY DEFINER function, not the RLS-protected table", async () => {
    const execute = vi.fn(async (_query: SQL) => [] as unknown[]);
    const service = new AccountantDirectoryService({ db: { execute } } as unknown as DbService);
    await service.listPublic({});
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dialect.sqlToQuery(execute.mock.calls[0]![0]).sql).toBe("SELECT * FROM public_accountant_listings()");
  });

  it("is open, while the review queue needs a signed-in platform admin", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicAccountantsController) ?? []).toEqual([]);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminAccountantsController)).toEqual([JwtAuthGuard, PlatformAdminGuard]);
  });
});

describe("accountant partner tier", () => {
  it("is approved only by staff, and only for a company with an approved listing", () => {
    const partner = latestFunction("review_accountant_partner").replace(/\s+/g, " ");
    expect(partner).toMatch(/SECURITY DEFINER/);
    expect(partner).toMatch(/p_status = 'approved' AND NOT EXISTS \( SELECT 1 FROM accountant_listings WHERE tenant_id = p_tenant AND status = 'approved' \) THEN RETURN false/);
    const listing = latestFunction("review_accountant_listing").replace(/\s+/g, " ");
    // Approving a listing touches the tier only when asked to, and only a pending request.
    expect(listing).toMatch(/IF p_partner THEN/);
    expect(listing).toMatch(/WHERE tenant_id = v_tenant AND status = 'pending'/);
  });

  it("pays friend rates for an accountant flag nobody approved", () => {
    const claim = latestFunction("claim_referral").replace(/\s+/g, " ");
    expect(claim).toMatch(
      /IF v_program = 'accountant' AND NOT EXISTS \( SELECT 1 FROM accountant_partner_requests p WHERE p\.tenant_id = v_referrer AND p\.status = 'approved' \) THEN v_program := 'friend';/,
    );
  });

  it("keeps companies from approving their own request (RLS allows only 'pending')", () => {
    const sql = readFileSync(join(MIGRATIONS, "0079_referral_release_partner_requests.sql"), "utf8").replace(/\s+/g, " ");
    expect(sql).toMatch(/ALTER TABLE "accountant_partner_requests" FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/accountant_partner_requests_insert ON "accountant_partner_requests" FOR INSERT WITH CHECK \([^)]*\)::uuid AND status = 'pending'\)/);
    expect(sql).toMatch(/accountant_partner_requests_update ON "accountant_partner_requests" FOR UPDATE USING \([^)]*\)::uuid\) WITH CHECK \([^)]*\)::uuid AND status = 'pending'\)/);
  });
});

describe("PlatformAdminGuard", () => {
  const ctx = (user: { id: string; email: string } | undefined) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

  /** `select().from().where()` resolving to the queued results in call order. */
  const fakeDb = (...results: unknown[][]) => {
    const select = vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(results.shift() ?? []) }) }));
    return { db: { select } } as unknown as DbService;
  };

  afterEach(() => vi.unstubAllEnvs());

  it("refuses addresses that are not listed, without touching the database", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "staff@billanta.cz");
    const db = fakeDb();
    await expect(new PlatformAdminGuard(db).canActivate(ctx({ id: "u1", email: "owner@firma.cz" }))).rejects.toThrow();
    await expect(new PlatformAdminGuard(db).canActivate(ctx(undefined))).rejects.toThrow();
    expect((db.db.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("needs the listed address to be verified or a Google sign-in", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "staff@billanta.cz");
    const user = { id: "u1", email: "Staff@Billanta.cz" };
    const unverified = [{ email: "staff@billanta.cz", verified: null }];
    await expect(new PlatformAdminGuard(fakeDb(unverified, [])).canActivate(ctx(user))).rejects.toThrow();
    await expect(new PlatformAdminGuard(fakeDb(unverified, [{ id: "g" }])).canActivate(ctx(user))).resolves.toBe(true);
    await expect(new PlatformAdminGuard(fakeDb([{ email: "staff@billanta.cz", verified: new Date() }])).canActivate(ctx(user))).resolves.toBe(true);
  });

  it("refuses everyone when the env is unset", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
    await expect(new PlatformAdminGuard(fakeDb([{ email: "staff@billanta.cz", verified: new Date() }])).canActivate(ctx({ id: "u1", email: "staff@billanta.cz" }))).rejects.toThrow();
  });
});
