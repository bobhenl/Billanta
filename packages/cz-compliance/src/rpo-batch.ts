/**
 * RPO bulk export ("dávkové súbory"), documented at
 * https://rpo.minv.sk/rpo-api-doc.html: a full snapshot every month (first
 * Saturday, `batch-init/init_YYYY-MM-DD_NNN.json.gz`, ~23 files, ~930 MB
 * gzipped, ~2.3 M subjects of which ~1 M are active) and a delta every night
 * (`batch-daily/actual_YYYY-MM-DD.json.gz`, ~1 MB). Both stay for 45 days.
 * Each record has the shape of the RPO detail response. Data © ŠÚ SR / MV SR,
 * CC BY 4.0.
 *
 * The backend builds a local name index from it (apps/backend
 * `sk-companies`), because the live RPO search takes 3-9 s per query.
 * Everything here except the two fetchers is pure.
 */
import { foldCompanyName, mapRpoResult } from './rpo-client.js';

export const RPO_BATCH_URL = 'https://frkqbrydxwdp.compat.objectstorage.eu-frankfurt-1.oraclecloud.com/susr-rpo/';

/** One active Slovak subject, as the local index stores it. */
export interface RpoIndexRow {
  rpoId: number;
  ico: string;
  name: string;
  nameNorm: string;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  legalForm: string | null;
  establishedOn: string | null;
}

/** What one batch record does to the index: an active subject is upserted, anything else removed. */
export type RpoBatchEntry = { kind: 'upsert'; row: RpoIndexRow } | { kind: 'remove'; rpoId: number };

interface RpoBatchRecord {
  id: number;
  identifiers?: { value: string; validTo?: string }[];
  fullNames?: { value: string; validTo?: string }[];
  addresses?: Parameters<typeof mapRpoResult>[0]['addresses'];
  legalForms?: { value?: { code?: string }; validTo?: string }[];
  establishment?: string;
  termination?: string;
}

/**
 * The files are one JSON document, but written one record per line:
 * `{"exportDate":…,"results":[`, then `{…}` / `,{…}` lines, then `]}`.
 * So a line is parsed on its own and memory stays at one record. Returns
 * null for the header, the footer and anything that is not a record.
 */
