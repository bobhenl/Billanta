/** The demo playground (docs/demo-playground-plan.md): kinds and the master switch. */
export const DEMO_KINDS = ['cz_vat_sro', 'cz_freelancer', 'cz_pausal', 'sk_vat_sro'] as const;
export type DemoKind = (typeof DEMO_KINDS)[number];

/** Whose eyes a demo visitor can look through (the banner's picker, /api/demo/role). */
export const DEMO_VIEW_ROLES = ['owner', 'accountant', 'viewer'] as const;
export type DemoViewRole = (typeof DEMO_VIEW_ROLES)[number];

export const isDemoKind = (value: unknown): value is DemoKind => DEMO_KINDS.includes(value as DemoKind);

/** Server-only: the backend needs its own `DEMO_ENABLED` too; this hides the entry points. */
export const demoEnabled = () => process.env.DEMO_ENABLED === 'true' && Boolean(process.env.DEMO_PROVISION_SECRET);

/** Whether Auth.js uses `__Secure-` cookies: it decides by the configured URL's scheme. */
export const secureCookies = () => (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? '').startsWith('https://');

/** Same-origin check for the demo routes (they set cookies, so a foreign form must not reach them). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  // Caddy passes the original Host through, and a browser can't forge it.
  const host = request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
