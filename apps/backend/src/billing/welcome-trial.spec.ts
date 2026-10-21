import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bankKey,
  cardHash,
  emailKey,
  ipKey,
  phoneKey,
  signalHash,
  trialSignals,
  welcomeTrialSkip,
  type WelcomeTrialTenant,
} from "./welcome-trial";

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

describe("trial signal keys", () => {
  it("spells a bank account one way, as its IBAN", () => {
    const iban = bankKey("CZ65 0800 0000 1920 0014 5399");
    expect(iban).toBe("CZ6508000000192000145399");
    expect(bankKey("19-2000145399", "0800")).toBe(iban);
    expect(bankKey("cz6508000000192000145399")).toBe(iban);
    expect(bankKey("2000145399")).toBeNull();
    expect(bankKey("")).toBeNull();
  });

  it("folds e-mail aliases into one address", () => {
    expect(emailKey("Jan.Novak+trial@GoogleMail.com")).toBe("jannovak@gmail.com");
    expect(emailKey("jan.novak+x@firma.cz")).toBe("jan.novak@firma.cz");
    expect(emailKey("not an e-mail")).toBeNull();
  });

  it("writes a phone number with its country prefix", () => {
    expect(phoneKey("+420 777 123 456", "CZ")).toBe("420777123456");
    expect(phoneKey("00420777123456", "SK")).toBe("420777123456");
    expect(phoneKey("777 123 456", "CZ")).toBe("420777123456");
    expect(phoneKey("0905 123 456", "SK")).toBe("421905123456");
    expect(phoneKey("123", "CZ")).toBeNull();
    expect(phoneKey("030 1234567", "DE")).toBeNull();
  });

  it("keeps IPv4 whole and cuts IPv6 to its /64", () => {
    expect(ipKey("192.0.2.10")).toBe("192.0.2.10");
    expect(ipKey("::ffff:192.0.2.10")).toBe("192.0.2.10");
    expect(ipKey("2001:db8:0:1:aaaa::1")).toBe("2001:db8:0:1::/64");
    expect(ipKey("2001:0db8:0000:0001:ffff:ffff:ffff:ffff")).toBe("2001:db8:0:1::/64");
    expect(ipKey("garbage")).toBeNull();
  });

  it("hashes and deduplicates, never sending the values themselves", () => {
    const signals = trialSignals({
      country: "CZ",
      banks: [{ account: "CZ6508000000192000145399" }, { account: "19-2000145399", bankCode: "0800" }],
      emails: ["a.b@gmail.com", "ab+x@gmail.com", null],
      phones: ["777123456"],
      ips: ["192.0.2.10"],
    });
    expect(signals.map((x) => x.kind).sort()).toEqual(["bank", "email", "ip", "phone"]);
    expect(signals.find((x) => x.kind === "bank")!.hash).toBe(signalHash("bank", "CZ6508000000192000145399"));
    expect(JSON.stringify(signals)).not.toContain("192.0.2.10");
    expect(cardHash("fp_1")).toMatch(/^[0-9a-f]{64}$/);
    expect(cardHash("fp_1")).not.toBe(signalHash("bank", "fp_1"));
  });
});

// The per-IČO, per-user, per-signal and per-card rules need every company
// that ever existed, so only the SQL can check them. These keep the SQL saying so.
const policies = readFileSync(join(__dirname, "../../drizzle/rls-policies.sql"), "utf8").replace(/\r\n/g, "\n");
const migration = readFileSync(join(__dirname, "../../drizzle/migrations/0084_trial_signals.sql"), "utf8").replace(/\r\n/g, "\n");
const fnText = (name: string) => policies.slice(policies.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`), policies.indexOf(`REVOKE ALL ON FUNCTION ${name}(`));

describe("trial SQL functions", () => {
  const names = ["trial_signal_hit", "trial_record_signals", "grant_welcome_trial", "refresh_trial_signals", "extend_trial_with_card"];

  it.each(names)("%s is the same in rls-policies.sql and its migration", (name) => {
    const fn = fnText(name);
    expect(fn.length).toBeGreaterThan(0);
    expect(migration).toContain(fn.trim());
  });

  it("checks one trial per IČO, per account and per e-mail of every owner", () => {
    const fn = fnText("grant_welcome_trial");
    expect(fn).toContain("FROM trial_icos WHERE ico = v_ico");
    expect(fn).toContain("INSERT INTO trial_icos");
    expect(fn).toMatch(/c\.user_id = u\.id\s+OR c\.email_hash = /);
    expect(fn).toContain("m.role = 'owner'");
    expect(fn).toContain("INSERT INTO trial_claims");
  });

  it("withholds the no-card trial on a signal and records the company's own", () => {
    const fn = fnText("grant_welcome_trial");
    expect(fn).toContain("trial_signal_hit(");
    expect(fn).toContain("trial_withheld_at");
    expect(fn).toContain("trial_record_signals(");
    expect(fn).toContain("trial_source = 'welcome'");
  });

  it("counts a shared IP only from two other companies within 30 days", () => {
    const fn = fnText("trial_signal_hit");
    expect(fn).toContain("interval '30 days'");
    expect(fn).toMatch(/\) >= 2 THEN 'signal_ip'/);
    expect(fn).toContain("s.tenant_id <> p_tenant_id");
  });

  it("ends only a running no-card welcome trial, and never on the IP alone", () => {
    const fn = fnText("refresh_trial_signals");
    expect(fn).toContain("trial_source = 'welcome'");
    expect(fn).toMatch(/trial_signal_hit\([^)]*false\)/);
  });

  it("extends with a card once per card and keeps the per-account rule", () => {
    const fn = fnText("extend_trial_with_card");
    expect(fn).toContain("ON CONFLICT (card_hash) DO NOTHING");
    expect(fn).toContain("'card_used'");
    expect(fn).toContain("INSERT INTO trial_cards");
    expect(fn).toContain("'user_had_trial'");
    expect(fn).toContain("trial_source = 'card'");
  });

  it("never compares customers", () => {
    for (const name of names) expect(fnText(name)).not.toMatch(/\bcontacts\b/);
  });

  it("only for the company of the current request, and never at sign-up", () => {
    for (const name of ["grant_welcome_trial", "refresh_trial_signals", "extend_trial_with_card"]) {
      expect(fnText(name)).toContain("current_setting('app.current_tenant_id', true)");
    }
    const bootstrap = fnText("bootstrap_tenant_for_user");
    expect(bootstrap).not.toMatch(/trial_(claims|icos|plan|started_at|signals|cards)/);
  });

  it("keeps both tables away from the app role", () => {
    const grants = readFileSync(join(__dirname, "../../drizzle/app-role-grants.sql"), "utf8");
    expect(grants).toContain("REVOKE ALL ON trial_signals FROM faktur_app;");
    expect(grants).toContain("REVOKE ALL ON trial_cards FROM faktur_app;");
  });
});