export function parseRpoBatchLine(line: string): RpoBatchRecord | null {
  let t = line.trim();
  const header = t.indexOf('"results":[');
  if (t.startsWith('{"exportDate"') && header >= 0) t = t.slice(header + '"results":['.length).trim();
  if (t.startsWith(',')) t = t.slice(1);
  if (t.endsWith(',')) t = t.slice(0, -1);
  if (!t.startsWith('{')) return null;
  for (const candidate of [t, t.endsWith(']}') ? t.slice(0, -2) : null]) {
    if (!candidate) continue;
    try {
      const r = JSON.parse(candidate) as RpoBatchRecord;
      return typeof r?.id === 'number' ? r : null;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function rpoBatchEntryOf(r: RpoBatchRecord): RpoBatchEntry {
  const subject = r.termination ? null : mapRpoResult({ ...r, termination: undefined });
  // Some subjects (branches, units of public bodies) carry a longer
  // identifier instead of an IČO. Nobody types those into an invoice and the
  // column is varchar(8), so they are left out like inactive ones.
  if (!subject || !/^\d{8}$/.test(subject.ico)) return { kind: 'remove', rpoId: r.id };
  const form = r.legalForms?.find((f) => !f.validTo) ?? r.legalForms?.[r.legalForms.length - 1];
  return {
    kind: 'upsert',
    row: {
      rpoId: r.id,
      ico: subject.ico,
      name: subject.name,
      nameNorm: foldCompanyName(subject.name),
      street: subject.street,
      city: subject.city,
      postalCode: subject.postalCode,
      legalForm: form?.value?.code ?? null,
      establishedOn: /^\d{4}-\d{2}-\d{2}$/.test(r.establishment ?? '') ? r.establishment! : null,
    },
  };
}

/** What the index has applied so far. Dates are export dates, `YYYY-MM-DD`. */
export interface RpoSyncState {
  initDate: string | null;
  dailyDate: string | null;
}

export interface RpoSyncPlan {
  /** A full snapshot to load first (and then drop every row it did not contain), or null. */
  init: { date: string; keys: string[] } | null;
  /** Daily deltas to apply after it, oldest first. */
  dailies: { date: string; key: string }[];
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Which files bring the index up to date. A newer snapshot than the one
 * loaded is always taken (it also drops subjects deleted from RPO, which the
 * deltas never mention); so is any snapshot when a gap in the deltas means
 * changes were missed (the bucket keeps 45 days, a stopped cron can fall
 * behind). An init counts only once its `_list.txt` manifest is there, so a
 * snapshot still being uploaded is not half-loaded.
 */
export function planRpoSync(keys: string[], state: RpoSyncState): RpoSyncPlan {
  const inits = new Map<string, string[]>();
  const manifests = new Set<string>();
  const dailies: { date: string; key: string }[] = [];
  for (const key of keys) {
    let m = /^batch-init\/init_(\d{4}-\d{2}-\d{2})_\d+\.json\.gz$/.exec(key);
    if (m) inits.set(m[1]!, [...(inits.get(m[1]!) ?? []), key]);
    else if ((m = /^batch-init\/init_(\d{4}-\d{2}-\d{2})_list\.txt$/.exec(key))) manifests.add(m[1]!);
    else if ((m = /^batch-daily\/actual_(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(key))) dailies.push({ date: m[1]!, key });
  }
  dailies.sort((a, b) => a.date.localeCompare(b.date));
  const newestInit = [...inits.keys()].filter((d) => manifests.has(d)).sort().pop() ?? null;

  const applied = state.dailyDate && state.initDate && state.dailyDate > state.initDate ? state.dailyDate : state.initDate;
  const gap = applied !== null && dailies.length > 0 && dailies[0]!.date > addDays(applied, 1);
  const takeInit = newestInit !== null && (state.initDate === null || newestInit > state.initDate || gap);

  const after = takeInit ? newestInit! : applied;
  return {
    init: takeInit ? { date: newestInit!, keys: inits.get(newestInit!)!.sort() } : null,
    dailies: after === null ? [] : dailies.filter((d) => d.date > after),
  };
}

/** `<Key>` entries and the continuation token of one S3 ListObjectsV2 page. */
export function parseBucketListing(xml: string): { keys: string[]; next: string | null } {
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = truncated ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null;
  return { keys, next };
}

/** Every object key in the RPO export bucket. */
export async function listRpoBatchKeys(opts: { baseUrl?: string; timeoutMs?: number } = {}): Promise<string[]> {
  const base = opts.baseUrl ?? RPO_BATCH_URL;
  const keys: string[] = [];
  let next: string | null = null;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ 'list-type': '2', ...(next ? { 'continuation-token': next } : {}) });
    const res = await fetch(`${base}?${params}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
    if (!res.ok) throw new Error(`RPO batch listing responded ${res.status}`);
    const parsed = parseBucketListing(await res.text());
    keys.push(...parsed.keys);
    if (!(next = parsed.next)) break;
  }
  return keys;
}

/**
 * Streams one gzipped batch file line by line, without keeping it on disk or
 * in memory (an init file is ~100 MB gzipped, ~1 GB of JSON).
 */
export async function* readRpoBatchLines(key: string, opts: { baseUrl?: string } = {}): AsyncGenerator<string> {
  const res = await fetch(`${opts.baseUrl ?? RPO_BATCH_URL}${key}`);
  if (!res.ok || !res.body) throw new Error(`RPO batch ${key} responded ${res.status}`);
  const text = res.body.pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream());
  let rest = '';
  for await (const chunk of text as unknown as AsyncIterable<string>) {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop() ?? '';
    yield* lines;
  }
  if (rest) yield rest;
}
