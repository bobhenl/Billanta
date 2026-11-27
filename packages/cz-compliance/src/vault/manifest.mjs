// Hash manifest for a web build that ships confidential.ts: the SHA-256 of
// the source file and of every built JavaScript file that contains a marker
// string from it. Anyone can then rebuild from the published source and
// compare. Plain Node (>= 20), no dependencies; the app decides where the
// build lives, which marker to look for and where to write the result.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The marker every build of confidential.ts contains (its key-check text). */
export const VAULT_MARKER = 'billanta-vault-v1';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function* jsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(path);
    else if (entry.name.endsWith('.js')) yield path;
  }
}

/**
 * `root`: the folder the served paths are relative to; `scan`: the folder
 * inside it to search; `prefix`: the URL path `root` is served at.
 * Returns the matching files sorted by path, each with its hash.
 */
export function markedFiles({ root, scan, prefix, marker = VAULT_MARKER }) {
  const out = [];
  for (const file of jsFiles(scan)) {
    const body = readFileSync(file);
    if (!body.includes(marker)) continue;
    out.push({ path: `${prefix}/${relative(root, file).split('\\').join('/')}`, sha256: sha256(body) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The manifest object (format 1). `repo` is null until the source is published. */
export function buildManifest({ sourceFile, sourcePath, repo, build, chunks }) {
  return {
    format: 1,
    name: 'billanta-vault',
    source: { repo: repo ?? null, path: sourcePath, sha256: sha256(readFileSync(sourceFile)) },
    build: build ?? null,
    generatedAt: new Date().toISOString(),
    chunks
  };
}
