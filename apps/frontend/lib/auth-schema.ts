/**
 * Auth.js (`@auth/drizzle-adapter`) tables — INTENTIONAL DUPLICATION, not a
 * shared package.
 *
 * The NestJS backend (`apps/backend/drizzle/schema.ts`) is the source of
 * truth for the `users` / `accounts` / `sessions` / `verification_tokens`
 * tables, since the backend owns migrations for the whole shared-schema
 * Postgres database (blueprint §4). The frontend needs its own Drizzle
 * client to hand to `DrizzleAdapter` (NextAuth v5 / Auth.js owns the
 * session/credential flow per blueprint §2), and there is no existing
 * `packages/` workspace shared between the two apps for this yet — so this
 * file duplicates JUST these four tables, column-for-column, rather than
 * importing the backend's schema module directly (the backend is a
 * separate NestJS app with its own build/deploy unit; reaching into
 * `apps/backend/drizzle/schema.ts` from `apps/frontend` would create an
 * awkward cross-app source dependency for a handful of table definitions).
 *
 * TODO: if this ever drifts from `apps/backend/drizzle/schema.ts` (a column
 * added/renamed on one side and not the other), extract both copies into a
 * proper `packages/auth-schema` (or similar) workspace package that both
 * apps depend on. Until then, any change to `users`/`accounts`/`sessions`/
 * `verification_tokens` in the backend schema MUST be mirrored here by hand.
 *
 * Only these four tables are duplicated — NOT `tenant_memberships` or any
 * other tenant-owned table. The frontend never queries tenant-scoped data
 * directly; it only mints a short-lived backend JWT (`lib/backend-token.ts`)
 * and lets the NestJS API enforce RLS/tenant-membership for everything else.
 *
 * ONE DELIBERATE NAMING DEVIATION from the backend's copy: `@auth/drizzle-
 * adapter`'s `DefaultPostgresAccountsTable` type (see its `lib/pg.d.ts`)
 * requires the OAuth-token columns on `accounts` to use snake_case
 * TypeScript property names (`refresh_token`, `access_token`, `expires_at`,
 * `token_type`, `id_token`, `session_state`) — not the camelCase
 * (`refreshToken`, `accessToken`, ...) the backend's copy uses, which is
 * otherwise this codebase's normal Drizzle convention. This is an Auth.js
 * quirk (its own `AdapterAccount` type is snake_case for exactly these
 * fields), not a mistake here — passing a camelCase-keyed table to
 * `DrizzleAdapter(...)` fails to typecheck. The underlying SQL column names
 * are identical either way (`text("refresh_token")` etc.), so this has zero
 * effect on the actual database schema — it only affects how these columns
 * are addressed from TypeScript in this one file.
 */
import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    // Nullable: a user who only ever signs in via Google/Discord OAuth has
    // no local password hash. Populated by `POST /api/auth/register`
    // (bcryptjs hash, never plaintext) — `@auth/drizzle-adapter` itself
    // never reads or writes this column.
    passwordHash: text("password_hash"),
    name: text("name"),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    // Two-factor sign-in (migration 0045, see lib/two-factor.ts): encrypted
    // TOTP secret, active once totpEnabledAt is set; recovery codes as hashes.
    totpSecret: text("totp_secret"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    totpRecoveryCodes: text("totp_recovery_codes").array(),
    totpLastStep: integer("totp_last_step"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
  }),
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    // snake_case JS keys below are REQUIRED by @auth/drizzle-adapter's
    // DefaultPostgresAccountsTable type — see this file's top doc comment.
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => ({
    providerAccountUnique: uniqueIndex("accounts_provider_provider_account_id_unique").on(
      table.provider,
      table.providerAccountId,
    ),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
  twoFactorPending: boolean("two_factor_pending").notNull().default(false),
  twoFactorAt: timestamp("two_factor_at", { withTimezone: true }),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => ({
    compositePk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
);
