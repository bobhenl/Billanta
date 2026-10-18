/**
 * Manual run of the Slovak register import, outside the Nest app (no HTTP
 * server, no other crons). See the README, "Slovak company index".
 *
 *   node dist/src/contacts/sk-companies/sk-companies-import.cli.js [--full]
 *   node -r ts-node/register src/contacts/sk-companies/sk-companies-import.cli.ts [--full]   # dev
 *
 * Needs DATABASE_URL. --full reloads the newest snapshot even if it is loaded.
 */
import postgres from "postgres";
import { importSkCompanies, pgSkCompaniesStore } from "./sk-companies-import";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 2 });
  const started = Date.now();
  try {
    const r = await importSkCompanies(pgSkCompaniesStore(sql), {
      full: process.argv.includes("--full"),
      log: (m) => console.log(`${((Date.now() - started) / 1000).toFixed(0)}s ${m}`),
    });
    if (r.skipped) console.log("another import is running; nothing done");
    else console.log(JSON.stringify({ ...r, seconds: Math.round((Date.now() - started) / 1000) }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`sk-companies import failed: ${(err as Error).message}`);
  process.exit(1);
});
