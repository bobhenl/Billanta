import { bankTransactionFingerprint } from "@faktur/cz-compliance";

/**
 * Duplicate check for incoming bank movements, pure so it can be tested
 * without a database. The same payment can reach us more than once: the
 * Fio API and an uploaded statement of the same account, two overlapping
 * statements, or the same file uploaded twice.
 *
 * 1. A row whose `externalId` (bank movement id) is already stored is a
 *    duplicate. That covers re-syncs and re-uploads of files with ids.
 * 2. Otherwise the row is compared by fingerprint (day, amount, currency,
 *    VS, payer account). The fingerprint is not unique: one payer can send
 *    the same amount with the same VS twice on one day. So each stored row
 *    can absorb only one incoming row, and twins in one upload stay twins.
 * 3. Stored rows that carry an id from the *same* source as the incoming
 *    row (same id prefix, e.g. both "fio:") never absorb it: that source
 *    would have sent the same id, so a different id there is a different
 *    payment.
 *
 * When an incoming row with an id is absorbed by a stored row without one
 * (a CSV upload, then the API), the stored row takes over the id ("claim"),
 * so later rows from that source are recognised by rule 1 or 3.
 */

export interface DedupeRow {
  externalId?: string | null;
  transactionDate: Date;
  amount: string;
  currency: string;
  variableSymbol: string | null;
  counterpartyAccount: string | null;
}

export interface StoredDedupeRow extends DedupeRow {
  id: string;
  externalId: string | null;
}

export interface DedupeResult<T> {
  fresh: T[];
  duplicates: number;
  /** Stored rows without an id that should take over the id of the incoming row they absorbed. */
  claims: { id: string; externalId: string }[];
}

/** "fio:123" → "fio"; ids without a prefix and null have no source. */
function source(externalId: string | null | undefined): string | null {
  if (!externalId) return null;
  const colon = externalId.indexOf(":");
  return colon > 0 ? externalId.slice(0, colon) : null;
}

function fingerprint(row: DedupeRow): string {
  return bankTransactionFingerprint({
    date: row.transactionDate,
    amount: row.amount,
    currency: row.currency,
    variableSymbol: row.variableSymbol,
    counterpartyAccount: row.counterpartyAccount,
  });
}

export function splitDuplicates<T extends DedupeRow>(incoming: T[], stored: StoredDedupeRow[]): DedupeResult<T> {
  const knownIds = new Set(stored.map((s) => s.externalId).filter((id): id is string => Boolean(id)));
  const byFingerprint = new Map<string, StoredDedupeRow[]>();
  for (const row of stored) {
    const key = fingerprint(row);
    byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), row]);
  }

  const used = new Set<string>();
  const fresh: T[] = [];
  const claims: DedupeResult<T>["claims"] = [];
  let duplicates = 0;

  for (const row of incoming) {
    const id = row.externalId ?? null;
    if (id && knownIds.has(id)) {
      duplicates++;
      continue;
    }

    const rowSource = source(id);
    const candidates = (byFingerprint.get(fingerprint(row)) ?? []).filter(
      (s) => !used.has(s.id) && (rowSource === null || source(s.externalId) !== rowSource),
    );
    // A row without an id first, so the id can be handed over to it.
    const absorbedBy = candidates.find((s) => s.externalId === null) ?? candidates[0];
    if (!absorbedBy) {
      fresh.push(row);
      // Also guards against the same id twice in one batch.
      if (id) knownIds.add(id);
      continue;
    }

    used.add(absorbedBy.id);
    duplicates++;
    if (id && absorbedBy.externalId === null) {
      claims.push({ id: absorbedBy.id, externalId: id });
      knownIds.add(id);
    }
  }

  return { fresh, duplicates, claims };
}
