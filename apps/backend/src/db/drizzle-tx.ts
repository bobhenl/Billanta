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
 *
 * ============================================================================
 * WHY THE `.options` PATCH — a second, RUNTIME gap the cast above doesn't
 * cover. Without this, every call below throws
 * `Cannot read properties of undefined (reading 'parsers')`.
 * ============================================================================
 * `drizzle-orm@0.33.0`'s `postgres-js/driver.js` unconditionally does
 * `client.options.parsers[type] = transparentParser` (and the equivalent for
 * `.serializers`) on every `drizzle()` call, for a handful of date/time OIDs
 * — this disables `postgres.js`'s automatic date parsing so drizzle can do
 * its own. `postgres.js@3.4.9` only ever assigns a `.options` property onto
 * the ORIGINAL top-level client returned by `Postgres(...)` (see
 * `postgres/src/index.js`'s `Postgres()` — the `Object.assign(sql, {...,
 * options, ...})` block). The transaction-scoped `sql` handed to
 * `sql.begin(async (tx) => ...)` is built via that same file's internal
 * `Sql(handler)` factory a second time (inside `begin()`'s `scope()`
 * helper), which never receives that assignment — so `tx.options` is
 * `undefined`, even though `tx` shares the same underlying pooled
 * connections (and therefore the same real wire-level parser/serializer
 * behavior) as the top-level client.
 *
 * That last point is why patching `tx.options` here is safe rather than a
 * behavior change: `DbService`'s constructor already calls
 * `drizzle(this.sql, { schema })` once at boot on the TOP-LEVEL client,
 * which mutates the real shared `options` object the pooled connections use
 * for actual wire (de)serialization. Every `sql.begin()` transaction reuses
 * one of those same pooled connections, so the meaningful patch is already
 * in effect process-wide by the time any transaction opens. The write this
 * function's caller triggers via `drizzle(tx, ...)` is therefore redundant
 * with — not a replacement for — that one-time patch; giving `tx` a fresh,
 * throwaway `{ parsers: {}, serializers: {} }` just gives `driver.js`
 * somewhere harmless to write, without touching the real shared parser
 * config `DbService` already established.
 */
export function drizzleTx<TSchema extends Record<string, unknown>>(
  tx: TransactionSql,
  schema: TSchema,
): PostgresJsDatabase<TSchema> {
  const client = tx as unknown as Sql;
  // A transaction handle has no `options` of its own; drizzle only reads the
  // two maps below from it, so a partial object is enough.
  const withOptions = client as unknown as { options?: { parsers: object; serializers: object } };
  if (!withOptions.options) {
    withOptions.options = { parsers: {}, serializers: {} };
  }
  return drizzle(client, { schema });
}
