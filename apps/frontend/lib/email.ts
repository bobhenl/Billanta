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

/**
 * Queues the "reset your password" email. Throws only if the database call
 * fails; the forgot-password route catches that so the anti-enumeration-safe
 * response stays the same.
 */
export async function sendPasswordResetEmail(params: { to: string; resetUrl: string; userId: string; validMinutes: number }): Promise<void> {
  await enqueueAccountEmail({
    kind: 'password_reset',
    to: params.to,
    subject: 'Obnovení hesla / Password reset',
    html: renderPasswordResetEmailHtml(params.resetUrl),
    text: [
      'Obnovení hesla / Password reset',
      '',
      'Nové heslo si nastavíte na tomto odkazu, platí 1 hodinu:',
      'Set a new password at this link, valid for 1 hour:',
      params.resetUrl,
      '',
      'Pokud jste o obnovení hesla nežádali, e-mail ignorujte. / If you did not request this, ignore this email.'
    ].join('\n'),
    userId: params.userId,
    validMinutes: params.validMinutes
  });
}

/**
 * Inline HTML, bilingual (cs/en) since this endpoint has no request-scoped
 * locale to render against (the email is looked up by address, not by the
 * locale the user happened to submit the form from) — mirrors the backend
 * email template's plain-inline-styles structure so any future shared
 * template extraction has less to reconcile.
 */
function renderPasswordResetEmailHtml(resetUrl: string): string {
  return `<!doctype html>
<html lang="cs">
  <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; background:#f4f5f7; margin:0; padding:24px;">
    <table role="presentation" width="100%" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
      <tr>
        <td style="padding:32px;">
          <h1 style="font-size:20px; margin:0 0 16px; color:#111;">Obnovení hesla / Password reset</h1>
          <p style="font-size:14px; color:#333; margin:0 0 16px; line-height:1.5;">
            Někdo (doufejme vy) požádal o obnovení hesla k vašemu účtu. Klikněte na tlačítko níže a
            zvolte si nové heslo. Odkaz je platný 1 hodinu.
          </p>
          <p style="font-size:14px; color:#333; margin:0 0 24px; line-height:1.5;">
            Someone (hopefully you) requested a password reset for your account. Click the button
            below to choose a new password. This link is valid for 1 hour.
          </p>
          <p style="text-align:center; margin:0 0 8px;">
            <a href="${escapeHtml(resetUrl)}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:6px; font-size:14px;">Nastavit nové heslo / Set new password</a>
          </p>
          <p style="font-size:12px; color:#999; text-align:center; margin-top:24px; word-break:break-all;">
            ${escapeHtml(resetUrl)}
          </p>
          <p style="font-size:12px; color:#999; margin-top:24px; line-height:1.5;">
            Pokud jste o obnovení hesla nežádali, tento e-mail můžete ignorovat – vaše heslo zůstane
            beze změny. / If you did not request this, you can safely ignore this email – your
            password will remain unchanged.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Queues the "confirm your new email address" link (profile → change email).
 * Throws only if the database call fails.
 */
export async function sendEmailChangeEmail(params: { to: string; confirmUrl: string; userId: string; validMinutes: number }): Promise<void> {
  const url = escapeHtml(params.confirmUrl);
  await enqueueAccountEmail({
    kind: 'email_change',
    to: params.to,
    subject: 'Potvrzení nového e-mailu / Confirm your new email',
    text: [
      'Potvrzení nového e-mailu / Confirm your new email',
      '',
      'Změnu přihlašovacího e-mailu dokončíte na tomto odkazu, platí 1 hodinu:',
      'Finish changing your sign-in email at this link, valid for 1 hour:',
      params.confirmUrl,
      '',
      'Pokud jste o změnu nežádali, e-mail ignorujte. / If you did not request this, ignore this email.'
    ].join('\n'),
    userId: params.userId,
    validMinutes: params.validMinutes,
    html: `<!doctype html>
<html lang="cs">
  <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; background:#f4f5f7; margin:0; padding:24px;">
    <table role="presentation" width="100%" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
      <tr>
        <td style="padding:32px;">
          <h1 style="font-size:20px; margin:0 0 16px; color:#111;">Potvrzení nového e-mailu / Confirm your new email</h1>
          <p style="font-size:14px; color:#333; margin:0 0 16px; line-height:1.5;">
            Pro dokončení změny přihlašovacího e-mailu klikněte na tlačítko níže. Odkaz je platný 1 hodinu.
          </p>
          <p style="font-size:14px; color:#333; margin:0 0 24px; line-height:1.5;">
            Click the button below to finish changing your sign-in email. This link is valid for 1 hour.
          </p>
          <p style="text-align:center; margin:0 0 8px;">
            <a href="${url}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:6px; font-size:14px;">Potvrdit e-mail / Confirm email</a>
          </p>
          <p style="font-size:12px; color:#999; text-align:center; margin-top:24px; word-break:break-all;">${url}</p>
          <p style="font-size:12px; color:#999; margin-top:24px; line-height:1.5;">
            Pokud jste o změnu nežádali, e-mail ignorujte. / If you did not request this, ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
