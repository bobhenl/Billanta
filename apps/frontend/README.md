# apps/frontend

Next.js (App Router) dashboard skeleton with next-intl (cs/sk/en), Tailwind CSS,
and a minimal shadcn/ui setup — covering auth, invoice/contact CRUD, and
billing UI (see blueprint §2 Tech Stack and §3 System Architecture).

A public marketing homepage, dark/light mode, and real navigation (desktop
navbar + mobile bottom bar, for both the marketing site and the dashboard)
have since been added — see "UI shell" below.

For the full product context — multi-tenancy, backend API shape, AI
voice-to-invoice pipeline, and the legal/liability requirements behind the
AI-draft disclaimer banner — see
[`docs/CZ-SK-Invoicing-SaaS-Blueprint.md`](../../docs/CZ-SK-Invoicing-SaaS-Blueprint.md),
particularly §6 (AI-drafted invoice review UX), §7 (i18n), and §9 (legal &
liability / ToS acceptance).

## Status

This is a structural skeleton, not a finished app: routing, i18n, and layout
are real and working; most pages under `(dashboard)/` beyond Invoices are
"coming soon" stubs, and the invoice list renders in-file mock data instead
of calling the backend. See inline `TODO` comments for what's stubbed.

Two former TODOs are now built out (still backed by mocks, not the real
backend — see "Auth & channel linking" below):

- [x] ~~No standalone signup page built~~ → `(auth)/signup`
- [x] ~~Settings / channels (account-linking) UI~~ → `(dashboard)/settings/channels`

A third is now built out too:

- [x] ~~Root `/` redirects straight to `/dashboard`, no public marketing
  page~~ → real marketing homepage at `app/[locale]/page.tsx`, see "UI
  shell" below.

## Homepage visual redesign & app-name centralization

Two follow-ups to the original marketing homepage/theme scaffold:

