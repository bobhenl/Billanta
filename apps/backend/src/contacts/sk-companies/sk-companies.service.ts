import { Injectable } from "@nestjs/common";
import { foldCompanyName, rankByName, type RpoSubject } from "@faktur/cz-compliance";
import { DbService } from "../../db/db.service";
import { likeContains, likePrefix, skIndexUsable, type SkSyncState } from "./sk-companies.util";

/** How long the "is the index usable" answer is reused; it changes once a night. */
const STATE_TTL_MS = 60 * 1000;
/** A very common fragment ("s.r.o") matches most of the table; better no hits than a stuck typeahead. */
const SEARCH_TIMEOUT_MS = 2000;

/**
 * Reads the local copy of the Slovak register (`sk_companies`, migration
 * 0058). Every method answers `null` when the index is empty or stale, which
 * tells the caller to ask RPO live as before. Global table, so the shared
 * pool (`DbService.sql`) is right here; there is no tenant data in it.
 */
@Injectable()
export class SkCompaniesService {
  private state: { at: number; usable: boolean } | null = null;

  constructor(private readonly dbService: DbService) {}

  async usable(): Promise<boolean> {
    if (this.state && this.state.at > Date.now() - STATE_TTL_MS) return this.state.usable;
    let usable = false;
    try {
      const [row] = await this.dbService.sql<{ init_date: string | null; daily_date: string | null; row_count: number }[]>`
        SELECT init_date::text, daily_date::text, row_count FROM sk_companies_sync WHERE id = 1`;
      const state: SkSyncState | null = row ? { initDate: row.init_date, dailyDate: row.daily_date, rowCount: row.row_count } : null;
      usable = skIndexUsable(state);
    } catch {
      // Table missing (migration not applied yet) or the database hiccuped: live RPO it is.
    }
    this.state = { at: Date.now(), usable };
    return usable;
  }

  /** The active subject with this IČO (the most recently founded when RPO has two), or null; `undefined` when the index is not usable. */
  async findByIco(ico: string): Promise<RpoSubject | null | undefined> {
    if (!(await this.usable())) return undefined;
    const [row] = await this.dbService.sql<{ ico: string; name: string; street: string | null; city: string | null; postal_code: string | null }[]>`
      SELECT ico, name, street, city, postal_code FROM sk_companies
      WHERE ico = ${ico.padStart(8, "0")}
      ORDER BY established_on DESC NULLS LAST
      LIMIT 1`;
    return row ? { ico: row.ico, name: row.name, street: row.street, city: row.city, postalCode: row.postal_code, terminatedAt: null } : null;
  }

  /** Active subjects whose name contains `query`, ranked like the live RPO search; `undefined` when the index is not usable. */
  async search(query: string, limit: number): Promise<RpoSubject[] | undefined> {
    if (!(await this.usable())) return undefined;
    const needle = foldCompanyName(query);
    if (needle.length < 3) return [];
    const rows = await this.dbService.sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = ${SEARCH_TIMEOUT_MS}`);
      // The trigram index finds the candidates; the ORDER BY mirrors rankByName so LIMIT keeps the best ones.
      return tx<{ ico: string; name: string; street: string | null; city: string | null; postal_code: string | null }[]>`
        SELECT ico, name, street, city, postal_code FROM sk_companies
        WHERE name_norm LIKE ${likeContains(needle)}
        ORDER BY (name_norm LIKE ${likePrefix(needle)}) DESC, length(name), established_on DESC NULLS LAST
        LIMIT ${limit * 4}`;
    });
    const subjects = rows.map((r) => ({ ico: r.ico, name: r.name, street: r.street, city: r.city, postalCode: r.postal_code, terminatedAt: null }));
    return rankByName(subjects, query, limit);
  }
}
