import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql, TransactionSql } from "postgres";

/**
 * Wraps `drizzle-orm/postgres-js`'s `drizzle()` for use with a `postgres.js`
 * transaction handle — the `tx` passed to `sql.begin(async (tx) => ...)` —
 * instead of a top-level pool client. Every RLS-scoped `sql.begin(...)` call
 * site in this backend (`TenantContextMiddleware`, `TenantBillingRepository`,
 * `SubscriptionEventsRepository`) needs this, because `drizzle-orm`'s own
 * `drizzle()` overload for `postgres-js` won't accept a transaction handle
 * directly — see the explanation below before assuming this is a bug to
 * "clean up."
 *
 * ============================================================================
 * WHY THE CAST — a real type-surface gap in `postgres`/`drizzle-orm`, not a
 * shortcut around one. Read this before touching the cast below.
 * ============================================================================
 * `drizzle-orm`'s `postgres-js` `drizzle()` is typed to accept only
 * `postgres`'s `Sql` interface. In `postgres`'s own type definitions
 * (`postgres/types/index.d.ts`), `Sql` and `TransactionSql` are SIBLING
 * interfaces: both extend a common `ISql` base (the tagged-template query
 * call, `.unsafe()`, `.json()`, etc.), but each adds its own extra members
 * that the other lacks — `Sql` adds `begin`/`end`/`CLOSE`/`listen`/etc.,
 * `TransactionSql` adds `savepoint`/`prepare`. They are NOT in a
 * sub/supertype relationship, so TypeScript correctly refuses to assign one
 * for the other structurally (`tsc` reports `TransactionSql` as "missing"
 * `Sql`'s extra members).
 *
 * At runtime this is a non-issue: everything `drizzle-orm` actually invokes
 * on the client it's handed — the tagged-template query function and
 * `.unsafe()` — lives on the shared `ISql` base both interfaces extend.
 * Drizzle never calls `.begin()`/`.end()`/`.CLOSE` on a client it wraps
 * (unsurprising: you cannot re-`begin()` a transaction that's already open),
 * so nothing it needs is actually missing from `TransactionSql` at runtime.
 * The cast here is scoped to exactly this narrow, verified-safe gap — it is
 * not a blanket `any`/`@ts-ignore` escape hatch, and does not weaken type
 * checking anywhere else.
 */
export function drizzleTx<TSchema extends Record<string, unknown>>(
  tx: TransactionSql,
  schema: TSchema,
): PostgresJsDatabase<TSchema> {
  return drizzle(tx as unknown as Sql, { schema });
}
