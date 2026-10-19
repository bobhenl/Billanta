'use client';

import { useSession } from 'next-auth/react';
import { sessionIsTeacher } from './teacher';

/**
 * Client side of lib/teacher.ts: `loading` until the session is known, so
 * a teacher never sees the "sign in" note flash before the answers.
 */
export function useIsTeacher(): 'loading' | 'teacher' | 'other' {
  const { data, status } = useSession();
  if (status === 'loading') return 'loading';
  return sessionIsTeacher(data) ? 'teacher' : 'other';
}
