import { fingerprintOf } from "./archive-layout";

/**
 * The incremental part of the document archive, free of the database and of
 * SFTP/Drive so it is tested on its own (`archive-sync.spec.ts`).
 *
 * Each planned file carries a fingerprint of the data it is made from. A file
 * is uploaded when its path was never uploaded to this destination or the
 * fingerprint changed; the content (a PDF render, an ISDOC) is produced only
 * then. Files are never deleted remotely: the archive only grows, like the
 * retention it exists for.
 */
export interface ArchiveEntry {
  path: string;
  year: number;
  mime: string;
  fingerprint: string;
  load(): Promise<Buffer>;
}

export interface TrackedFile {
  fingerprint: string;
  remoteId: string | null;
}

export interface ArchiveUploader {
  /** Writes `data` at `path`; `remoteId` is the earlier upload of the same path, if any. */
  put(path: string, data: Buffer, mime: string, remoteId: string | null): Promise<{ remoteId: string | null }>;
}

export interface ArchiveTracker {
  record(path: string, fingerprint: string, remoteId: string | null, sizeBytes: number): Promise<void>;
}

/** age encryption of each file; `id` changes when the key or passphrase does. */
export interface ArchiveTransform {
  id: string;
  suffix: string;
  apply(data: Buffer): Promise<Buffer>;
}

export const PLAIN: ArchiveTransform = { id: "plain", suffix: "", apply: async (d) => d };

/** A first run of a big company is spread over several runs instead of one long one. */
export const MAX_ARCHIVE_FILES_PER_RUN = 500;

export interface ArchiveSyncResult {
  uploaded: number;
  unchanged: number;
  /** Still to upload, picked up by the next run. */
  remaining: number;
  /** Documents that could not be generated; the rest of the run goes on. */
  failed: { path: string; error: string }[];
}

/** What is stored per remote path: the source fingerprint bound to the encryption. */
export function storedFingerprint(entry: Pick<ArchiveEntry, "fingerprint">, transform: ArchiveTransform): string {
  return transform.id === PLAIN.id ? entry.fingerprint : fingerprintOf(entry.fingerprint, transform.id);
}

export function pendingEntries(entries: ArchiveEntry[], tracked: Map<string, TrackedFile>, transform: ArchiveTransform = PLAIN) {
  return entries.filter((e) => tracked.get(e.path + transform.suffix)?.fingerprint !== storedFingerprint(e, transform));
}

export async function syncArchive(opts: {
  entries: ArchiveEntry[];
  tracked: Map<string, TrackedFile>;
  uploader: ArchiveUploader;
  tracker: ArchiveTracker;
  transform?: ArchiveTransform;
  limit?: number;
}): Promise<ArchiveSyncResult> {
  const transform = opts.transform ?? PLAIN;
  const limit = opts.limit ?? MAX_ARCHIVE_FILES_PER_RUN;
  const pending = pendingEntries(opts.entries, opts.tracked, transform);
  const result: ArchiveSyncResult = { uploaded: 0, unchanged: opts.entries.length - pending.length, remaining: 0, failed: [] };

  for (const [i, entry] of pending.entries()) {
    if (result.uploaded >= limit) {
      result.remaining = pending.length - i;
      break;
    }
    let data: Buffer;
    try {
      data = await transform.apply(await entry.load());
    } catch (err) {
      result.failed.push({ path: entry.path, error: (err as Error).message });
      continue;
    }
    const remotePath = entry.path + transform.suffix;
    // An upload error (connection, quota) ends the run; what went up so far is recorded.
    const previous = opts.tracked.get(remotePath)?.remoteId ?? null;
    const { remoteId } = await opts.uploader.put(remotePath, data, transform.suffix ? "application/octet-stream" : entry.mime, previous);
    const fingerprint = storedFingerprint(entry, transform);
    await opts.tracker.record(remotePath, fingerprint, remoteId, data.length);
    opts.tracked.set(remotePath, { fingerprint, remoteId });
    result.uploaded++;
  }
  return result;
}
