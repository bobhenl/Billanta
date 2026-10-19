/**
 * Whether a session belongs to a teacher: the user-level flag set at
 * `/signup?for=teacher` and exposed as `session.user.isTeacher`. Anything
 * else, a missing flag included, means "not a teacher", so the gated
 * content stays closed until the flag is really there. Safe to import on
 * both sides; `isTeacher()` in lib/teacher-server.ts reads the session on
 * the server, `useIsTeacher()` in lib/use-is-teacher.ts in the browser.
 */
export function sessionIsTeacher(session: unknown): boolean {
  if (!session || typeof session !== 'object') return false;
  const user = (session as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return false;
  return (user as { isTeacher?: unknown }).isTeacher === true;
}

/** Where a visitor goes to get a teacher account. */
export const TEACHER_SIGNUP_HREF = { pathname: '/signup', query: { for: 'teacher' } };
