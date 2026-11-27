import { createHash } from "node:crypto";
import {
  mergeTaxDeadlines,
  relevantTaxDeadlineKinds,
  withImpliedTaxDeadlineKinds,
  type CzVatFilingKind,
  type OfficialTaxEvent,
  type SkVatFilingKind,
  type TaxDeadlineKind,
  type TaxProfile,
  type VatPeriod,
} from "@faktur/cz-compliance";
import { escapeHtml, htmlToText, unsubscribeFooterHtml, type EmailLocale } from "../email/email-render";
import { formatInvoiceAmount } from "../invoices/invoice-total.util";

/**
 * Pure part of the VAT filing reminder (vat-filing-reminders.cron.ts): which
 * deadline gets a mail today, for which periods and filings, who receives it
 * and what it says. The cron only loads data and asks the export builders
 * whether a conditional filing has anything in it.
 */

/** The deadline kinds that are a VAT filing the exports page can produce. vat_other (one-off registrations) is not. */
export const VAT_REMINDER_KINDS = ["vat_monthly", "vat_quarterly", "control_statement", "vat_identified", "ec_sales_list"] as const;
export type VatReminderKind = (typeof VAT_REMINDER_KINDS)[number];

export type ReminderStage = "ahead" | "due_day";
/** Reminders go out this many days ahead at most; a missed cron run catches up on the following days. */
export const AHEAD_DAYS = 3;

export type VatFiling = { country: "CZ"; kind: CzVatFilingKind } | { country: "SK"; kind: SkVatFilingKind };

export interface FilingPeriod {
  filing: VatFiling;
  period: VatPeriod;
  /** Due even when empty (a payer's return); otherwise only when the export says it has something in it. */
  always: boolean;
}

export interface ReminderCandidate {
  kind: VatReminderKind;
  dueDate: Date;
  stage: ReminderStage;
  /** "2026-10" or "2026-Q3": the period the reminder row is stored under. */
  periodKey: string;
  filings: FilingPeriod[];
}

/** What the export builders said about one conditional (or identified) filing. */
export interface FilingCheck {
  due: boolean;
  /** Tax to pay in whole CZK, only where it may be mailed (identified person, nothing unmarked). */
  tax?: number | null;
  /** Some documents of the period are in Confidential mode. */
  sealed?: boolean;
  /** A foreign purchase lacks its reverse-charge rate, so the tax would be wrong. */
  unmarked?: boolean;
}

export function reminderStage(daysLeft: number): ReminderStage | null {
  if (daysLeft === 0) return "due_day";
  if (daysLeft >= 1 && daysLeft <= AHEAD_DAYS) return "ahead";
  return null;
}

/**
 * The period a deadline is for: the month before the due day, or the
 * quarter before it for a quarterly return. Due days move by a few working
 * days at most, never into the next month.
 */
export function vatPeriodOf(kind: VatReminderKind, dueDate: Date): VatPeriod | null {
  const prev = new Date(dueDate.getFullYear(), dueDate.getMonth() - 1, 1);
  if (kind !== "vat_quarterly") return { year: prev.getFullYear(), month: prev.getMonth() + 1 };
  // A quarterly return falls due only in the month after a quarter ends.
  if (dueDate.getMonth() % 3 !== 0) return null;
  return { year: prev.getFullYear(), quarter: Math.floor(prev.getMonth() / 3) + 1 };
}

export function periodKey(period: VatPeriod): string {
  return "quarter" in period ? `${period.year}-Q${period.quarter}` : `${period.year}-${String(period.month).padStart(2, "0")}`;
}

const lastMonthOf = (period: VatPeriod): VatPeriod => ("quarter" in period ? { year: period.year, month: period.quarter * 3 } : period);

