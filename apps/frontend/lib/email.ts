/**
 * Thin Resend wrapper for the frontend's own transactional email: the
 * "reset your password" link sent by `POST /api/auth/forgot-password`
 * (`app/api/auth/forgot-password/route.ts`).
 *
 * Deliberately mirrors `apps/backend/src/email/email.service.ts`'s shape
 * (same `RESEND_API_KEY`/`EMAIL_FROM` env vars — see root `.env.example` —
 * same tolerant-of-missing-key construction, same inline-HTML-no-templating-
 * engine choice for a single simple email) rather than reusing that class
 * directly: the backend is a separate NestJS app/deploy unit with its own
 * `ConfigService`-based DI, and the frontend has no dependency on it. Two
 * small, independently-typed copies of "wrap Resend" is the same tradeoff
 * this codebase already accepted for `lib/auth-schema.ts` duplicating the
 * backend's Auth.js tables — see that file's doc comment.
 *
 * Confidence note, same standard as the backend copy: `new Resend(apiKey)`
 * and `resend.emails.send({ from, to, subject, html })` returning
 * `{ data, error }` is the verified `resend` SDK shape (backend already
 * pinned `resend@^6.26.0` against the real published types). No live send
 * against a real Resend account was exercised in this task — see this
 * feature's verification notes.
 */
import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.EMAIL_FROM;

const resend = apiKey ? new Resend(apiKey) : null;

/**
 * Sends the "reset your password" email. Throws if `RESEND_API_KEY`/
 * `EMAIL_FROM` aren't configured or if Resend reports a send failure —
 * callers (the forgot-password route) catch this so a misconfigured Resend
 * setup never leaks into the anti-enumeration-safe HTTP response.
 */
export async function sendPasswordResetEmail(params: { to: string; resetUrl: string }): Promise<void> {
  if (!resend || !fromAddress) {
    throw new Error('Email is not configured — RESEND_API_KEY and EMAIL_FROM must both be set (see .env.example)');
  }

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: params.to,
    subject: 'Obnovení hesla / Password reset',
    html: renderPasswordResetEmailHtml(params.resetUrl)
  });

  if (error) {
    throw new Error(`Resend send failed (${error.name}): ${error.message}`);
  }
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
            Pokud jste o obnovení hesla nežádali, tento e-mail můžete ignorovat — vaše heslo zůstane
            beze změny. / If you did not request this, you can safely ignore this email — your
            password will remain unchanged.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
