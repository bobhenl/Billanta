import { describe, expect, it } from "vitest";
import type { TaxProfile } from "@faktur/cz-compliance";
import { notificationPrefsOf } from "../notifications/notification-prefs";
import {
  dueTaxOfDp3,
  filingKey,
  filingsToCheck,
  groupByDueDay,
  recipientsFor,
  reminderCandidates,
  reminderIdempotencyKey,
  reminderStage,
  remindersToSend,
  renderVatFilingReminder,
  sentKey,
  vatKindsOf,
  vatPeriodOf,
  type FilingCheck,
  type ReminderMember,
} from "./vat-filing-reminders";

const payer: TaxProfile = { country: "CZ", vatStatus: "payer", legalEntity: false };
const company: TaxProfile = { country: "CZ", vatStatus: "payer", legalEntity: true };
const identified: TaxProfile = { country: "CZ", vatStatus: "identified", legalEntity: false };
const skPayer: TaxProfile = { country: "SK", vatStatus: "payer", legalEntity: false };
const none = new Set<string>();

// 25 Nov 2026 is a Wednesday, 25 Jan 2027 a Monday: no due day moves.
const threeDaysBefore = new Date(2026, 10, 22, 7);
const dueDay = new Date(2026, 10, 25, 7);

const filingsOf = (c: { filings: { filing: { country: string; kind: string } }[] }) => c.filings.map((f) => `${f.filing.country}:${f.filing.kind}`);

describe("reminderStage", () => {
  it("is due_day on the day, ahead 1 to 3 days before, nothing otherwise", () => {
    expect(reminderStage(0)).toBe("due_day");
    expect(reminderStage(1)).toBe("ahead");
    expect(reminderStage(3)).toBe("ahead");
    expect(reminderStage(4)).toBeNull();
    expect(reminderStage(-1)).toBeNull();
  });
});

describe("vatPeriodOf", () => {
  it("is the month before, across a year end", () => {
    expect(vatPeriodOf("vat_monthly", new Date(2027, 0, 25))).toEqual({ year: 2026, month: 12 });
    expect(vatPeriodOf("ec_sales_list", new Date(2026, 10, 25))).toEqual({ year: 2026, month: 10 });
  });

  it("is the previous quarter for a quarterly return, and nothing outside quarter months", () => {
    expect(vatPeriodOf("vat_quarterly", new Date(2027, 0, 25))).toEqual({ year: 2026, quarter: 4 });
    expect(vatPeriodOf("vat_quarterly", new Date(2026, 6, 27))).toEqual({ year: 2026, quarter: 2 });
    expect(vatPeriodOf("vat_quarterly", new Date(2026, 10, 25))).toBeNull();
  });
});

describe("reminderCandidates", () => {
  it("reminds a monthly payer of the return and KH three days ahead, always due", () => {
    const [c, ...rest] = reminderCandidates(["vat_monthly"], payer, null, threeDaysBefore, none);
    expect(rest).toHaveLength(0);
    expect(c).toMatchObject({ kind: "vat_monthly", stage: "ahead", periodKey: "2026-10" });
    expect(filingsOf(c!)).toEqual(["CZ:dp3", "CZ:kh1"]);
    expect(c!.filings.every((f) => f.always)).toBe(true);
    expect(remindersToSend([c!], new Map())).toHaveLength(1);
  });

  it("stays quiet four days ahead and the day after", () => {
    expect(reminderCandidates(["vat_monthly"], payer, null, new Date(2026, 10, 21, 7), none)).toHaveLength(0);
    expect(reminderCandidates(["vat_monthly"], payer, null, new Date(2026, 10, 26, 7), none)).toHaveLength(0);
  });

  it("sends each kind, period and stage once", () => {
    const sent = new Set([sentKey("vat_monthly", "2026-10", "ahead")]);
    expect(reminderCandidates(["vat_monthly"], payer, null, new Date(2026, 10, 23, 7), sent)).toHaveLength(0);
    const [onDay] = reminderCandidates(["vat_monthly"], payer, null, dueDay, sent);
    expect(onDay).toMatchObject({ stage: "due_day", periodKey: "2026-10" });
    sent.add(sentKey("vat_monthly", "2026-10", "due_day"));
    expect(reminderCandidates(["vat_monthly"], payer, null, dueDay, sent)).toHaveLength(0);
  });

  it("never reminds a non-payer", () => {
    const nonPayer: TaxProfile = { ...payer, vatStatus: "non_payer" };
    expect(reminderCandidates(["vat_monthly"], nonPayer, null, threeDaysBefore, none)).toHaveLength(0);
    expect(vatKindsOf(["vat_monthly", "vat_identified", "ec_sales_list"], nonPayer)).toEqual([]);
  });

  it("gives a quarterly company its return for the quarter and KH for the month", () => {
    const kinds = vatKindsOf(["vat_quarterly"], company);
    expect(kinds).toEqual(["vat_quarterly", "control_statement"]);
    const [q, ...rest] = reminderCandidates(kinds, company, null, new Date(2027, 0, 22, 7), none);
    expect(rest).toHaveLength(0);
    expect([q!.kind, q!.periodKey, filingsOf(q!)]).toEqual(["vat_quarterly", "2026-Q4", ["CZ:dp3", "CZ:kh1"]]);
    expect(q!.filings[1]!.period).toEqual({ year: 2026, month: 12 });
    // 25 Feb 2027 is a Thursday.
    const [m] = reminderCandidates(kinds, company, null, new Date(2027, 1, 22, 7), none);
    expect([m!.kind, m!.periodKey, filingsOf(m!)]).toEqual(["control_statement", "2027-01", ["CZ:kh1"]]);
  });

  it("gives a quarterly self-employed payer KH for the quarter", () => {
    const [c] = reminderCandidates(vatKindsOf(["vat_quarterly"], payer), payer, null, new Date(2027, 0, 22, 7), none);
    expect(filingsOf(c!)).toEqual(["CZ:dp3", "CZ:kh1"]);
    expect(c!.filings[1]!.period).toEqual({ year: 2026, quarter: 4 });
  });

  it("uses the Slovak filings for a Slovak payer", () => {
    const [c] = reminderCandidates(["vat_monthly"], skPayer, null, threeDaysBefore, none);
    expect(filingsOf(c!)).toEqual(["SK:dph", "SK:kv"]);
    expect(c!.filings.every((f) => f.always)).toBe(true);
  });

  it("drops kinds the company's VAT status does not have", () => {
    expect(vatKindsOf(["vat_monthly", "vat_identified", "ec_sales_list"], identified)).toEqual(["vat_identified", "ec_sales_list"]);
    expect(vatKindsOf(["vat_monthly", "vat_identified"], payer)).toEqual(["vat_monthly"]);
  });
});

