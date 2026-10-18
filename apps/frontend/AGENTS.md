# apps/frontend — Next.js

Next.js 15 App Router, React 19, next-intl, NextAuth v5 (`auth.ts`),
Tailwind, lucide-react icons. Dev server: `pnpm --filter @faktur/frontend dev`
on **port 3100**. Marketing pages render without the backend. The dashboard
needs the backend.

```bash
pnpm --filter @faktur/frontend typecheck
pnpm --filter @faktur/frontend lint
```

## Layout

```
app/[locale]/(marketing)/   public site: home, features, pricing, create-invoice (guest invoice),
                            for-accountants, partners, compare, invoicing (local SEO), search, legal, about,
                            calculators, guides (registry in lib/public-tools.ts)
app/[locale]/(auth)/        login, signup, forgot/reset password
app/[locale]/(dashboard)/   the app (invoices, contacts, expenses, bank, reports, settings, …)
app/[locale]/{c,d,i,p}/     public token/slug pages (client portal, documents, invoice link, profile)
app/api/                    route handlers (auth, proxies)
components/                 shared components (flat; no shadcn vendoring)
lib/                        helpers: api-client, seo, site, tenant, access, …
messages/{cs,sk,en}.json    translations
middleware.ts               locale routing, profile subdomain rewrite, referral cookie
```

Route folder names and slugs on the public site are English (`/create-invoice`,
`/features/qr-payments`), the same in every locale. Old Czech URLs 301 via
`lib/legacy-slugs.json` (next.config.mjs). Never rename a public slug without
adding it there.

## i18n

- Locales `cs` (default), `sk`, `en`, always prefixed (`/cs/...`).
- Import `Link`, `redirect`, `useRouter` and `usePathname` from
  `@/i18n/navigation`, never from `next/link` or `next/navigation`.
- **Every key must exist in all three message files with the same shape.**
  Use ICU params and plurals (`{n, plural, one {…} few {…} other {…}}`;
  Czech and Slovak need `few`).
- Edit the JSON files with a script that parses and re-serialises them
  (`json.dumps(d, ensure_ascii=False, indent=2) + "\n"`, UTF-8). Don't
  hand-patch big blocks.
- Server components use `getTranslations`. Client components use
  `useTranslations`. Use the namespace that matches the feature.

## Talking to the backend

- `apiFetch<T>(path)` from `@/lib/api-client` is server-only. It attaches
  the user's backend token and the active company (`billanta_tenant`
  cookie). It throws `NotSignedInError`, `NoTenantError` or
  `ApiError(.status, .body)`.
- Mutations are **server actions** (`'use server'` in an `actions.ts` next
  to the page). They return `{ ok: true, data } | { ok: false, error }`
  (`SettingsResult<T>` in `settings/actions.ts`), and `backendMessage(error)`
  from `@/lib/action-error` extracts the backend's snake_case code. Clients
  map codes to `t('errors.<code>')` and fall back to a generic message.
- Public backend endpoints (`/api/v1/public/*`) can be fetched directly
  with `BACKEND_URL`, a short timeout and a `revalidate`. They must fail
  soft (return empty) so marketing pages still render.
- Pass the visitor's IP to the backend as `x-guest-ip` (from
  `clientIp(request)` in `@/lib/client-ip`) when the backend rate-limits
  per visitor.

## UI conventions

- Use `buttonClass.primary/secondary/…` and `inputClass` from
  `@/lib/ui-classes` (server components must import them from there, not
  from the client module `@/components/modal`), `toast({ text, tone })` from `@/components/toaster`,
  `Banner`, `SettingsHeader`, and `cn()` from `@/lib/utils`.
- Roles: `fetchMyRole()` and `canManage(role)` from `@/lib/tenant`. Hide
  or disable actions the role can't do. The backend enforces it anyway.
- Mobile-first. Dashboard and marketing each have a bottom tab bar
  (`mobile-tab-bar.tsx`, `marketing-tab-bar.tsx`). New top-level pages
  should be reachable from it or from the "More" sheet. Check 375px width:
  no horizontal scroll.
- Dark mode via `next-themes`. Use theme tokens (`bg-card`,
  `text-muted-foreground`, `border-border`, `text-primary`), never raw
  colours.
- Brand: **Billanta**, primary colour indigo. Use `SITE_NAME` / `SITE_URL`
  from `@/lib/site`. Never hard-code the name or domain.

## SEO for public pages

- `generateMetadata` → `publicPageMetadata({ locale, path, title, description })`
  from `@/lib/seo` (canonical + hreflang). Add JSON-LD with `jsonLd` and
  `breadcrumbLd`.
- New public pages go into `app/sitemap.ts`. Private or redirect paths go
  into the `PRIVATE` list in `app/robots.ts`.
- Outbound partner links are plain `<a>` tags through `/partners/go/:slug`
  with `rel="sponsored noopener"`. Not `Link`, because prefetching would
  count clicks.
