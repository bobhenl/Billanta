import { accessSummary, type PermissionArea, type PermissionLevel } from "../tenancy/permissions";
import { escapeHtml, htmlToText, type EmailLocale } from "./email-render";

/**
 * The team invitation e-mail, in the inviting company's language. The
 * company name is often a person's name ("Tom Vejmelka"), so the wording
 * never puts it after a preposition ("do Tom Vejmelka" is broken Czech):
 * the company is always the one who invites.
 */
const LABELS: Record<
  EmailLocale,
  {
    subject: (company: string) => string;
    heading: string;
    intro: (company: string, role: string) => string;
    accessTitle: string;
    manage: string;
    valid: string;
    button: string;
    ignore: string;
    roles: Record<string, string>;
    areas: Record<PermissionArea, string>;
    levels: Record<PermissionLevel, string>;
  }
> = {
  cs: {
    subject: (c) => `${c} vás zve do týmu v Billantě`,
    heading: "Pozvánka do týmu v Billantě",
    intro: (c, r) => `<strong>${c}</strong> vás zve do svého týmu v aplikaci Billanta s rolí <strong>${r}</strong>.`,
    accessTitle: "K čemu budete mít přístup:",
    manage: "Můžete také spravovat tým a nastavení firmy.",
    valid: "Pozvánka platí 7 dní.",
    button: "Přijmout pozvánku",
    ignore: "Pokud jste pozvánku nečekali, e-mail ignorujte.",
    roles: { owner: "Vlastník", admin: "Administrátor", accountant: "Účetní", viewer: "Jen čtení" },
    areas: { invoices: "Faktury", contacts: "Kontakty", expenses: "Výdaje", bank: "Banka", reports: "Exporty", projects: "Projekty a čas", recurring: "Opakované faktury", settings: "Nastavení" },
    levels: { none: "bez přístupu", read: "jen čtení", write: "úpravy" },
  },
  sk: {
    subject: (c) => `${c} vás pozýva do tímu v Billante`,
    heading: "Pozvánka do tímu v Billante",
    intro: (c, r) => `<strong>${c}</strong> vás pozýva do svojho tímu v aplikácii Billanta s rolou <strong>${r}</strong>.`,
    accessTitle: "K čomu budete mať prístup:",
    manage: "Môžete tiež spravovať tím a nastavenia firmy.",
    valid: "Pozvánka platí 7 dní.",
    button: "Prijať pozvánku",
    ignore: "Ak ste pozvánku nečakali, e-mail ignorujte.",
    roles: { owner: "Vlastník", admin: "Administrátor", accountant: "Účtovník", viewer: "Len čítanie" },
    areas: { invoices: "Faktúry", contacts: "Kontakty", expenses: "Výdavky", bank: "Banka", reports: "Exporty", projects: "Projekty a čas", recurring: "Opakované faktúry", settings: "Nastavenia" },
    levels: { none: "bez prístupu", read: "len čítanie", write: "úpravy" },
  },
  en: {
    subject: (c) => `${c} invited you to their team on Billanta`,
    heading: "Team invitation on Billanta",
    intro: (c, r) => `<strong>${c}</strong> invited you to join their team on Billanta as <strong>${r}</strong>.`,
    accessTitle: "What you will have access to:",
    manage: "You can also manage the team and the company settings.",
    valid: "The invitation is valid for 7 days.",
    button: "Accept invitation",
    ignore: "If you did not expect this invitation, you can ignore this e-mail.",
    roles: { owner: "Owner", admin: "Admin", accountant: "Accountant", viewer: "Read only" },
    areas: { invoices: "Invoices", contacts: "Contacts", expenses: "Expenses", bank: "Bank", reports: "Exports", projects: "Projects and time", recurring: "Recurring invoices", settings: "Settings" },
    levels: { none: "no access", read: "read only", write: "edit" },
  },
};

export interface InvitationEmailParams {
  companyName: string;
  role: string;
  /** `tenant_invitations.permissions`: overrides of the role's defaults, null for none. */
  permissions?: unknown;
  acceptUrl: string;
  locale: EmailLocale;
}

export function renderInvitationEmail(p: InvitationEmailParams): { subject: string; html: string; text: string } {
  const l = LABELS[p.locale];
  const company = escapeHtml(p.companyName);
  const role = escapeHtml(l.roles[p.role] ?? p.role);
  const access = accessSummary(p.role, p.permissions);
  const rows = access.areas
    .map((a) => `<li>${escapeHtml(l.areas[a.area] ?? a.area)} – ${escapeHtml(l.levels[a.level])}</li>`)
    .join("");
  const url = escapeHtml(p.acceptUrl);
  const html = `<!doctype html><html lang="${p.locale}"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
        <h1 style="font-size:20px;margin:0 0 16px;color:#111;">${l.heading}</h1>
        <p style="color:#374151;line-height:1.5;">${l.intro(company, role)} ${l.valid}</p>
        <p style="color:#374151;margin:16px 0 4px;">${l.accessTitle}</p>
        <ul style="color:#374151;line-height:1.6;margin:0;padding-left:20px;font-size:14px;">${rows}</ul>
        ${access.manage ? `<p style="color:#374151;font-size:14px;margin:8px 0 0;">${l.manage}</p>` : ""}
        <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;
          text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;">${l.button}</a></p>
        <p style="color:#9ca3af;font-size:12px;word-break:break-all;">${url}</p>
        <p style="color:#6b7280;font-size:12px;">${l.ignore}</p>
      </div></body></html>`;
  return { subject: l.subject(p.companyName).slice(0, 300), html, text: htmlToText(html) };
}
