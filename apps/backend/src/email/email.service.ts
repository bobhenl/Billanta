import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { fillTemplate } from "../tenants/email-prefs";
import { clientPortalUrlOf, portalUrlOf } from "../tenants/template-vars";
import { emailLocaleOf, escapeHtml, htmlToText, type EmailLocale } from "./email-render";
import { renderInvitationEmail, type InvitationEmailParams } from "./invitation-email";
import { EmailOutboxService, type OutgoingEmail, type QueueContext } from "./email-outbox.service";
import type { BrandCredit } from "../invoices/brand-credit";

export interface SendInvoiceEmailParams {
  to: string;
  invoiceNumber: string;
  /** Pre-formatted for display, e.g. "1815.00 CZK" — see `invoice-total.util.ts`. */
  amount: string;
  dueDate: Date | null;
  /** The /i/ path segment from `invoiceLinkOf` (readable prefix + key), used to build the client-portal link. */
  publicLink: string;
  /** The /c/ segment from `clientPortalLinkOf` when the customer has the portal on; adds an "all your documents" link. */
  clientPortalLink?: string | null;
  /** The company's own wording, sender name and attachments (Settings → E-maily). */
  custom?: EmailCustomization;
  /** The customer already has this invoice and it was edited since: say it replaces the earlier copy. */
  corrected?: boolean;
  /** The "Vystaveno v Billantě" line under the card; null when the company switched it off (invoices/brand-credit.ts). */
  credit?: BrandCredit | null;
  /** The document's language (`invoices.language`); the customer reads the e-mail in it. Defaults to Czech. */
  language?: string | null;
  /** `invoices.document_type`; a credit note gets its own wording, since it asks for no payment. */
  documentType?: string | null;
  /** Its own row, so the customer can pay from the e-mail alone. */
  variableSymbol?: string | null;
  /** PNG of the payment QR (SPAYD / PAY by square), shown inline as `cid:payment-qr`. */
  paymentQr?: Buffer | null;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  /** An inline image the HTML shows as `cid:<id>`; not listed among the attachments. */
  contentId?: string;
}

export interface EmailCustomization {
  subject?: string | null;
  message?: string | null;
  signature?: string | null;
  fromName?: string | null;
  replyTo?: string | null;
  bcc?: string | null;
  accent?: string;
  companyName?: string;
  customerName?: string;
  /** Settings → Proměnné plus the document's built-ins (`tenants/template-vars.ts`). */
  vars?: Record<string, string>;
  attachments?: EmailAttachment[];
}

interface SendOptions {
  fromName?: string | null;
  replyTo?: string | null;
  bcc?: string | null;
  attachments?: EmailAttachment[];
}

/** Where and how an e-mail is queued (see `QueueContext`); the key makes a retried action safe. */
export interface EmailQueueOptions extends QueueContext {
  idempotencyKey?: string;
  userId?: string | null;
}

/** A claimed outbox row, ready for Resend. */
export interface DeliverableEmail {
  id: string;
  recipient: string;
  fromName: string | null;
  replyTo: string | null;
  bcc: string | null;
  subject: string;
  html: string;
  textBody: string;
  headers: Record<string, string>;
  attachments: { filename: string; contentType?: string; content: string; contentId?: string }[] | null;
}

export type DeliveryResult =
  | { ok: true; providerId: string | null }
  | { ok: false; statusCode: number | null; name: string; message: string };

export interface SendPaymentReminderEmailParams extends SendInvoiceEmailParams {
  /** 1-based — "this is reminder #N for this invoice." */
  reminderCount: number;
}