describe("remindersToSend", () => {
  const candidates = reminderCandidates(["vat_identified", "ec_sales_list"], identified, null, threeDaysBefore, none);
  const dp3 = candidates[0]!.filings[0]!;
  const shv = candidates[1]!.filings[0]!;

  it("asks the export about each conditional filing", () => {
    expect(candidates.map((c) => c.kind)).toEqual(["vat_identified", "ec_sales_list"]);
    expect(filingsToCheck(candidates).map(filingKey)).toEqual(["CZ:dp3:2026-10", "CZ:shv:2026-10"]);
    expect(filingsToCheck(reminderCandidates(["vat_monthly"], payer, null, threeDaysBefore, none))).toEqual([]);
  });

  it("skips an identified person's filings in a month without activity", () => {
    const checks = new Map<string, FilingCheck>([
      [filingKey(dp3), { due: false }],
      [filingKey(shv), { due: false }],
    ]);
    expect(remindersToSend(candidates, checks)).toEqual([]);
  });

  it("skips a conditional filing whose check failed", () => {
    expect(remindersToSend(candidates, new Map())).toEqual([]);
  });

  it("keeps only the filings that are due", () => {
    const checks = new Map<string, FilingCheck>([
      [filingKey(dp3), { due: true, tax: 4200 }],
      [filingKey(shv), { due: false }],
    ]);
    const due = remindersToSend(candidates, checks);
    expect(due.map((r) => r.kind)).toEqual(["vat_identified"]);
    expect(due[0]!.due[0]!.check).toEqual({ due: true, tax: 4200 });
  });

  it("keeps a payer's return when the EC sales list is empty", () => {
    const got = reminderCandidates(["vat_monthly", "ec_sales_list"], payer, null, threeDaysBefore, none);
    const due = remindersToSend(got, new Map([[filingKey(got[1]!.filings[0]!), { due: false }]]));
    expect(due.map((r) => r.kind)).toEqual(["vat_monthly"]);
  });

  it("puts reminders due the same day into one e-mail", () => {
    const got = reminderCandidates(["vat_monthly", "ec_sales_list"], payer, null, threeDaysBefore, none);
    const due = remindersToSend(got, new Map([[filingKey(got[1]!.filings[0]!), { due: true }]]));
    expect(groupByDueDay(due).map((g) => g.map((r) => r.kind))).toEqual([["vat_monthly", "ec_sales_list"]]);
  });
});

