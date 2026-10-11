// Drizzle Kit configuration — generates/applies SQL migrations from
// `drizzle/schema.ts`. RLS policies are NOT managed here (Drizzle Kit has no
// first-class RLS-policy DSL in this scaffold); apply `drizzle/rls-policies.sql`
// by hand after migrating. See README.md "Migrations" section.
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://faktur:faktur@localhost:5432/faktur",
  },
  // TODO (blueprint §4 point 4): migrations should run as a separate,
  // elevated migration-only Postgres role, distinct from the app's
  // NOBYPASSRLS runtime role. Not wired up in this scaffold — for now this
  // just points at DATABASE_URL like everything else.
  verbose: true,
  strict: true,
});