/** The filings behind one deadline kind, by country and VAT status. */
export function filingsFor(kind: VatReminderKind, profile: TaxProfile, period: VatPeriod): FilingPeriod[] {
  const sk = profile.country.toUpperCase() === "SK";
  if (sk) {
    switch (kind) {
      case "vat_monthly":
      case "vat_quarterly":
        // KV follows the payer's own tax period (§ 78a ods. 3 ZoDPH).
        return [
          { filing: { country: "SK", kind: "dph" }, period, always: true },
          { filing: { country: "SK", kind: "kv" }, period, always: true },
        ];
      case "vat_identified":
        return [{ filing: { country: "SK", kind: "dph" }, period, always: false }];
      case "ec_sales_list":
        return [{ filing: { country: "SK", kind: "sv" }, period, always: false }];
      case "control_statement":
        return [];
    }
  }
  switch (kind) {
    case "vat_monthly":
      return [
        { filing: { country: "CZ", kind: "dp3" }, period, always: true },
        { filing: { country: "CZ", kind: "kh1" }, period, always: true },
      ];
    case "vat_quarterly":
      // A legal entity's KH is monthly (§ 101e odst. 1 ZDPH): control_statement
      // covers the months inside the quarter, this row the quarter's last month.
      return [
        { filing: { country: "CZ", kind: "dp3" }, period, always: true },
        { filing: { country: "CZ", kind: "kh1" }, period: profile.legalEntity ? lastMonthOf(period) : period, always: true },
      ];
    case "control_statement":
      return [{ filing: { country: "CZ", kind: "kh1" }, period, always: true }];
    case "vat_identified":
      return [{ filing: { country: "CZ", kind: "dp3" }, period, always: false }];
    case "ec_sales_list":
      return [{ filing: { country: "CZ", kind: "shv" }, period, always: false }];
  }
}

/** The kinds a member follows on the dashboard, narrowed to the VAT filings their company has. */
export function vatKindsOf(chosen: readonly TaxDeadlineKind[], profile: TaxProfile): VatReminderKind[] {
  const kinds = withImpliedTaxDeadlineKinds(relevantTaxDeadlineKinds(chosen, profile), profile);
  return VAT_REMINDER_KINDS.filter((k) => kinds.includes(k));
}

export const sentKey = (kind: string, period: string, stage: ReminderStage) => `${kind}|${period}|${stage}`;
export const filingKey = (f: FilingPeriod) => `${f.filing.country}:${f.filing.kind}:${periodKey(f.period)}`;

/**
 * Deadlines of `kinds` that are 0–3 days away today and were not reminded at
 * that stage yet (`sent` holds `sentKey`s of the company's stored rows).
 */
export function reminderCandidates(
  kinds: readonly VatReminderKind[],
  profile: TaxProfile,
  official: OfficialTaxEvent[] | null,
  now: Date,
  sent: ReadonlySet<string>,
): ReminderCandidate[] {
  if (profile.vatStatus === "non_payer" || !kinds.length) return [];
  const out: ReminderCandidate[] = [];
  for (const d of mergeTaxDeadlines(kinds, official, now, AHEAD_DAYS, profile.country)) {
    const kind = d.kind as VatReminderKind;
    if (!kinds.includes(kind)) continue;
    const stage = reminderStage(d.daysLeft);
    if (!stage) continue;
    const period = vatPeriodOf(kind, d.date);
    if (!period) continue;
    const key = periodKey(period);
    if (sent.has(sentKey(kind, key, stage))) continue;
    const filings = filingsFor(kind, profile, period);
    if (!filings.length) continue;
    out.push({ kind, dueDate: d.date, stage, periodKey: key, filings });
  }
  return out;
}

/** The filings whose being due has to be asked of the export (once each, even when two kinds share one). */
export function filingsToCheck(candidates: readonly ReminderCandidate[]): FilingPeriod[] {
  const seen = new Map<string, FilingPeriod>();
  for (const c of candidates) {
    for (const f of c.filings) {
      if (!f.always && !seen.has(filingKey(f))) seen.set(filingKey(f), f);
    }
  }
  return [...seen.values()];
}

export interface DueReminder extends ReminderCandidate {
  /** Only the filings that are due, with what the check said about them. */
  due: (FilingPeriod & { check: FilingCheck | null })[];
}

/**
 * Keeps the filings that are due and the reminders with at least one. A
 * conditional filing with no check result (the export failed) counts as not
 * due, so the next run asks again instead of mailing a guess.
 */
export function remindersToSend(candidates: readonly ReminderCandidate[], checks: ReadonlyMap<string, FilingCheck>): DueReminder[] {
  const out: DueReminder[] = [];
  for (const c of candidates) {
    const due = c.filings
      .map((f) => ({ ...f, check: checks.get(filingKey(f)) ?? null }))
      .filter((f) => f.always || f.check?.due === true);
    if (due.length) out.push({ ...c, due });
  }
  return out;
}

