import { Suspense } from 'react';
import { ResetPasswordForm } from './reset-password-form';

/**
 * Standalone "reset password" page — mirrors the other `(auth)` pages'
 * structure (route group, centered-card layout). Stays a plain server
 * component; all interactivity (including reading the `?token=` search
 * param) lives in `reset-password-form.tsx`.
 *
 * Wrapped in `Suspense`: `reset-password-form.tsx` calls
 * `useSearchParams()`, which Next.js's App Router requires to be inside a
 * Suspense boundary (otherwise the whole route opts out of static
 * rendering with a build-time warning).
 */
export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
