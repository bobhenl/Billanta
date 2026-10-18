import { sql } from "drizzle-orm";
import type { DbService } from "../db/db.service";
import { parseLinkSegment } from "./public-link";

type Pool = Pick<DbService["db"], "execute">;

/**
 * The invoice's `public_token` for an /i/ link segment, or null. The public
 * SECURITY DEFINER functions are keyed on that UUID, so a short key is
 * mapped to it first (`invoice_public_token_by_key`) and everything after
 * stays exactly as it was for UUID links. Drafts and suspended companies
 * are still filtered by those functions, not here.
 */
export async function resolveInvoiceToken(db: Pool, segment: string): Promise<string | null> {
  const ref = parseLinkSegment(segment);
  if (!ref) return null;
  if (ref.kind === "uuid") return ref.value;
  const rows = await db.execute<{ token: string | null }>(sql`SELECT invoice_public_token_by_key(${ref.value}) AS token`);
  return rows[0]?.token ?? null;
}

/** The contact's `portal_token` for a /c/ link segment, or null (same idea as `resolveInvoiceToken`). */
export async function resolvePortalToken(db: Pool, segment: string): Promise<string | null> {
  const ref = parseLinkSegment(segment);
  if (!ref) return null;
  if (ref.kind === "uuid") return ref.value;
  const rows = await db.execute<{ token: string | null }>(sql`SELECT contact_portal_token_by_key(${ref.value}) AS token`);
  return rows[0]?.token ?? null;
}