/** One e-mail per due day and stage: a payer's return, KH and SHV on the 25th arrive together. */
export function groupByDueDay(reminders: readonly DueReminder[]): DueReminder[][] {
  const groups = new Map<string, DueReminder[]>();
  for (const r of reminders) {
    const id = `${isoDay(r.dueDate)}|${r.stage}`;
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  return [...groups.values()];
}

export interface ReminderMember {
  userId: string;
  email: string | null;
  /** From notificationPrefsOf with the member's role. */
  channels: { app: boolean; email: boolean };
  /** effectivePermissions(...).reports: the exports page sits there. */
  reports: string;
  /** vatKindsOf the member's own deadline choice. */
  kinds: readonly VatReminderKind[];
}

/** The members a group goes to, per channel: they can open the exports page and follow at least one of its kinds. */
export function recipientsFor(members: readonly ReminderMember[], group: readonly DueReminder[], mayEmail: boolean) {
  const follows = members.filter((m) => m.reports !== "none" && group.some((r) => m.kinds.includes(r.kind)));
  return {
    app: follows.filter((m) => m.channels.app),
    email: mayEmail ? follows.filter((m) => m.channels.email && !!m.email) : [],
  };
}

/** Tax due in whole CZK from a DP3 file (Veta6 dan_zocelk). */
export function dueTaxOfDp3(xml: string | null | undefined): number | null {
  const m = xml?.match(/<Veta6\b[^>]*\bdan_zocelk="(-?\d+)"/);
  return m ? Number(m[1]) : null;
}

/** Outbox key for one member and exactly these reminders, so a reminder added later the same day is not swallowed. */
export function reminderIdempotencyKey(userId: string, group: readonly DueReminder[]): string {
  const keys = group.map((r) => sentKey(r.kind, r.periodKey, r.stage)).sort().join(",");
  return `vat_filing_due:${userId}:${createHash("sha256").update(keys).digest("hex").slice(0, 24)}`;
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- rendering

const MONTHS: Record<EmailLocale, string[]> = {
  cs: ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"],
  sk: ["január", "február", "marec", "apríl", "máj", "jún", "júl", "august", "september", "október", "november", "december"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

const T: Record<
  EmailLocale,
  {
    filings: Record<string, string>;
    quarter: (q: number, y: number) => string;
    forPeriod: (p: string) => string;
    subject: (stage: ReminderStage, date: string) => string;
    intro: (stage: ReminderStage, date: string) => string;
    tax: string;
    sealed: string;
    unmarked: string;
    button: string;
    date: (d: Date) => string;
  }
> = {
  cs: {
    filings: {
      "CZ:dp3": "Přiznání k DPH",
      "CZ:kh1": "Kontrolní hlášení",
      "CZ:shv": "Souhrnné hlášení",
      "SK:dph": "Přiznání k DPH (SK)",
      "SK:kv": "Kontrolní výkaz (SK)",
      "SK:sv": "Souhrnný výkaz (SK)",
    },
    quarter: (q, y) => `${q}. čtvrtletí ${y}`,
    forPeriod: (p) => `za ${p}`,
    subject: (s, d) => (s === "due_day" ? "Dnes je termín pro DPH" : `Blíží se termín pro DPH (${d})`),
    intro: (s, d) => (s === "due_day" ? `Dnes (${d}) je poslední den pro podání:` : `Do ${d} je potřeba podat:`),
    tax: "daň k úhradě",
    sealed: "Částky dokladů v Důvěrném režimu do e-mailu nikdy nedáváme. Najdete je v aplikaci.",
    unmarked: "U některého nákupu ze zahraničí chybí sazba pro přenesení daňové povinnosti, proto daň neuvádíme. Před podáním ho zkontrolujte.",
    button: "Připravit podání",
    date: (d) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`,
  },
  sk: {
    filings: {
      "CZ:dp3": "Daňové priznanie k DPH (CZ)",
      "CZ:kh1": "Kontrolné hlásenie (CZ)",
      "CZ:shv": "Súhrnné hlásenie (CZ)",
      "SK:dph": "Daňové priznanie k DPH",
      "SK:kv": "Kontrolný výkaz",
      "SK:sv": "Súhrnný výkaz",
    },
    quarter: (q, y) => `${q}. štvrťrok ${y}`,
    forPeriod: (p) => `za ${p}`,
    subject: (s, d) => (s === "due_day" ? "Dnes je termín pre DPH" : `Blíži sa termín pre DPH (${d})`),
    intro: (s, d) => (s === "due_day" ? `Dnes (${d}) je posledný deň na podanie:` : `Do ${d} treba podať:`),
    tax: "daň na úhradu",
    sealed: "Sumy dokladov v Dôvernom režime do e-mailu nikdy nedávame. Nájdete ich v aplikácii.",
    unmarked: "Pri niektorom nákupe zo zahraničia chýba sadzba pre prenesenie daňovej povinnosti, preto daň neuvádzame. Pred podaním ho skontrolujte.",
    button: "Pripraviť podanie",
    date: (d) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`,
  },
  en: {
    filings: {
      "CZ:dp3": "VAT return",
      "CZ:kh1": "VAT control statement",
      "CZ:shv": "EC sales list",
      "SK:dph": "VAT return",
      "SK:kv": "VAT control statement",
      "SK:sv": "EC sales list",
    },
    quarter: (q, y) => `Q${q} ${y}`,
    forPeriod: (p) => `for ${p}`,
    subject: (s, d) => (s === "due_day" ? "VAT filing due today" : `VAT filing due on ${d}`),
    intro: (s, d) => (s === "due_day" ? `Today (${d}) is the last day to file:` : `Due by ${d}:`),
    tax: "tax to pay",
    sealed: "Amounts of documents in Confidential mode are never put in an e-mail. You'll find them in the app.",
    unmarked: "A purchase from abroad has no reverse-charge rate, so the tax is not shown. Check it before you file.",
    button: "Prepare the filing",
    date: (d) => `${MONTHS.en[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
  },
};

function periodLabel(period: VatPeriod, locale: EmailLocale): string {
  return "quarter" in period ? T[locale].quarter(period.quarter, period.year) : `${MONTHS[locale][period.month - 1]} ${period.year}`;
}

/** Each due filing once (a monthly payer's KH can come from two kinds), soonest kind order kept. */
function dueLines(group: readonly DueReminder[]) {
  const seen = new Set<string>();
  const lines: (FilingPeriod & { check: FilingCheck | null; identified: boolean })[] = [];
  for (const r of group) {
    for (const f of r.due) {
      if (seen.has(filingKey(f))) continue;
      seen.add(filingKey(f));
      lines.push({ ...f, identified: r.kind === "vat_identified" });
    }
  }
  return lines;
}

/** One line per filing, with the identified person's tax where it may be shown ("–" otherwise). */
export function reminderLines(group: readonly DueReminder[], locale: EmailLocale): string[] {
  const t = T[locale];
  return dueLines(group).map((f) => {
    const head = `${t.filings[`${f.filing.country}:${f.filing.kind}`]} ${t.forPeriod(periodLabel(f.period, locale))}`;
    if (!f.identified) return head;
    const tax = f.check && !f.check.unmarked && typeof f.check.tax === "number" ? formatInvoiceAmount(f.check.tax, "CZK") : "–";
    return `${head} · ${t.tax}: ${tax}`;
  });
}

export function renderVatFilingReminder(
  group: readonly DueReminder[],
  opts: { locale: EmailLocale; company: string; exportsUrl: string; unsubscribeUrl: string | null },
): { subject: string; title: string; body: string; html: string; text: string } {
  const t = T[opts.locale];
  const first = group[0]!;
  const date = t.date(first.dueDate);
  const title = t.subject(first.stage, date);
  const lines = reminderLines(group, opts.locale);
  const checks = group.flatMap((r) => r.due.map((f) => f.check)).filter((c): c is FilingCheck => !!c);
  const notes = [
    ...(checks.some((c) => c.sealed) ? [t.sealed] : []),
    ...(group.some((r) => r.kind === "vat_identified" && r.due.some((f) => f.check?.unmarked)) ? [t.unmarked] : []),
  ];
  const html = `<!doctype html><html lang="${opts.locale}"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
        <h1 style="font-size:18px;margin:0 0 12px;color:#111;">${escapeHtml(title)}</h1>
        <p style="color:#374151;margin:0 0 8px;">${escapeHtml(t.intro(first.stage, date))}</p>
        <ul style="color:#111;line-height:1.6;margin:0 0 16px;padding-left:20px;">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
        ${notes.map((n) => `<p style="color:#6b7280;font-size:13px;line-height:1.5;margin:0 0 12px;">${escapeHtml(n)}</p>`).join("")}
        <p><a href="${escapeHtml(opts.exportsUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;">${t.button}</a></p>
        ${unsubscribeFooterHtml(opts.locale, opts.unsubscribeUrl)}
      </div></body></html>`;
  return {
    subject: `${title} – ${opts.company}`,
    title,
    body: lines.join("; "),
    html,
    text: htmlToText(html),
  };
}
