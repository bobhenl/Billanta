import type { OutboxItem } from "../../drizzle/schema";

/**
 * Pure rendering shared by the outbox: the plain-text part every e-mail
 * carries next to its HTML (spam filters and text-only clients both care),
 * the footer with the unsubscribe link, and the merged "several
 * notifications at once" e-mail.
 */
export type EmailLocale = "cs" | "sk" | "en";

export function emailLocaleOf(value: string | null | undefined): EmailLocale {
  return value === "sk" || value === "en" ? value : "cs";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/**
 * A readable text version of our own inline-styled HTML e-mails: links keep
 * their URL ("Zobrazit fakturu (https://…)"), block elements become line
 * breaks. Not a general HTML converter; it only has to handle what this
 * backend renders.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      const url = href.replace(/&amp;/g, "&");
      return !text || text === url ? url : `${text} (${url})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|div|tr|li|table)>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, e: string) => ENTITIES[e]!)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const FOOTER: Record<EmailLocale, { settings: string; unsubscribe: string; unsubscribeAll: string; open: string }> = {
  cs: {
    settings: "Upozornění si nastavíte v Nastavení → E-mailová upozornění.",
    unsubscribe: "Odhlásit tento typ e-mailů",
    unsubscribeAll: "Odhlásit tato upozornění",
    open: "Otevřít v Billantě",
  },
  sk: {
    settings: "Upozornenia si nastavíte v Nastavenia → E-mailové upozornenia.",
    unsubscribe: "Odhlásiť tento typ e-mailov",
    unsubscribeAll: "Odhlásiť tieto upozornenia",
    open: "Otvoriť v Billante",
  },
  en: {
    settings: "Choose which e-mails you get in Settings → Email notifications.",
    unsubscribe: "Unsubscribe from this type of e-mail",
    unsubscribeAll: "Unsubscribe from these notifications",
    open: "Open in Billanta",
  },
};

/** Footer of a notification or digest e-mail: where to change settings, plus the unsubscribe link. */
export function unsubscribeFooterHtml(locale: EmailLocale, unsubscribeUrl: string | null, several = false): string {
  const f = FOOTER[locale];
  const link = unsubscribeUrl
    ? ` <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;">${several ? f.unsubscribeAll : f.unsubscribe}</a>`
    : "";
  return `<p style="color:#9ca3af;font-size:12px;margin-top:24px;">${f.settings}${link}</p>`;
}

const BATCH: Record<EmailLocale, { subject: (n: number) => string; heading: string }> = {
  cs: { subject: (n) => `${n} ${n < 5 ? "nová upozornění" : "nových upozornění"} v Billantě`, heading: "Co se v Billantě stalo" },
  sk: { subject: (n) => `${n} ${n < 5 ? "nové upozornenia" : "nových upozornení"} v Billante`, heading: "Čo sa v Billante stalo" },
  en: { subject: (n) => `${n} new notifications in Billanta`, heading: "What happened in Billanta" },
};

/**
 * The member's notification e-mail: one item reads like it always did, two
 * or more (merged within the batching window or held over quiet hours)
 * become a short list.
 */
export function renderNotificationEmail(
  items: readonly OutboxItem[],
  opts: { locale: EmailLocale; unsubscribeUrl: string | null },
): { subject: string; html: string; text: string } {
  const f = FOOTER[opts.locale];
  const button = (url: string) =>
    `<a href="${escapeHtml(url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;">${f.open}</a>`;
  const wrap = (inner: string) => `<!doctype html><html lang="${opts.locale}"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
        ${inner}
        ${unsubscribeFooterHtml(opts.locale, opts.unsubscribeUrl, items.length > 1)}
      </div></body></html>`;

  let subject: string;
  let html: string;
  if (items.length === 1) {
    const it = items[0]!;
    subject = it.title;
    html = wrap(`<h1 style="font-size:18px;margin:0 0 12px;color:#111;">${escapeHtml(it.title)}</h1>
        ${it.body ? `<p style="color:#374151;line-height:1.5;margin:0 0 20px;">${escapeHtml(it.body)}</p>` : ""}
        ${it.url ? `<p>${button(it.url)}</p>` : ""}`);
  } else {
    subject = BATCH[opts.locale].subject(items.length);
    const rows = items
      .map(
        (it) => `<li style="margin:0 0 12px;"><strong style="color:#111;">${
          it.url ? `<a href="${escapeHtml(it.url)}" style="color:#111;">${escapeHtml(it.title)}</a>` : escapeHtml(it.title)
        }</strong>${it.body ? `<br><span style="color:#4b5563;">${escapeHtml(it.body)}</span>` : ""}</li>`,
      )
      .join("");
    html = wrap(`<h1 style="font-size:18px;margin:0 0 16px;color:#111;">${BATCH[opts.locale].heading}</h1>
        <ul style="padding-left:18px;margin:0 0 20px;line-height:1.5;font-size:14px;">${rows}</ul>`);
  }
  return { subject: subject.slice(0, 300), html, text: htmlToText(html) };
}
