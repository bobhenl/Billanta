import { escapeHtml, htmlToText, unsubscribeFooterHtml, type EmailLocale } from "./email-render";

/**
 * The Monday digest (opt-in, Settings → E-mailová upozornění): what is still
 * unpaid, what is overdue, what was paid last week and which tax deadlines
 * come in the next two weeks. Plain HTML on purpose: it should read like a
 * note, not a newsletter.
 */
export interface DigestInvoice {
  number: string;
  customer: string | null;
  /** Formatted, e.g. "12 100,00 Kč". */
  amount: string;
  date: Date | null;
  url: string;
}

export interface DigestData {
  companyName: string;
  /** Formatted sums per currency. */
  unpaidTotals: string[];
  unpaidCount: number;
  overdue: DigestInvoice[];
  overdueCount: number;
  paid: DigestInvoice[];
  paidTotals: string[];
  deadlines: { label: string; date: Date; conditional?: boolean }[];
  dashboardUrl: string;
  unsubscribeUrl: string | null;
}

const T: Record<EmailLocale, Record<string, string>> = {
  cs: {
    subject: "Týdenní přehled",
    hello: "Přehled za uplynulý týden a co vás čeká.",
    unpaid: "Neuhrazené faktury",
    unpaidLine: "Neuhrazeno celkem",
    noneUnpaid: "Všechny faktury jsou uhrazené.",
    overdue: "Po splatnosti",
    overdueMore: "a další",
    noneOverdue: "Nic není po splatnosti.",
    paid: "Uhrazeno za posledních 7 dní",
    nonePaid: "Minulý týden nepřišla žádná platba.",
    deadlines: "Daňové termíny v příštích 14 dnech",
    noneDeadlines: "Žádné termíny v nejbližších dvou týdnech.",
    onlyIf: "jen pokud se vás týká",
    due: "splatnost",
    paidOn: "uhrazeno",
    open: "Otevřít Billantu",
    invoices: "faktur",
  },
  sk: {
    subject: "Týždenný prehľad",
    hello: "Prehľad za uplynulý týždeň a čo vás čaká.",
    unpaid: "Neuhradené faktúry",
    unpaidLine: "Neuhradené spolu",
    noneUnpaid: "Všetky faktúry sú uhradené.",
    overdue: "Po splatnosti",
    overdueMore: "a ďalšie",
    noneOverdue: "Nič nie je po splatnosti.",
    paid: "Uhradené za posledných 7 dní",
    nonePaid: "Minulý týždeň neprišla žiadna platba.",
    deadlines: "Daňové termíny v najbližších 14 dňoch",
    noneDeadlines: "Žiadne termíny v najbližších dvoch týždňoch.",
    onlyIf: "len ak sa vás týka",
    due: "splatnosť",
    paidOn: "uhradené",
    open: "Otvoriť Billantu",
    invoices: "faktúr",
  },
  en: {
    subject: "Weekly summary",
    hello: "Last week at a glance, and what's coming up.",
    unpaid: "Unpaid invoices",
    unpaidLine: "Unpaid in total",
    noneUnpaid: "All invoices are paid.",
    overdue: "Overdue",
    overdueMore: "and more",
    noneOverdue: "Nothing is overdue.",
    paid: "Paid in the last 7 days",
    nonePaid: "No payments came in last week.",
    deadlines: "Tax deadlines in the next 14 days",
    noneDeadlines: "No deadlines in the next two weeks.",
    onlyIf: "only if it applies to you",
    due: "due",
    paidOn: "paid",
    open: "Open Billanta",
    invoices: "invoices",
  },
};

const DATE_LOCALE: Record<EmailLocale, string> = { cs: "cs-CZ", sk: "sk-SK", en: "en-GB" };

/** Nothing to report: no digest that week. */
export function digestIsEmpty(d: DigestData): boolean {
  return d.unpaidCount === 0 && d.paid.length === 0 && d.deadlines.length === 0;
}

export function renderWeeklyDigest(d: DigestData, locale: EmailLocale): { subject: string; html: string; text: string } {
  const t = T[locale];
  const date = (v: Date) => v.toLocaleDateString(DATE_LOCALE[locale], { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Prague" });
  const h2 = (s: string) => `<h2 style="font-size:15px;margin:24px 0 8px;color:#111;">${escapeHtml(s)}</h2>`;
  const muted = (s: string) => `<p style="color:#6b7280;margin:0;">${escapeHtml(s)}</p>`;
  const row = (i: DigestInvoice, dateLabel: string) =>
    `<li style="margin:0 0 6px;"><a href="${escapeHtml(i.url)}" style="color:#111;">${escapeHtml(i.number)}</a>${
      i.customer ? ` · ${escapeHtml(i.customer)}` : ""
    } · <strong>${escapeHtml(i.amount)}</strong>${i.date ? ` <span style="color:#6b7280;">(${dateLabel} ${date(i.date)})</span>` : ""}</li>`;
  const list = (items: string[]) => `<ul style="padding-left:18px;margin:0;line-height:1.5;">${items.join("")}</ul>`;

  const sections: string[] = [];
  sections.push(h2(t.unpaid!));
  sections.push(
    d.unpaidCount
      ? `<p style="margin:0;">${t.unpaidLine}: <strong>${d.unpaidTotals.map(escapeHtml).join(" + ")}</strong> (${d.unpaidCount} ${t.invoices})</p>`
      : muted(t.noneUnpaid!),
  );
  if (d.unpaidCount) {
    sections.push(h2(`${t.overdue} (${d.overdueCount})`));
    sections.push(
      d.overdue.length
        ? list(d.overdue.map((i) => row(i, t.due!))) +
            (d.overdueCount > d.overdue.length ? `<p style="color:#6b7280;margin:4px 0 0;">${t.overdueMore} ${d.overdueCount - d.overdue.length}…</p>` : "")
        : muted(t.noneOverdue!),
    );
  }
  sections.push(h2(t.paid!));
  sections.push(
    d.paid.length
      ? `<p style="margin:0 0 6px;"><strong>${d.paidTotals.map(escapeHtml).join(" + ")}</strong></p>` + list(d.paid.map((i) => row(i, t.paidOn!)))
      : muted(t.nonePaid!),
  );
  sections.push(h2(t.deadlines!));
  sections.push(
    d.deadlines.length
      ? list(
          d.deadlines.map(
            (x) =>
              `<li style="margin:0 0 6px;"><strong>${date(x.date)}</strong> · ${escapeHtml(x.label)}${
                x.conditional ? ` <span style="color:#6b7280;">(${t.onlyIf})</span>` : ""
              }</li>`,
          ),
        )
      : muted(t.noneDeadlines!),
  );

  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;font-size:14px;color:#374151;">
        <h1 style="font-size:18px;margin:0 0 6px;color:#111;">${escapeHtml(t.subject!)} – ${escapeHtml(d.companyName)}</h1>
        <p style="margin:0;color:#6b7280;">${t.hello}</p>
        ${sections.join("\n        ")}
        <p style="margin:28px 0 0;"><a href="${escapeHtml(d.dashboardUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;">${t.open}</a></p>
        ${unsubscribeFooterHtml(locale, d.unsubscribeUrl)}
      </div></body></html>`;
  return { subject: `${t.subject}: ${d.companyName}`.slice(0, 300), html, text: htmlToText(html) };
}
