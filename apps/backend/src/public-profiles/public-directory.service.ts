import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { filterDirectory, toDirectoryListing, type DirectoryListing, type DirectoryRow } from "./directory";

/**
 * The business directory (/directory and the town pages): public profiles
 * whose owners opted in. Read only through the SECURITY DEFINER function of
 * migration 0074, which returns nothing but the listed, public fields.
 */
@Injectable()
export class PublicDirectoryService {
  private cache: { at: number; rows: DirectoryListing[] } | null = null;

  constructor(private readonly dbService: DbService) {}

  /** A one-minute memo keeps a crawl of directory pages off the database. */
  async list(filter: { trade?: string; town?: string }): Promise<DirectoryListing[]> {
    if (!this.cache || Date.now() - this.cache.at > 60_000) {
      const rows = await this.dbService.db.execute<DirectoryRow>(sql`SELECT * FROM public_directory_profiles()`);
      this.cache = { at: Date.now(), rows: [...rows].map(toDirectoryListing).filter((l): l is DirectoryListing => l !== null) };
    }
    return filterDirectory(this.cache.rows, filter);
  }
}
