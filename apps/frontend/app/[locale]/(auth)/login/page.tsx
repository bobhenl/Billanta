import { LoginForm } from './login-form';

/**
 * Standalone login page — mirrors `(auth)/signup/page.tsx`'s structure
 * exactly (same route-group trick to skip the dashboard shell, same
 * centered-card layout). Stays a plain server component; all interactivity
 * lives in `login-form.tsx`.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </div>
  );
}