/**
 * Thin wrapper around Resend for the two transactional emails this backend
 * sends: "here is your invoice" (`InvoicesController`'s `POST .../:id/send`)
 * and "this invoice is overdue" (`InvoiceRemindersCron`, daily digest).
 *
 * Not part of the original blueprint §2 stack table — added for this
 * feature the same way `stripe` is a direct SDK dependency for billing.
 * Resend was chosen over Postmark/SES for MVP simplicity (simple API,
 * generous free tier, no AWS account/SES sandbox approval wait).
 *
 * ============================================================================
 * Confidence note on the Resend API shape used below — read before trusting
 * this blindly, same standard this codebase already holds `GopayClient` to.
 * ============================================================================
 * VERIFIED for real: `new Resend(apiKey)` and
 * `resend.emails.send({ from, to, subject, html })` returning
 * `{ data: { id: string } | null, error: { name, message, statusCode } | null,
 * headers }` — confirmed against the actual published type declarations of
 * `resend@6.26.0` (fetched from `https://unpkg.com/resend@6.26.0/dist/index.d.mts`
 * while writing this file), not recalled from memory or guessed.
 *
 * NOT verified: an actual live send against a real Resend account/domain —
 * no API key or network credential was available in this task, so delivery
 * behavior, domain-verification requirements, and rate limits are
 * unconfirmed in practice. Treat this as "real, type-correct integration
 * code against Resend's real SDK shape," not as "tested against production
 * Resend."
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string | undefined;

  constructor(
    config: ConfigService,
    private readonly outbox: EmailOutboxService,
  ) {
    const apiKey = config.get<string>("RESEND_API_KEY");
    this.fromAddress = config.get<string>("EMAIL_FROM");
    // Constructed tolerant-of-missing-key rather than throwing at boot, so
    // the rest of the app (tests, local dev before Resend is configured)
    // doesn't hard-fail on startup. Everything is queued in the outbox
    // either way; the worker leaves it waiting while unconfigured.
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  isConfigured(): boolean {
    return Boolean(this.resend && this.fromAddress);
  }

  async sendInvoiceEmail(params: SendInvoiceEmailParams, queue: EmailQueueOptions): Promise<void> {
    await this.queue(buildInvoiceEmail(params), queue);
  }

  async sendPaymentReminderEmail(params: SendPaymentReminderEmailParams, queue: EmailQueueOptions): Promise<void> {
    await this.queue(buildPaymentReminderEmail(params), queue);
  }

  /**
   * Sends at once, past the outbox queue, an e-mail whose attachment must not
   * be stored: the PDF of an encrypted document that a member's browser
   * rendered. It goes through `EmailOutboxService.sendNow`, so the demo drop,
   * the suppression list and the history apply as for queued mail, while the
   * attachment content is never written. Throws when Resend refuses, so the
   * member is told instead of the send being assumed.
   */
  sendNow(email: OutgoingEmail, queue: EmailQueueOptions): Promise<"sent" | "skipped" | "suppressed"> {
    const row = { ...email, userId: queue.userId ?? null, ...(queue.idempotencyKey ? { idempotencyKey: queue.idempotencyKey } : {}) };
    return this.outbox.sendNow(row, { tenantId: queue.tenantId, db: queue.db }, (deliverable) => this.deliver(deliverable));
  }

  /**
   * A security alert to a member (payout account changed, …): goes out at
   * once, ignores quiet hours and preferences, no unsubscribe link. Ordinary
   * notifications go through `EmailOutboxService.enqueueNotification` instead.
   */
  async sendSecurityAlertEmail(
    params: { to: string; title: string; body?: string | null; url?: string | null; lang?: string | null },
    queue: EmailQueueOptions,
  ) {
    await this.queue(
      { kind: "security_alert", category: "transactional", to: params.to, subject: params.title, html: simpleMessageHtml(params) },
      queue,
    );
  }

  /**
   * Trial ending, plan paid, prepaid period ending: to owners and admins,
   * transactional like a security alert. `details` is a label/value table
   * (payment details for a renewal proforma), `attachments` its QR code.
   */
  async sendBillingNoticeEmail(
    params: {
      to: string;
      title: string;
      body?: string | null;
      url?: string | null;
      lang?: string;
      details?: BillingNoticeDetail[];
      attachments?: EmailAttachment[];
    },
    queue: EmailQueueOptions,
  ) {
    await this.queue(
      {
        kind: "billing_notice",
        category: "transactional",
        to: params.to,
        subject: params.title,
        html: simpleMessageHtml(params),
        ...(params.attachments?.length ? { attachments: params.attachments } : {}),
      },
      queue,
    );
  }

  /**
   * Billanta's own mail to staff (abuse reports): there is no tenant, so no
   * outbox. Sent directly when Resend is configured, otherwise only logged.
   */
  async sendPlatformEmail(params: { to: string; title: string; body?: string | null }) {
    if (!this.resend || !this.fromAddress) {
      this.logger.warn(`E-mail is not configured, staff e-mail "${params.title}" not sent`);
      return;
    }
    const html = simpleMessageHtml(params);
    const { error } = await this.resend.emails.send({ from: this.fromAddress, to: params.to, subject: params.title, html, text: htmlToText(html) });
    if (error) throw new Error(`Resend send failed (${error.name}): ${error.message}`);
  }

  /**
   * "Doplňte prosím své fakturační údaje" – the buyer-details link for a
   * draft (BuyerDetailsService), in the draft's language: the customer reads
   * the invoice in it, so they read this request in it too.
   */
  async sendBuyerDetailsRequestEmail(
    params: { to: string; companyName: string; amount: string; url: string; replyTo?: string | null; language?: string | null },
    queue: EmailQueueOptions,
  ) {
    const lang = emailLocaleOf(params.language);
    const l = BUYER_DETAILS_LABELS[lang];
    const html = `<!doctype html><html lang="${lang}"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
        <h1 style="font-size:18px;margin:0 0 12px;color:#111;">${l.heading}</h1>
        <p style="color:#374151;line-height:1.5;margin:0 0 12px;">${l.body(escapeHtml(params.companyName), escapeHtml(params.amount))}</p>
        <p style="margin:20px 0;"><a href="${escapeHtml(params.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;">${l.button}</a></p>
        <p style="color:#9ca3af;font-size:12px;word-break:break-all;">${escapeHtml(params.url)}</p>
        <p style="color:#9ca3af;font-size:12px;margin-top:16px;">${l.ignore}</p>
      </div></body></html>`;
    await this.queue(
      {
        kind: "buyer_details_request",
        category: "transactional",
        to: params.to,
        subject: l.subject(params.companyName),
        html,
        fromName: params.companyName,
        replyTo: params.replyTo ?? null,
      },
      queue,
    );
  }

  /** "<company> invited you to their team" – Settings → Team, in the inviting company's language. */
  async sendInvitationEmail(params: InvitationEmailParams & { to: string }, queue: EmailQueueOptions) {
    const { subject, html, text } = renderInvitationEmail(params);
    await this.queue({ kind: "team_invitation", category: "transactional", to: params.to, subject, html, text }, queue);
  }

  private async queue(email: OutgoingEmail, queue: EmailQueueOptions): Promise<void> {
    const row = { ...email, userId: queue.userId ?? null, ...(queue.idempotencyKey ? { idempotencyKey: queue.idempotencyKey } : {}) };
    const ctx = { tenantId: queue.tenantId, db: queue.db };
    await this.outbox.enqueue(row, ctx);
  }

  /**
   * One delivery attempt for a claimed outbox row (`EmailOutboxWorker`).
   * The row id is Resend's idempotency key, so a retry after a timeout whose
   * send actually went through doesn't mail the customer twice.
   */
  async deliver(row: DeliverableEmail): Promise<DeliveryResult> {
    if (!this.resend || !this.fromAddress) {
      return { ok: false, statusCode: null, name: "not_configured", message: "RESEND_API_KEY and EMAIL_FROM must both be set" };
    }
    try {
      const { data, error } = await this.resend.emails.send(
        {
          from: withDisplayName(this.fromAddress, row.fromName),
          to: row.recipient,
          subject: row.subject,
          html: row.html,
          text: row.textBody,
          ...(Object.keys(row.headers ?? {}).length ? { headers: row.headers } : {}),
          ...(row.replyTo ? { replyTo: row.replyTo } : {}),
          ...(row.bcc ? { bcc: row.bcc } : {}),
          ...(row.attachments?.length
            ? { attachments: row.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, ...(a.contentId ? { contentId: a.contentId } : {}) })) }
            : {}),
        },
        { idempotencyKey: `outbox-${row.id}` },
      );
      if (error) return { ok: false, statusCode: error.statusCode ?? null, name: error.name, message: error.message };
      return { ok: true, providerId: data?.id ?? null };
    } catch (err) {
      // Network failure or timeout: worth another attempt.
      return { ok: false, statusCode: null, name: "network_error", message: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * The invoice e-mail. `pdfFollowUp`: the PDF of an encrypted document, sent after
 * the link e-mail once a member's browser rendered it (vault/vault-email-queue.service.ts).
 */
export function buildInvoiceEmail(params: SendInvoiceEmailParams, opts: { pdfFollowUp?: boolean } = {}): OutgoingEmail {
  const lang = emailLangOf(params.language);
  const l = EMAIL_LABELS[lang];
  const creditNote = params.documentType === "credit_note";
  const n = params.invoiceNumber;
  const values = placeholderValues(params);
  const c = params.custom;
  const custom = c?.subject ? fillTemplate(c.subject, values) : null;
  const subject = opts.pdfFollowUp
    ? l.pdfFollowUpSubject(n)
    : params.corrected
      ? custom
        ? `${l.correctionPrefix} ${custom}`
        : l.correctedSubject(n)
      : (custom ?? (creditNote ? l.creditNoteSubject(n) : l.invoiceSubject(n)));
  const html = renderInvoiceEmailHtml({
    lang,
    creditNote,
    heading: opts.pdfFollowUp ? l.pdfFollowUpSubject(n) : params.corrected ? l.correctedSubject(n) : creditNote ? l.creditNoteSubject(n) : l.invoiceHeading(n),
    intro: opts.pdfFollowUp
      ? l.pdfFollowUpIntro
      : c?.message
        ? (params.corrected ? `${l.correctedNote}

` : "") + fillTemplate(c.message, values)
        : params.corrected
          ? l.correctedNote
          : creditNote
            ? l.creditNoteIntro
            : l.invoiceIntro,
    invoiceNumber: params.invoiceNumber,
    amount: params.amount,
    dueDate: params.dueDate,
    variableSymbol: params.variableSymbol,
    paymentQr: Boolean(params.paymentQr),
    publicLink: params.publicLink,
    clientPortalLink: params.clientPortalLink,
    signature: c?.signature ? fillTemplate(c.signature, values) : undefined,
    accent: c?.accent,
    attachmentNames: c?.attachments?.filter((a) => !a.contentId).map((a) => a.filename),
    credit: params.credit,
  });
  return { kind: "invoice", category: "transactional", to: params.to, subject, html, ...sendOptions(c, params.paymentQr) };
}

export function buildPaymentReminderEmail(params: SendPaymentReminderEmailParams): OutgoingEmail {
  const lang = emailLangOf(params.language);
  const l = EMAIL_LABELS[lang];
  const values = { ...placeholderValues(params), reminder_no: String(params.reminderCount) };
  const c = params.custom;
  const subject = c?.subject ? fillTemplate(c.subject, values) : l.reminderSubject(params.invoiceNumber);
  const html = renderInvoiceEmailHtml({
    lang,
    creditNote: false,
    heading: l.reminderHeading(params.invoiceNumber),
    intro: c?.message
      ? fillTemplate(c.message, values)
      : params.reminderCount > 1
        ? l.reminderAgain(params.reminderCount)
        : l.reminderFirst,
    invoiceNumber: params.invoiceNumber,
    amount: params.amount,
    dueDate: params.dueDate,
    variableSymbol: params.variableSymbol,
    paymentQr: Boolean(params.paymentQr),
    publicLink: params.publicLink,
    clientPortalLink: params.clientPortalLink,
    signature: c?.signature ? fillTemplate(c.signature, values) : undefined,
    accent: c?.accent,
    attachmentNames: c?.attachments?.filter((a) => !a.contentId).map((a) => a.filename),
    credit: params.credit,
  });
  return { kind: "reminder", category: "transactional", to: params.to, subject, html, ...sendOptions(c, params.paymentQr) };
}

/** The QR goes along as an inline image (`cid:payment-qr`), after the company's own attachments. */
function sendOptions(c: SendOptions | undefined, paymentQr?: Buffer | null): Pick<OutgoingEmail, "fromName" | "replyTo" | "bcc" | "attachments"> {
  const qr = paymentQr ? [{ filename: "qr-platba.png", content: paymentQr, contentType: "image/png", contentId: PAYMENT_QR_CID }] : [];
  const attachments = [...(c?.attachments ?? []), ...qr];
  return { fromName: c?.fromName ?? null, replyTo: c?.replyTo ?? null, bcc: c?.bcc ?? null, attachments: attachments.length ? attachments : c?.attachments };
}

const PAYMENT_QR_CID = "payment-qr";

export interface BillingNoticeDetail {
  label: string;
  value: string;
}

const BUYER_DETAILS_LABELS: Record<
  EmailLocale,
  { subject: (company: string) => string; heading: string; body: (company: string, amount: string) => string; button: string; ignore: string }
> = {
  cs: {
    subject: (c) => `${c}: doplňte prosím své fakturační údaje`,
    heading: "Doplňte prosím své fakturační údaje",
    body: (c, a) =>
      `<strong>${c}</strong> pro vás připravuje fakturu na <strong>${a}</strong>. Aby byla vystavená správně, vyplňte prosím, na koho má znít – název nebo jméno, adresu a případně IČO a DIČ. Zabere to minutu.`,
    button: "Doplnit údaje",
    ignore: "Pokud jste nic neobjednávali, e-mail ignorujte.",
  },
  sk: {
    subject: (c) => `${c}: doplňte, prosím, svoje fakturačné údaje`,
    heading: "Doplňte, prosím, svoje fakturačné údaje",
    body: (c, a) =>
      `<strong>${c}</strong> pre vás pripravuje faktúru na <strong>${a}</strong>. Aby bola vystavená správne, vyplňte, prosím, na koho má znieť – názov alebo meno, adresu a prípadne IČO a DIČ. Zaberie to minútu.`,
    button: "Doplniť údaje",
    ignore: "Ak ste nič neobjednávali, e-mail ignorujte.",
  },
  en: {
    subject: (c) => `${c}: please fill in your billing details`,
    heading: "Please fill in your billing details",
    body: (c, a) =>
      `<strong>${c}</strong> is preparing an invoice for you for <strong>${a}</strong>. So that it is issued correctly, please fill in who it should be addressed to – the name, the address and, if you have them, the company and VAT numbers. It takes a minute.`,
    button: "Fill in the details",
    ignore: "If you did not order anything, you can ignore this e-mail.",
  },
};

const OPEN_IN_APP: Record<string, string> = { cs: "Otevřít v Billantě", sk: "Otvoriť v Billante", en: "Open in Billanta" };

function simpleMessageHtml(params: { title: string; body?: string | null; url?: string | null; lang?: string | null; details?: BillingNoticeDetail[] }): string {
  const lang = emailLocaleOf(params.lang);
  const rows = (params.details ?? [])
    .map(
      (d) =>
        `<tr><td style="color:#6b7280;padding:4px 16px 4px 0;vertical-align:top;">${escapeHtml(d.label)}</td><td style="color:#111;padding:4px 0;font-weight:bold;">${escapeHtml(d.value)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="${lang}"><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
        <h1 style="font-size:18px;margin:0 0 12px;color:#111;">${escapeHtml(params.title)}</h1>
        ${params.body ? `<p style="color:#374151;line-height:1.5;margin:0 0 20px;">${escapeHtml(params.body)}</p>` : ""}
        ${rows ? `<table style="font-size:14px;border-collapse:collapse;margin:0 0 20px;">${rows}</table>` : ""}
        ${params.url ? `<p><a href="${escapeHtml(params.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;">${OPEN_IN_APP[lang]}</a></p>` : ""}
      </div></body></html>`;
}

/**
 * Real (not placeholder) inline HTML template shared by both email kinds —
 * a dedicated templating engine is deliberately not introduced for two
 * emails this simple.
 *
 * The client-portal link is built from `NEXT_PUBLIC_SITE_URL` (already
 * defined in the root `.env.example` for the frontend's canonical origin —
 * see `apps/frontend/lib/site.ts` — reused here rather than inventing a
 * second site-URL env var) plus `/i/${publicLink}`, per this feature's
 * brief. No client-portal page at that route exists in the frontend yet
 * (that's a separate, concurrently-built module) — this is the URL contract
 * that page is expected to implement.
 */
type EmailLang = EmailLocale;
const emailLangOf = emailLocaleOf;

/** Wording of the invoice and reminder e-mails per document language. */
const EMAIL_LABELS: Record<
  EmailLang,
  {
    invoiceSubject: (n: string) => string;
    invoiceHeading: (n: string) => string;
    invoiceIntro: string;
    creditNoteSubject: (n: string) => string;
    creditNoteIntro: string;
    correctedSubject: (n: string) => string;
    correctionPrefix: string;
    correctedNote: string;
    reminderSubject: (n: string) => string;
    reminderHeading: (n: string) => string;
    reminderFirst: string;
    reminderAgain: (count: number) => string;
    invoiceNumber: string;
    documentNumber: string;
    amount: string;
    dueDate: string;
    variableSymbol: string;
    scanToPay: string;
    pdfFollowUpSubject: (n: string) => string;
    pdfFollowUpIntro: string;
    notStated: string;
    viewInvoice: string;
    viewDocument: string;
    allDocuments: string;
    attachments: string;
    unexpected: string;
    report: string;
    dateLocale: string;
  }
> = {
  cs: {
    invoiceSubject: (n) => `Faktura ${n}`,
    invoiceHeading: (n) => `Nová faktura ${n}`,
    invoiceIntro: "Byla vám vystavena nová faktura. Podrobnosti a možnosti úhrady najdete níže.",
    creditNoteSubject: (n) => `Opravný daňový doklad ${n}`,
    creditNoteIntro: "Posíláme vám opravný daňový doklad, který snižuje částku původní faktury. Podrobnosti najdete níže.",
    correctedSubject: (n) => `Opravená faktura ${n}`,
    correctionPrefix: "Oprava:",
    correctedNote: "Posíláme opravenou verzi faktury, kterou jste od nás už dostali. Předchozí verzi prosím nahraďte touto.",
    reminderSubject: (n) => `Upomínka: faktura ${n} je po splatnosti`,
    reminderHeading: (n) => `Upomínka – faktura ${n} po splatnosti`,
    reminderFirst: "Tato faktura je po splatnosti a podle našich záznamů dosud nebyla uhrazena.",
    reminderAgain: (count) => `Toto je upomínka č. ${count} – faktura stále nebyla uhrazena.`,
    invoiceNumber: "Číslo faktury",
    documentNumber: "Číslo dokladu",
    amount: "Částka",
    dueDate: "Splatnost",
    variableSymbol: "Variabilní symbol",
    scanToPay: "Naskenujte v aplikaci své banky a zaplaťte",
    pdfFollowUpSubject: (n) => `PDF k faktuře ${n}`,
    pdfFollowUpIntro: "Posíláme PDF k faktuře, o které jsme vám už psali. Údaje k platbě zůstávají stejné.",
    notStated: "neuvedeno",
    viewInvoice: "Zobrazit fakturu",
    viewDocument: "Zobrazit doklad",
    allDocuments: "Všechny vaše doklady na jednom místě",
    attachments: "Přílohy",
    unexpected: "Nečekali jste tento doklad?",
    report: "Nahlaste ho",
    dateLocale: "cs-CZ",
  },
  sk: {
    invoiceSubject: (n) => `Faktúra ${n}`,
    invoiceHeading: (n) => `Nová faktúra ${n}`,
    invoiceIntro: "Bola vám vystavená nová faktúra. Podrobnosti a možnosti úhrady nájdete nižšie.",
    creditNoteSubject: (n) => `Dobropis ${n}`,
    creditNoteIntro: "Posielame vám dobropis, ktorý znižuje sumu pôvodnej faktúry. Podrobnosti nájdete nižšie.",
    correctedSubject: (n) => `Opravená faktúra ${n}`,
    correctionPrefix: "Oprava:",
    correctedNote: "Posielame opravenú verziu faktúry, ktorú ste od nás už dostali. Predchádzajúcu verziu, prosím, nahraďte touto.",
    reminderSubject: (n) => `Upomienka: faktúra ${n} je po splatnosti`,
    reminderHeading: (n) => `Upomienka – faktúra ${n} po splatnosti`,
    reminderFirst: "Táto faktúra je po splatnosti a podľa našich záznamov ešte nebola uhradená.",
    reminderAgain: (count) => `Toto je upomienka č. ${count} – faktúra stále nebola uhradená.`,
    invoiceNumber: "Číslo faktúry",
    documentNumber: "Číslo dokladu",
    amount: "Suma",
    dueDate: "Splatnosť",
    variableSymbol: "Variabilný symbol",
    scanToPay: "Naskenujte v aplikácii svojej banky a zaplaťte",
    pdfFollowUpSubject: (n) => `PDF k faktúre ${n}`,
    pdfFollowUpIntro: "Posielame PDF k faktúre, o ktorej sme vám už písali. Platobné údaje zostávajú rovnaké.",
    notStated: "neuvedená",
    viewInvoice: "Zobraziť faktúru",
    viewDocument: "Zobraziť doklad",
    allDocuments: "Všetky vaše doklady na jednom mieste",
    attachments: "Prílohy",
    unexpected: "Nečakali ste tento doklad?",
    report: "Nahláste ho",
    dateLocale: "sk-SK",
  },
  en: {
    invoiceSubject: (n) => `Invoice ${n}`,
    invoiceHeading: (n) => `New invoice ${n}`,
    invoiceIntro: "A new invoice has been issued to you. You will find the details and payment options below.",
    creditNoteSubject: (n) => `Credit note ${n}`,
    creditNoteIntro: "We are sending you a credit note that reduces the amount of the original invoice. You will find the details below.",
    correctedSubject: (n) => `Corrected invoice ${n}`,
    correctionPrefix: "Correction:",
    correctedNote: "This is a corrected version of an invoice you already received from us. Please replace the earlier version with this one.",
    reminderSubject: (n) => `Reminder: invoice ${n} is overdue`,
    reminderHeading: (n) => `Reminder – invoice ${n} is overdue`,
    reminderFirst: "This invoice is past its due date and according to our records has not been paid yet.",
    reminderAgain: (count) => `This is reminder no. ${count} – the invoice has still not been paid.`,
    invoiceNumber: "Invoice number",
    documentNumber: "Document number",
    amount: "Amount",
    dueDate: "Due date",
    variableSymbol: "Variable symbol",
    scanToPay: "Scan with your banking app to pay",
    pdfFollowUpSubject: (n) => `PDF of invoice ${n}`,
    pdfFollowUpIntro: "Here is the PDF of the invoice we wrote to you about. The payment details stay the same.",
    notStated: "not stated",
    viewInvoice: "View invoice",
    viewDocument: "View document",
    allDocuments: "All your documents in one place",
    attachments: "Attachments",
    unexpected: "Didn't expect this document?",
    report: "Report it",
    dateLocale: "en-GB",
  },
};

function renderInvoiceEmailHtml(params: {
  lang: EmailLang;
  /** A credit note asks for no payment: no due date row, "document" instead of "invoice". */
  creditNote: boolean;
  heading: string;
  intro: string;
  invoiceNumber: string;
  amount: string;
  dueDate: Date | null;
  variableSymbol?: string | null;
  /** The QR goes along as the inline `cid:payment-qr` attachment. */
  paymentQr?: boolean;
  publicLink: string;
  clientPortalLink?: string | null;
  signature?: string;
  accent?: string;
  attachmentNames?: string[];
  credit?: BrandCredit | null;
}): string {
  const portalUrl = portalUrlOf(params.publicLink, params.lang);
  const accent = params.accent && /^#[0-9a-fA-F]{6}$/.test(params.accent) ? params.accent : "#111827";
  const paragraphs = (text: string) => escapeHtml(text).replace(/\r?\n/g, "<br>");
  const l = EMAIL_LABELS[params.lang];
  const dueDateFormatted = params.dueDate
    ? params.dueDate.toLocaleDateString(l.dateLocale, { year: "numeric", month: "2-digit", day: "2-digit" })
    : l.notStated;

  return `<!doctype html>
<html lang="${params.lang}">
  <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; background:#f4f5f7; margin:0; padding:24px;">
    <table role="presentation" width="100%" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
      <tr>
        <td style="padding:32px;">
          <h1 style="font-size:20px; margin:0 0 16px; color:#111;">${escapeHtml(params.heading)}</h1>
          <p style="font-size:14px; color:#333; margin:0 0 24px; line-height:1.5;">${paragraphs(params.intro)}</p>
          <table role="presentation" width="100%" style="font-size:14px; color:#333; margin-bottom:24px; border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0; color:#666;">${params.creditNote ? l.documentNumber : l.invoiceNumber}</td>
              <td style="padding:6px 0; text-align:right;"><strong>${escapeHtml(params.invoiceNumber)}</strong></td>
            </tr>
            <tr>
              <td style="padding:6px 0; color:#666;">${l.amount}</td>
              <td style="padding:6px 0; text-align:right;"><strong>${escapeHtml(params.amount)}</strong></td>
            </tr>
            ${
              params.creditNote
                ? ""
                : `<tr>
              <td style="padding:6px 0; color:#666;">${l.dueDate}</td>
              <td style="padding:6px 0; text-align:right;">${escapeHtml(dueDateFormatted)}</td>
            </tr>${
              params.variableSymbol
                ? `<tr>
              <td style="padding:6px 0; color:#666;">${l.variableSymbol}</td>
              <td style="padding:6px 0; text-align:right;"><strong>${escapeHtml(params.variableSymbol)}</strong></td>
            </tr>`
                : ""
            }`
            }
          </table>
          ${
            params.paymentQr && !params.creditNote
              ? `<p style="text-align:center; margin:0 0 20px;"><img src="cid:${PAYMENT_QR_CID}" width="160" height="160" alt="QR" style="display:inline-block; width:160px; height:160px;"><br><span style="font-size:12px; color:#666;">${l.scanToPay}</span></p>`
              : ""
          }
          <p style="text-align:center; margin:0 0 8px;">
            <a href="${portalUrl}" style="display:inline-block; background:${accent}; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:6px; font-size:14px;">${params.creditNote ? l.viewDocument : l.viewInvoice}</a>
          </p>
          ${
            params.clientPortalLink
              ? `<p style="text-align:center; font-size:13px; margin:12px 0 0;"><a href="${clientPortalUrlOf(params.clientPortalLink, params.lang)}" style="color:${accent};">${l.allDocuments}</a></p>`
              : ""
          }
          ${
            params.attachmentNames?.length
              ? `<p style="font-size:13px; color:#555; margin:20px 0 0;">${l.attachments}: ${params.attachmentNames.map(escapeHtml).join(", ")}</p>`
              : ""
          }
          ${params.signature ? `<p style="font-size:14px; color:#333; margin:20px 0 0; line-height:1.5;">${paragraphs(params.signature)}</p>` : ""}
          <p style="font-size:12px; color:#999; text-align:center; margin-top:24px; word-break:break-all;">
            ${escapeHtml(portalUrl)}
          </p>
          <p style="font-size:11px; color:#aaa; text-align:center; margin-top:8px;">
            ${l.unexpected} <a href="${portalUrl}?report=1" style="color:#888;">${l.report}</a>.
          </p>
        </td>
      </tr>
    </table>
    ${
      params.credit
        ? `<p style="font-size:11px; color:#9ca3af; text-align:center; margin:16px 0 0;"><a href="${escapeHtml(params.credit.url)}" style="color:#9ca3af; text-decoration:none;">${escapeHtml(params.credit.label)}</a></p>`
        : ""
    }
  </body>
</html>`;
}


function placeholderValues(params: SendInvoiceEmailParams): Record<string, string> {
  return {
    ...params.custom?.vars,
    number: params.invoiceNumber,
    amount: params.amount,
    due_date: params.dueDate
      ? params.dueDate.toLocaleDateString(EMAIL_LABELS[emailLangOf(params.language)].dateLocale, { year: "numeric", month: "2-digit", day: "2-digit" })
      : "",
    company: params.custom?.companyName ?? "",
    customer: params.custom?.customerName ?? "",
    link: portalUrlOf(params.publicLink, emailLangOf(params.language)),
    portal_link: params.clientPortalLink ? clientPortalUrlOf(params.clientPortalLink, emailLangOf(params.language)) : "",
  };
}

/** `"Novák Design" <faktury@billanta.cz>` from `EMAIL_FROM` (either `addr` or `Name <addr>`). */
export function withDisplayName(from: string, name?: string | null): string {
  const clean = name?.replace(/["<>\r\n]/g, "").trim();
  if (!clean) return from;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  return `"${clean}" <${address}>`;
}
