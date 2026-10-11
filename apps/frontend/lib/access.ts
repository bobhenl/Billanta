/** Access constants shared by server and client components (no server imports here). */
export const PERMISSION_AREAS = ['invoices', 'contacts', 'expenses', 'bank', 'reports'] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];
export type PermissionLevel = 'none' | 'read' | 'write';
export const APP_MODULES = ['expenses', 'bank', 'recurring', 'quotes', 'reports', 'ai', 'time'] as const;
export type AppModule = (typeof APP_MODULES)[number];
