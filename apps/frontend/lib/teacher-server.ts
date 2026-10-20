import { auth } from '@/auth';
import { sessionIsTeacher } from './teacher';

/** Server-only: is the signed-in user a teacher (lib/teacher.ts)? Signed out means no. */
export async function isTeacher(): Promise<boolean> {
  return sessionIsTeacher(await auth().catch(() => null));
}
