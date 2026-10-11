import { SignupForm } from './signup-form';

/**
 * Standalone signup page — picks up the "no standalone signup page built"
 * TODO from apps/frontend/README.md. Lives in an (auth) route group (no URL
 * segment added, same trick `(dashboard)` uses) so it renders without the
 * authenticated dashboard sidebar/shell from `(dashboard)/layout.tsx`.
 *
 * This page itself stays a plain server component with no interactivity —
 * all form state and the ToS acceptance logic live in the client component
 * below (`signup-form.tsx`), per blueprint §9's signup-gate requirement.
 */
export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <SignupForm />
      </div>
    </div>
  );
}