describe("recipientsFor", () => {
  const due = remindersToSend(reminderCandidates(["vat_monthly"], payer, null, threeDaysBefore, none), new Map());
  const member = (over: Partial<ReminderMember>): ReminderMember => ({
    userId: "u",
    email: "a@x.cz",
    channels: { app: true, email: true },
    reports: "write",
    kinds: ["vat_monthly"],
    ...over,
  });

  it("mails members who can open exports, follow the kind and have e-mail on", () => {
    const members = [
      member({ userId: "ok" }),
      member({ userId: "no-reports", reports: "none" }),
      member({ userId: "email-off", channels: { app: true, email: false } }),
      member({ userId: "other-kind", kinds: ["vat_quarterly"] }),
      member({ userId: "no-address", email: null }),
    ];
    const to = recipientsFor(members, due, true);
    expect(to.email.map((m) => m.userId)).toEqual(["ok"]);
    expect(to.app.map((m) => m.userId)).toEqual(["ok", "email-off", "no-address"]);
  });

  it("mails nobody when the company may not send", () => {
    const to = recipientsFor([member({})], due, false);
    expect(to.email).toEqual([]);
    expect(to.app).toHaveLength(1);
  });

  it("is on by e-mail for the people who file, off for viewers and unknown roles", () => {
    expect(notificationPrefsOf({}, "owner").events.vat_filing_due.email).toBe(true);
    expect(notificationPrefsOf({}, "accountant").events.vat_filing_due.email).toBe(true);
    expect(notificationPrefsOf({}, "viewer").events.vat_filing_due.email).toBe(false);
    expect(notificationPrefsOf({}).events.vat_filing_due.email).toBe(false);
    expect(notificationPrefsOf({ events: { vat_filing_due: { email: false } } }, "owner").events.vat_filing_due.email).toBe(false);
  });
});

describe("dueTaxOfDp3", () => {
  it("reads the tax due from Veta6", () => {
    expect(dueTaxOfDp3('<Veta1 /><Veta6 dan_zocelk="4200" odp_zocelk="0" dano_da="4200" dano_no="0" />')).toBe(4200);
    expect(dueTaxOfDp3(null)).toBeNull();
  });
});

describe("renderVatFilingReminder", () => {
  const candidates = reminderCandidates(["vat_identified"], identified, null, threeDaysBefore, none);
  const key = filingKey(candidates[0]!.filings[0]!);
  const opts = { locale: "cs" as const, company: "Novák Design", exportsUrl: "https://x.cz/cs/settings/exports", unsubscribeUrl: "https://x.cz/u" };

  it("names the filing, period and due day, with the identified person's tax", () => {
    const [group] = groupByDueDay(remindersToSend(candidates, new Map([[key, { due: true, tax: 4200 }]])));
    const mail = renderVatFilingReminder(group!, opts);
    expect(mail.subject).toBe("Blíží se termín pro DPH (25. 11. 2026) – Novák Design");
    expect(mail.text).toContain("Do 25. 11. 2026 je potřeba podat:");
    expect(mail.text).toContain("Přiznání k DPH za říjen 2026 · daň k úhradě: 4200.00 CZK");
    expect(mail.html).toContain('href="https://x.cz/cs/settings/exports"');
    expect(mail.html).toContain('href="https://x.cz/u"');
    expect(mail.text).not.toContain("—");
  });

  it("shows a dash for the tax when a purchase is unmarked or nothing could be computed", () => {
    for (const check of [{ due: true, tax: 4200, unmarked: true }, { due: true, tax: null, sealed: true }]) {
      const [group] = groupByDueDay(remindersToSend(candidates, new Map([[key, check]])));
      const mail = renderVatFilingReminder(group!, opts);
      expect(mail.text).toContain("daň k úhradě: –");
      expect(mail.text).not.toContain("4200");
    }
  });

  it("says amounts in Confidential mode stay out, in Slovak", () => {
    const [group] = groupByDueDay(remindersToSend(candidates, new Map([[key, { due: true, tax: null, sealed: true }]])));
    const mail = renderVatFilingReminder(group!, { ...opts, locale: "sk" });
    expect(mail.text).toContain("Sumy dokladov v Dôvernom režime do e-mailu nikdy nedávame.");
    expect(mail.text).toContain("Daňové priznanie k DPH (CZ) za október 2026");
  });

  it("gives a payer's quarter without a tax line, on the due day, in English", () => {
    const got = reminderCandidates(["vat_quarterly"], payer, null, new Date(2027, 0, 25, 7), none);
    const [group] = groupByDueDay(remindersToSend(got, new Map()));
    const mail = renderVatFilingReminder(group!, { ...opts, locale: "en" });
    expect(mail.subject).toBe("VAT filing due today – Novák Design");
    expect(mail.text).toContain("VAT return for Q4 2026");
    expect(mail.text).toContain("VAT control statement for Q4 2026");
    expect(mail.text).not.toContain("tax to pay");
  });

  it("uses a new outbox key when the same day gets another reminder", () => {
    const got = reminderCandidates(["vat_monthly", "ec_sales_list"], payer, null, threeDaysBefore, none);
    const one = remindersToSend(got, new Map());
    const both = remindersToSend(got, new Map([[filingKey(got[1]!.filings[0]!), { due: true }]]));
    expect(reminderIdempotencyKey("u", one)).not.toBe(reminderIdempotencyKey("u", both));
    expect(reminderIdempotencyKey("u", one)).toBe(reminderIdempotencyKey("u", [...one]));
  });
});