- **Visual redesign** — the homepage no longer uses the generic centered-hero
  + four-identical-cards layout. `app/[locale]/page.tsx` now has an
  asymmetric hero (headline/CTAs beside a real invoice mockup,
  `components/marketing-invoice-mockup.tsx`, styled to match the actual
  dashboard's invoice list conventions) and a features section with real
  hierarchy (one featured card for the AI-voice feature, three smaller
  supporting cards). Typography adds a second font: `Fraunces` (a serif,
  loaded via `next/font/google` in `app/[locale]/layout.tsx` as the
  `--font-display` CSS variable / Tailwind's `font-display` utility) for
  marketing headlines only — Inter stays the body/UI font everywhere,
  including the dashboard. The color palette in `app/globals.css` (and the
  `fontFamily` extension in `tailwind.config.ts`) was redone as a single
  considered light/dark system — one "ink teal" accent hue used sparingly,
  cool blue-grey-biased neutrals instead of pure grey — see the rationale
  comment above the `:root` block in `app/globals.css`. Because these are
  shared CSS variables, the new palette applies across the whole app
  (dashboard included), not just the homepage.
- **App name centralization** — "Faktur" is a placeholder the founder
  expects to change before launch. `messages/{cs,sk,en}.json`'s `app.name`
  key is the single source of truth for the name in translated UI (see the
  comment on its first read in `app/[locale]/layout.tsx`'s
  `generateMetadata`); `lib/site.ts` now also exports `SITE_NAME` for any
  future non-translated-context usage (structured data, non-locale routes).
  Neither file renames the product — both just make a future rename a
  one-place change instead of a repo-wide find-and-replace. Note the
  `about`/`legal` page copy (out of scope for this pass) still has the
  literal word "Faktur" woven into full sentences in the message catalogs —
  that's prose content, not a hardcoded string in component code, so it was
  left as-is; it'll need a copy pass whenever the real name is picked.

## UI shell (dark/light mode, language switcher, navigation)

- **Dark/light mode** — `next-themes` (`components/theme-provider.tsx`,
  wired into `app/[locale]/layout.tsx` with `attribute="class"`,
  `defaultTheme="system"`, `enableSystem`). `app/globals.css` defines the
  dark palette twice on purpose: a `@media (prefers-color-scheme: dark)`
  fallback scoped to `:root:not(.light)` (pre-hydration / no-JS), and a
  `.dark` class block that's the real source of truth once next-themes sets
  the class on `<html>`. Toggle button: `components/theme-toggle.tsx`
  (Sun/Moon from lucide-react, swapped on `resolvedTheme`).
- **Language switcher** — `components/language-switcher.tsx`, a native
  `<select>` (accessible for free, no extra dependency) with a `Globe`
  icon, driven by `useLocale`/`usePathname`/`useRouter` from
  `@/i18n/navigation` so it swaps the locale prefix without hand-rolling
  URL logic.
- **Public marketing homepage** — `app/[locale]/page.tsx` (previously just
  `redirect('/dashboard')`) now renders a real landing page: navbar
  (`components/marketing-navbar.tsx`), hero + features section, footer
  (`components/marketing-footer.tsx`). `/pricing` and `/login` are still
  linked as placeholders — those routes don't exist yet, that's intentional
  (out of scope here). `/about` and `/legal/privacy` are no longer
  placeholders — see "Legal & about pages" below. TODO: once an auth
  session exists, this page should redirect signed-in visitors to
  `/dashboard` — see the inline comment.
- **Dashboard navbar + mobile bottom bar** — `(dashboard)/layout.tsx` now
  uses a top navbar (`components/dashboard-nav.tsx`) instead of the old
  sidebar, plus the theme toggle, language switcher, and a user-menu
  placeholder (`components/user-menu.tsx` — avatar + "Log out", no real
  session wiring). Below Tailwind's `md` breakpoint, the navbar's links are
  replaced by a fixed bottom bar (`components/mobile-bottom-nav.tsx`) with
  the same 5 sections (icon + label, active route highlighted). Both navs
  share one source of truth for the 5 sections:
  `lib/dashboard-nav-items.ts`.

## Legal & about pages

- **`legal/terms`** and **`legal/privacy`** — structural placeholders, not
  real legal text. Each renders one section per required clause (VOP
  clauses from blueprint §9 for `terms`; GDPR topics from blueprint §8 for
  `privacy`), with a one-sentence plain-language summary of what that
  clause/topic will cover plus a "pending legal review" callout
  (`AlertTriangle` from lucide-react + `legal.pendingReviewLabel`). The
  actual binding wording still needs to be drafted and periodically
  reviewed by a Czech attorney (ideally with e-commerce/SaaS and
  data-protection experience) before launch — do not treat the summaries as
  legal advice or fill them in without that review.
- **`about`** — real marketing copy (unlike the two pages above): what
  Faktur is, who it's for, and a short "why we built this" narrative. Safe
  to edit/expand without legal review since it makes no compliance claims.

## Local-SEO municipality pages (`/faktury-pro`)

`app/[locale]/faktury-pro/[slug]/page.tsx` renders one landing page per real
Czech and Slovak municipality (e.g. "Fakturační software pro Valtice"),
plus `app/[locale]/faktury-pro/page.tsx`, a browse/directory page grouping
every municipality by region for real on-site crawlable linking.

- **Coverage**: 9,124 of the ~9,100 target (6,234 of Czechia's ~6,254
  municipalities + all 2,890 of Slovakia's). `apps/frontend/data/README.md`
  documents the exact sources, retrieval dates, and the ~107 Czech
  municipalities intentionally left out because their district couldn't be
  resolved reliably — none were guessed or invented to hit a round number.
- **Data**: `apps/frontend/data/municipalities.json`, loaded via
  `lib/municipalities.ts` (`getAllMunicipalities`, `getMunicipalityBySlug`,
  `getRegionGroups`, `getBuildTimeMunicipalities`).
- **Rendering strategy**: only the ~159 municipalities that are themselves a
  district/region seat (incl. Praha and Bratislava) are statically generated
  at build time (`generateStaticParams`); the rest render on first request
  and are cached via ISR (`dynamicParams = true`, `revalidate` = 30 days).
  Statically generating all ~9,100 municipalities × 3 locales (~27,000
  pages) up front was judged not worth the build-time cost for a route
  whose pages are mostly-templated by design — see the comment at the top
  of `[slug]/page.tsx`.
- **Known, accepted risk**: this feature was requested by the founder after
  being warned it resembles Google's "doorway pages" / thin-content
  pattern, since the product genuinely doesn't differ by municipality. The
  mitigations actually in place: every fact shown (name/region/district) is
  real and sourced (see `data/README.md`); the copy explicitly says the
  product works identically everywhere rather than implying local
  customization; there are no invented per-town statistics or testimonials;
  there's no `LocalBusiness`/address structured data (Faktur has no physical
  presence in any of these towns); and every page is reachable through real
  internal links (this directory page), not only the sitemap.
- **Sitemap/robots**: `app/sitemap.ts` covers the whole public site, sharded
  via `generateSitemaps()` (~27,400 URLs across 14 files, well under the
  50,000-per-file protocol limit, sharded anyway for headroom — see the
  in-file comment). `app/robots.ts` allows `/faktury-pro` and disallows the
  authenticated dashboard sections.
- **Messages**: `municipalityPages` namespace in
  `messages/{cs,sk,en}.json` — all copy is templated/generic by design (see
  `lib/municipalities.ts` and the `[slug]/page.tsx` comment), not unique
  per municipality beyond the real name/region/district.

## Auth & channel linking (mocked)

Two flows exist as real, interactive UI wired to endpoints that don't exist
in the backend yet — see blueprint §6 (AI voice-to-invoice account linking)
and §9 (legal/liability, versioned ToS acceptance):

- **`(auth)/signup`** — company name / email / password form plus a
  required, non-preselected ToS checkbox (blueprint §9's "signup gate").
  Real: field state, HTML5 validation (`required`, `type="email"`,
  `minLength` on password), and the submit button staying disabled until
  the checkbox is checked. Mocked: `signup-form.tsx`'s `handleSubmit` only
  `console.log`s the payload — there is no `/api/v1/auth/signup` endpoint
  yet. The payload shape already includes `tosVersionAccepted` (a
  `TOS_VERSION` constant) and `acceptedAt`, matching the `tos_acceptances`
  audit table blueprint §9 requires.
- **`legal/terms`** — placeholder Terms of Service page linked from the
  signup checkbox. Deliberately not real legal text; the real VOP wording
  needs a Czech attorney per blueprint §9 — see "Legal & about pages"
  above.
- **`(dashboard)/settings/channels`** — shows linked Telegram/WhatsApp
  channels and a "Link Telegram" action. Real: the list rendering and the
  button's loading → generated-code → copy-to-clipboard state machine.
  Mocked: `MOCK_CHANNEL_LINKS` stands in for `GET /api/v1/channel-links`,
  and `link-telegram-button.tsx` generates its linking token client-side
  with `Math.random()` instead of calling a real endpoint — flagged inline
  as a TODO, because that dashboard-side "generate a code"
  `POST /api/v1/channel-links` endpoint was never in the original backend
  scaffold (only the bot-side `verify` callback was).

## Forgot / reset password

Real (not mocked) flow closing the last gap in the auth story — Google/Discord
OAuth login and email/password registration already worked; a user who
forgot their password had no way back in until now.

- **`(auth)/forgot-password`** — single email field. Submits to
  `POST /api/auth/forgot-password`. That endpoint ALWAYS returns the same
  generic success response, regardless of whether the email is registered
  or belongs to an OAuth-only user with no local password — a deliberate
  anti-enumeration measure, so the response can never be used to test which
  emails have accounts. The email itself, when sent, contains a
  `/reset-password?token=...` link.
- **`(auth)/reset-password`** — reads `?token=` from the URL, collects a new
  password + confirmation (client-side match check), submits to
  `POST /api/auth/reset-password`. Shows a clear success state (link to
  `/login`) or a clear invalid/expired-token state (link back to
  `/forgot-password`) — the two failure modes ("no such token" vs "token
  expired") are deliberately not distinguished in the response, same
  anti-enumeration reasoning as above.
- **Token storage** — reuses the existing Auth.js-adapter
  `verification_tokens` table (`lib/auth-schema.ts`) rather than a new
  table; only a SHA-256 hash of the token is stored (`identifier` = email,
  1-hour expiry), the raw token only ever exists in the emailed link. The
  token is single-use: the row is deleted immediately on a successful
  reset, and expired rows are swept opportunistically on every
  forgot-password request.
- **Email delivery** — `lib/email.ts` wraps Resend, reusing the same
  `RESEND_API_KEY`/`EMAIL_FROM` env vars the backend already uses for
  invoice emails (see `apps/backend/README.md` / `apps/backend/src/email/`
  for the shared setup notes — this frontend copy is a separate small
  wrapper, not a shared module, for the same reason `lib/auth-schema.ts`
  duplicates the backend's Auth.js tables instead of importing them).
- **Login page** — has a "Forgot password?" link next to the password field
  pointing at `/forgot-password`.

## Running

From the monorepo root (pnpm workspaces + Turborepo):

```bash
pnpm install
pnpm --filter @faktur/frontend dev
```

This starts `next dev`. The app has no standalone dev server config beyond
that — Postgres/Redis/backend are not required for the pages that exist
today, since the invoice list uses mock data (see the `MOCK_INVOICES` TODO
in `app/[locale]/(dashboard)/invoices/page.tsx`).

## Locale routing

- Locales: `cs` (default), `sk`, `en` — always prefixed in the URL
  (`/cs/...`, `/sk/...`, `/en/...`), configured in `i18n/routing.ts`.
- `middleware.ts` handles locale detection/redirection for all non-asset,
  non-API routes.
- Message catalogs live in `messages/{cs,sk,en}.json` and must stay
  structurally identical (same keys) across all three files.
- Import `Link`, `redirect`, `usePathname`, `useRouter` from
  `@/i18n/navigation` (not `next/link` / `next/navigation`) so links and
  redirects stay locale-aware.
- TODO: once Auth.js + `tenants.default_locale` exist (blueprint §4/§7), a
  signed-in tenant's stored locale preference should take precedence over
  the URL/browser `Accept-Language` default — see the TODO in
  `i18n/request.ts`.

## Structure

```
app/[locale]/layout.tsx                              Root locale layout (NextIntlClientProvider + ThemeProvider)
app/[locale]/page.tsx                                Public marketing homepage (navbar, hero, features, footer)
app/[locale]/(auth)/signup/page.tsx                  Signup page (server shell)
app/[locale]/(auth)/signup/signup-form.tsx           Signup form + ToS gate (client component)
app/[locale]/(auth)/login/page.tsx                   Login page (server shell)
app/[locale]/(auth)/login/login-form.tsx             Login form incl. "Forgot password?" link (client component)
app/[locale]/(auth)/forgot-password/page.tsx         Forgot-password page (server shell)
app/[locale]/(auth)/forgot-password/forgot-password-form.tsx  Forgot-password form (client component)
app/[locale]/(auth)/reset-password/page.tsx          Reset-password page (server shell, Suspense boundary)
app/[locale]/(auth)/reset-password/reset-password-form.tsx    Reset-password form (client component)
app/api/auth/forgot-password/route.ts                POST — issues a reset token + sends the reset email
app/api/auth/reset-password/route.ts                 POST — verifies token + updates password_hash
lib/email.ts                                         Resend wrapper for the password-reset email
app/[locale]/legal/terms/page.tsx                    Placeholder Terms of Service page (structural, pending attorney review)
app/[locale]/legal/privacy/page.tsx                  Placeholder Privacy Policy page (structural, pending attorney review)
app/[locale]/about/page.tsx                          About page (real marketing copy, not a placeholder)
app/[locale]/faktury-pro/page.tsx                    Municipality directory/browse page (grouped by region)
app/[locale]/faktury-pro/[slug]/page.tsx             Per-municipality local-SEO landing page (~159 static + ISR)
app/sitemap.ts                                       Sharded sitemap (generateSitemaps) for the whole public site
app/robots.ts                                        robots.txt — allows /faktury-pro, disallows dashboard routes
app/[locale]/(dashboard)/layout.tsx                  Top navbar + mobile bottom bar shell (no auth guard yet — TODO)
app/[locale]/(dashboard)/dashboard/page.tsx          Dashboard home (placeholder)
app/[locale]/(dashboard)/invoices/page.tsx           Invoice list, mock data, AI-draft disclaimer banner
app/[locale]/(dashboard)/contacts/page.tsx           Stub
app/[locale]/(dashboard)/settings/page.tsx           Stub (links to ./channels)
app/[locale]/(dashboard)/settings/channels/page.tsx        Linked channels list (mock data)
app/[locale]/(dashboard)/settings/channels/link-telegram-button.tsx  "Link Telegram" flow (client component)
app/[locale]/(dashboard)/billing/page.tsx            Stub
components/theme-provider.tsx                        next-themes wrapper (client boundary)
components/theme-toggle.tsx                          Sun/Moon light-dark toggle button
components/language-switcher.tsx                     EN/CZ/SK <select>, Globe icon
components/marketing-navbar.tsx                      Public site navbar (nav links, theme/lang, login/signup)
components/marketing-footer.tsx                       Public site footer (about/terms/privacy, copyright)
components/marketing-invoice-mockup.tsx              Decorative invoice card mockup used in the homepage hero
components/dashboard-nav.tsx                         Desktop dashboard navbar links (active-state aware)
components/mobile-bottom-nav.tsx                     Fixed mobile bottom bar, same 5 sections
components/user-menu.tsx                             Avatar + "Log out" dropdown placeholder (no real session)
lib/dashboard-nav-items.ts                           Shared nav item list for dashboard-nav + mobile-bottom-nav
lib/municipalities.ts                                Typed loader/helpers for data/municipalities.json
lib/site.ts                                          SITE_URL + SITE_NAME constants (see "App name centralization")
data/municipalities.json, data/README.md             Sourced CZ/SK municipality dataset + provenance docs
i18n/routing.ts, navigation.ts, request.ts           next-intl App Router config
middleware.ts                                        Locale routing middleware
messages/{cs,sk,en}.json                             Message catalogs
lib/utils.ts                                         shadcn/ui's `cn()` helper
components.json                                      shadcn CLI config (no components vendored yet)
```

## Adding shadcn/ui components

Only the config/dependencies are set up (`components.json`, `clsx`,
`tailwind-merge`, `class-variance-authority`, `lucide-react`) — no component
source has been vendored in. Once `pnpm install` has run, add components
with the shadcn CLI as needed, e.g.:

```bash
pnpm dlx shadcn@latest add button table badge
```
