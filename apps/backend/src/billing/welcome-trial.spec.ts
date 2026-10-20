import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { welcomeTrialSkip, type WelcomeTrialTenant } from "./welcome-trial";

// 27074358 and 00177041 pass the IČO checksum; 27074359 does not.
const company: WelcomeTrialTenant = { ico: "27074358", isDemo: false, classroomClassId: null, trialStartedAt: null };

describe("welcomeTrialSkip", () => {
  it("lets a real company with a valid IČO through to the register check", () => {
    expect(welcomeTrialSkip(company, 14)).toBeNull();
    expect(welcomeTrialSkip({ ...company, ico: "00177041" }, 14)).toBeNull();
  });

  it("gives nothing when the trial is switched off", () => {
    expect(welcomeTrialSkip(company, 0)).toBe("trial_off");
  });

  it("waits for an IČO instead of granting at sign-up", () => {
    expect(welcomeTrialSkip({ ...company, ico: null }, 14)).toBe("no_ico");
    expect(welcomeTrialSkip({ ...company, ico: "" }, 14)).toBe("no_ico");
  });

  it("refuses an IČO that can't exist", () => {
    expect(welcomeTrialSkip({ ...company, ico: "27074359" }, 14)).toBe("invalid_ico");
    expect(welcomeTrialSkip({ ...company, ico: "1234" }, 14)).toBe("invalid_ico");
    expect(welcomeTrialSkip({ ...company, ico: "2707435a" }, 14)).toBe("invalid_ico");
  });

  it("gives a company only one trial, a promo code's counts too", () => {
    expect(welcomeTrialSkip({ ...company, trialStartedAt: new Date("2026-01-01") }, 14)).toBe("tenant_had_trial");
  });

  it("never gives one to demo or classroom companies", () => {
    expect(welcomeTrialSkip({ ...company, isDemo: true }, 14)).toBe("not_eligible");
    expect(welcomeTrialSkip({ ...company, classroomClassId: "c1" }, 14)).toBe("not_eligible");
  });
});

// The per-IČO, per-user and per-e-mail rules need every company that ever
// existed, so only the SQL can check them. These keep the SQL saying so.
describe("grant_welcome_trial", () => {
  const sql = readFileSync(join(__dirname, "../../drizzle/rls-policies.sql"), "utf8");
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION grant_welcome_trial("), sql.indexOf("REVOKE ALL ON FUNCTION grant_welcome_trial"));
  const migration = readFileSync(join(__dirname, "../../drizzle/migrations/0082_trial_per_ico.sql"), "utf8");

  it("is the same function in rls-policies.sql and its migration", () => {
    expect(fn.length).toBeGreaterThan(0);
    expect(migration.replace(/\r\n/g, "\n")).toContain(fn.replace(/\r\n/g, "\n").trim());
  });

  it("checks one trial per IČO, per account and per e-mail of every owner", () => {
    expect(fn).toContain("FROM trial_icos WHERE ico = v_ico");
    expect(fn).toContain("INSERT INTO trial_icos");
    expect(fn).toMatch(/c\.user_id = u\.id\s+OR c\.email_hash = /);
    expect(fn).toContain("m.role = 'owner'");
    expect(fn).toContain("INSERT INTO trial_claims");
  });

  it("only for the company of the current request, and never at sign-up", () => {
    expect(fn).toContain("current_setting('app.current_tenant_id', true)");
    const bootstrap = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION bootstrap_tenant_for_user("), sql.indexOf("REVOKE ALL ON FUNCTION bootstrap_tenant_for_user"));
    expect(bootstrap).not.toMatch(/trial_(claims|icos|plan|started_at)/);
  });
});
