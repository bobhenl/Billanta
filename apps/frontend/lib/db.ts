/**
 * Frontend's own Postgres connection — separate from the NestJS backend's
 * (`apps/backend/src/db/db.service.ts`), but pointed at the SAME physical
 * database via the same `DATABASE_URL` (see `.env.example`). Used only for
 * the Auth.js-adapter tables in `./auth-schema.ts` (`users`/`accounts`/
 * `sessions`/`verification_tokens`) — the frontend never queries any
 * tenant-scoped table directly; that goes through the backend's REST API
 * with a minted backend JWT (`./backend-token.ts`) so Postgres RLS applies.
 *
 * `users` has no RLS policy (see `apps/backend/drizzle/rls-policies.sql`'s
 * "Deliberately EXCLUDED" section), so a plain pooled connection here is
 * fine — there is no `app.current_tenant_id` concern for these four tables.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./auth-schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see .env.example");
}

// A small dedicated pool, distinct from the backend's — Next.js may run
// this in a serverless/edge-adjacent Node runtime where a very large pool
// isn't appropriate; `max: 5` is a conservative default for a scaffold.
const sql = postgres(connectionString, { max: 5 });

export const db = drizzle(sql, { schema: authSchema });
