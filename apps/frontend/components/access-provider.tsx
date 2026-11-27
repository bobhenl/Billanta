'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { canDo, canWrite, type PermissionAction, type PermissionArea, type WriteAccess } from '@/lib/access';

// null = unknown (no provider, or the access fetch failed): `canWrite` then allows everything.
const AccessContext = createContext<WriteAccess | null>(null);

/**
 * The member's role and area permissions for client components, set once by
 * the dashboard layout. The demo role switcher does a full reload, so a new
 * role reaches every button through here at once.
 */
export function AccessProvider({ access, children }: { access: WriteAccess | null; children: ReactNode }) {
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

/** Whether the member may change things in `area` (`null`: outside the areas). See `canWrite` in lib/access.ts. */
export function useCanWrite(area: PermissionArea | null): boolean {
  return canWrite(useContext(AccessContext), area);
}

/** Whether the member may perform one finer action (issue, send, cancel…). See `canDo` in lib/access.ts. */
export function useCanDo(action: PermissionAction): boolean {
  return canDo(useContext(AccessContext), action);
}
