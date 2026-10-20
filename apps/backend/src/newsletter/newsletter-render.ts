import { escapeHtml, htmlToText, type EmailLocale } from "../email/email-render";

/**
 * Pure rendering of the two newsletter e-mails: the double opt-in
 * confirmation and an issue. Same inline-styled card as the other e-mails
 * (email-render.ts, weekly-digest.ts).
 *
 * An issue is a commercial communication under 480/2004 Sb. § 7, so its
 * footer says so, names the sender, says why the person gets it and has a
 * one-click way out (plus List-Unsubscribe headers on the outbox row).
 */
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");

const CARD = (locale: EmailLocale, inner: string, footer: string) => `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
        ${inner}
        ${footer}
      </div></body></html>`;

const button = (url: string, label: string) =>
  `<a href="${escapeHtml(url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;">${escapeHtml(label)}</a>`;

/** Absolute http(s) URL, or a site path made absolute; anything else (javascript:, mailto:…) is refused. */
export function safeLinkUrl(raw: string): string | null {
  const url = raw.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return `${siteUrl()}${url}`;
  return /^https?:\/\/[^\s"<>]+$/i.test(url) ? url : null;
}

/** `**bold**` and `[label](url)` on already-escaped text. */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#111;">$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
      const url = safeLinkUrl(href.replace(/&amp;/g, "&"));
      return url ? `<a href="${escapeHtml(url)}" style="color:#4f46e5;">${label}</a>` : label;
    });
}

/**
 * The restricted markdown the blog uses (`## ` headings, `- ` lists,
 * **bold**, [links](https://…), blank line = new paragraph) to inline-styled
 * HTML. Everything is escaped first; no raw HTML gets through.
 */
export function markdownToEmailHtml(markdown: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul style="padding-left:18px;margin:0 0 16px;line-height:1.5;color:#374151;">${list.join("")}</ul>`);
    list = [];
  };
  const flushPara = () => {
    if (para.length) out.push(`<p style="color:#374151;line-height:1.6;margin:0 0 16px;">${para.join("<br>")}</p>`);
    para = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushPara();
    } else if (/^#{2,3} /.test(line)) {
      flushList();
      flushPara();
      out.push(`<h2 style="font-size:16px;margin:20px 0 8px;color:#111;">${inline(escapeHtml(line.replace(/^#{2,3} /, "")))}</h2>`);
    } else if (/^[-*] /.test(line)) {
      flushPara();
      list.push(`<li style="margin:0 0 6px;">${inline(escapeHtml(line.slice(2)))}</li>`);
    } else {
      flushList();
      para.push(inline(escapeHtml(line.trim())));
    }
  }
  flushList();
  flushPara();
  return out.join("\n");
}

const CONFIRM: Record<EmailLocale, { subject: string; heading: string; body: string; button: string; ignore: string }> = {
  cs: {
    subject: "Potvrďte odběr novinek Billanty",
    heading: "Potvrďte prosím odběr",
    body: "Někdo (nejspíš vy) zadal tuto adresu pro odběr novinek Billanty o změnách sazeb, limitů, daňových termínů a e-fakturace. Odběr začne, až ho potvrdíte.",
    button: "Potvrdit odběr",
    ignore: "Pokud jste to nebyli vy, e-mail ignorujte. Bez potvrzení vám nic posílat nebudeme a adresu do 30 dnů smažeme.",
  },
  sk: {
    subject: "Potvrďte odber noviniek Billanty",
    heading: "Potvrďte, prosím, odber",
    body: "Niekto (zrejme vy) zadal túto adresu na odber noviniek Billanty o zmenách sadzieb, limitov, daňových termínov a e-fakturácie. Odber sa začne, keď ho potvrdíte.",
    button: "Potvrdiť odber",
    ignore: "Ak ste to neboli vy, e-mail ignorujte. Bez potvrdenia vám nič posielať nebudeme a adresu do 30 dní vymažeme.",
  },
  en: {
    subject: "Confirm your Billanta updates subscription",
    heading: "Please confirm your subscription",
    body: "Someone (probably you) entered this address to get Billanta updates on changes to tax rates, limits, deadlines and e-invoicing. Nothing is sent until you confirm.",
    button: "Confirm subscription",
    ignore: "If this wasn't you, ignore this e-mail. Without confirmation we send nothing and delete the address within 30 days.",
  },
};

export function renderNewsletterConfirmation(locale: EmailLocale, confirmUrl: string): { subject: string; html: string; text: string } {
  const c = CONFIRM[locale];
  const html = CARD(
    locale,
    `<h1 style="font-size:18px;margin:0 0 12px;color:#111;">${c.heading}</h1>
        <p style="color:#374151;line-height:1.5;margin:0 0 20px;">${c.body}</p>
        <p>${button(confirmUrl, c.button)}</p>`,
    `<p style="color:#9ca3af;font-size:12px;margin-top:24px;">${c.ignore}</p>`,
  );
  return { subject: c.subject, html, text: htmlToText(html) };
}

const FOOTER: Record<EmailLocale, { commercial: string; why: (email: string) => string; unsubscribe: string; sender: string; privacy: string }> = {
  cs: {
    commercial: "Toto je obchodní sdělení.",
    why: (email) => `Dostáváte ho, protože jste na adrese ${email} potvrdili odběr novinek Billanty.`,
    unsubscribe: "Odhlásit odběr jedním kliknutím",
    sender: "Odesílatel: Billanta, provozovatel uvedený v",
    privacy: "Zásadách ochrany osobních údajů",
  },
  sk: {
    commercial: "Toto je obchodná komunikácia.",
    why: (email) => `Dostávate ju, pretože ste na adrese ${email} potvrdili odber noviniek Billanty.`,
    unsubscribe: "Odhlásiť odber jedným kliknutím",
    sender: "Odosielateľ: Billanta, prevádzkovateľ uvedený v",
    privacy: "Zásadách ochrany osobných údajov",
  },
  en: {
    commercial: "This is a commercial communication.",
    why: (email) => `You get it because you confirmed Billanta updates for ${email}.`,
    unsubscribe: "Unsubscribe with one click",
    sender: "Sender: Billanta, operated by the company named in the",
    privacy: "Privacy Policy",
  },
};

/** 480/2004 Sb. footer: marked as commercial, sender, why, and the way out. */
export function newsletterFooterHtml(locale: EmailLocale, email: string, unsubscribeUrl: string): string {
  const f = FOOTER[locale];
  const privacy = `${siteUrl()}/${locale}/legal/privacy`;
  return `<p style="color:#9ca3af;font-size:12px;line-height:1.5;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:16px;">
          ${f.commercial} ${escapeHtml(f.why(email))}
          <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;">${f.unsubscribe}</a>.<br>
          ${f.sender} <a href="${escapeHtml(privacy)}" style="color:#6b7280;">${f.privacy}</a>.
        </p>`;
}

export function renderNewsletterIssue(
  issue: { subject: string; body: string },
  opts: { locale: EmailLocale; email: string; unsubscribeUrl: string },
): { subject: string; html: string; text: string } {
  const html = CARD(
    opts.locale,
    `<h1 style="font-size:20px;margin:0 0 16px;color:#111;">${escapeHtml(issue.subject)}</h1>
        ${markdownToEmailHtml(issue.body)}`,
    newsletterFooterHtml(opts.locale, opts.email, opts.unsubscribeUrl),
  );
  return { subject: issue.subject.slice(0, 300), html, text: htmlToText(html) };
}
