/**
 * The frontend's own account e-mails: the password-reset link
 * (`app/api/auth/forgot-password/route.ts`) and the confirmation of a new
 * sign-in address (`settings/profile/actions.ts`).
 *
 * They are queued in the backend's `email_outbox` and delivered by its
 * worker, like every other e-mail, so a Resend 429 or 5xx is retried instead
 * of losing the link. The frontend has no tenant, so it cannot insert into
 * the tenant-scoped table; it calls the SECURITY DEFINER
 * `enqueue_account_email` (backend migration 0059) instead. That function
 * queues the mail as transactional (no batching, no quiet hours), the worker
 * claims it before tenant mail, and it dies unsent once the link inside has
 * expired. The daily caps in the backend's `src/abuse/` limit a company's
 * mail to its customers and do not apply here.
 *
 * Without RESEND_API_KEY on the backend the row just waits in the outbox,
 * so queuing succeeds even where nothing is sent (local dev).
 */
import { sql } from 'drizzle-orm';
import { db } from './db';

type AccountEmailKind = 'password_reset' | 'email_change';

/** E-mails are written in cs, sk and en; any other UI language reads English (same rule as the backend's `emailLocaleOf`). */
export type EmailLocale = 'cs' | 'sk' | 'en';

export function emailLocaleOf(value: string | null | undefined): EmailLocale {
  const code = value?.trim().slice(0, 2).toLowerCase();
  if (!code) return 'cs';
  return code === 'cs' || code === 'sk' ? code : 'en';
}

async function enqueueAccountEmail(email: {
  kind: AccountEmailKind;
  to: string;
  subject: string;
  html: string;
  text: string;
  userId: string | null;
  validMinutes: number;
}): Promise<void> {
  await db.execute(
    sql`SELECT enqueue_account_email(${email.kind}, ${email.to}, ${email.subject}, ${email.html}, ${email.text}, ${email.userId}::uuid, ${email.validMinutes}::integer)`
  );
}

interface AccountEmailText {
  subject: string;
  intro: string;
  button: string;
  ignore: string;
}

const PASSWORD_RESET: Record<EmailLocale, AccountEmailText> = {
  cs: {
    subject: 'Obnovení hesla',
    intro: 'Někdo (doufejme vy) požádal o obnovení hesla k vašemu účtu. Klikněte na tlačítko níže a zvolte si nové heslo. Odkaz je platný 1 hodinu.',
    button: 'Nastavit nové heslo',
    ignore: 'Pokud jste o obnovení hesla nežádali, tento e-mail můžete ignorovat – vaše heslo zůstane beze změny.'
  },
  sk: {
    subject: 'Obnovenie hesla',
    intro: 'Niekto (dúfajme, že vy) požiadal o obnovenie hesla k vášmu účtu. Kliknite na tlačidlo nižšie a zvoľte si nové heslo. Odkaz platí 1 hodinu.',
    button: 'Nastaviť nové heslo',
    ignore: 'Ak ste o obnovenie hesla nežiadali, tento e-mail môžete ignorovať – vaše heslo zostane bez zmeny.'
  },
  en: {
    subject: 'Password reset',
    intro: 'Someone (hopefully you) requested a password reset for your account. Click the button below to choose a new password. This link is valid for 1 hour.',
    button: 'Set new password',
    ignore: 'If you did not request this, you can safely ignore this email – your password will remain unchanged.'
  }
};

const EMAIL_CHANGE: Record<EmailLocale, AccountEmailText> = {
  cs: {
    subject: 'Potvrzení nového e-mailu',
    intro: 'Pro dokončení změny přihlašovacího e-mailu klikněte na tlačítko níže. Odkaz je platný 1 hodinu.',
    button: 'Potvrdit e-mail',
    ignore: 'Pokud jste o změnu nežádali, e-mail ignorujte.'
  },
  sk: {
    subject: 'Potvrdenie nového e-mailu',
    intro: 'Zmenu prihlasovacieho e-mailu dokončíte kliknutím na tlačidlo nižšie. Odkaz platí 1 hodinu.',
    button: 'Potvrdiť e-mail',
    ignore: 'Ak ste o zmenu nežiadali, e-mail ignorujte.'
  },
  en: {
    subject: 'Confirm your new email',
    intro: 'Click the button below to finish changing your sign-in email. This link is valid for 1 hour.',
    button: 'Confirm email',
    ignore: 'If you did not request this, ignore this email.'
  }
};

/** The HTML and plain-text parts of an account e-mail with one button. */
export function renderAccountEmail(locale: EmailLocale, t: AccountEmailText, url: string): { subject: string; html: string; text: string } {
  const href = escapeHtml(url);
  const html = `<!doctype html>
<html lang="${locale}">
  <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; background:#f4f5f7; margin:0; padding:24px;">
    <table role="presentation" width="100%" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
      <tr>
        <td style="padding:32px;">
          <h1 style="font-size:20px; margin:0 0 16px; color:#111;">${escapeHtml(t.subject)}</h1>
          <p style="font-size:14px; color:#333; margin:0 0 24px; line-height:1.5;">${escapeHtml(t.intro)}</p>
          <p style="text-align:center; margin:0 0 8px;">
            <a href="${href}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:6px; font-size:14px;">${escapeHtml(t.button)}</a>
          </p>
          <p style="font-size:12px; color:#999; text-align:center; margin-top:24px; word-break:break-all;">${href}</p>
          <p style="font-size:12px; color:#999; margin-top:24px; line-height:1.5;">${escapeHtml(t.ignore)}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = [t.subject, '', t.intro, url, '', t.ignore].join('\n');
  return { subject: t.subject, html, text };
}

/**
 * Queues the "reset your password" email in the language of the page the
 * request came from (the link opens that language too). Throws only if the
 * database call fails; the forgot-password route catches that so the
 * anti-enumeration-safe response stays the same.
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
  userId: string;
  validMinutes: number;
  locale: EmailLocale;
}): Promise<void> {
  const mail = renderAccountEmail(params.locale, PASSWORD_RESET[params.locale], params.resetUrl);
  await enqueueAccountEmail({ kind: 'password_reset', to: params.to, ...mail, userId: params.userId, validMinutes: params.validMinutes });
}

/**
 * Queues the "confirm your new email address" link (profile → change email)
 * in the member's current UI language. Throws only if the database call fails.
 */
export async function sendEmailChangeEmail(params: {
  to: string;
  confirmUrl: string;
  userId: string;
  validMinutes: number;
  locale: EmailLocale;
}): Promise<void> {
  const mail = renderAccountEmail(params.locale, EMAIL_CHANGE[params.locale], params.confirmUrl);
  await enqueueAccountEmail({ kind: 'email_change', to: params.to, ...mail, userId: params.userId, validMinutes: params.validMinutes });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
