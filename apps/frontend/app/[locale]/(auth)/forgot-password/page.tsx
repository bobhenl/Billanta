import { ForgotPasswordForm } from './forgot-password-form';

/**
 * Standalone "forgot password" page — mirrors `(auth)/login/page.tsx` and
 * `(auth)/signup/page.tsx`'s structure exactly (same `(auth)` route group
 * trick to skip the dashboard shell, same centered-card layout). Stays a
 * plain server component; all interactivity lives in
 * `forgot-password-form.tsx`.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
