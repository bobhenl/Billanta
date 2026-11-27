// Runs after `next build`: writes public/.well-known/billanta-vault.json, so
// anyone can compare what their browser loads with the published vault
// crypto (Settings → Důvěrný režim and /security/confidential show it). The
// hashing itself lives with the crypto (packages/cz-compliance/src/vault/
// manifest.mjs); this file only knows where Next puts the build.
//
// `repo` comes from lib/vault/source.json and stays null until the crypto
// folder is published as its own public repository.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, markedFiles, VAULT_MARKER } from '../../../packages/cz-compliance/src/vault/manifest.mjs';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(join(app, 'lib/vault/source.json'), 'utf8'));
const staticDir = join(app, '.next/static');

const chunks = markedFiles({ root: staticDir, scan: join(staticDir, 'chunks'), prefix: '/_next/static' });
if (chunks.length === 0) {
  // A build without the crypto chunk would publish an empty promise: fail loudly instead.
  console.error(`vault-manifest: no chunk in .next/static contains "${VAULT_MARKER}"`);
  process.exit(1);
}

const sourceFile = join(app, '../..', source.path, source.file);
const manifest = buildManifest({
  sourceFile,
  sourcePath: `${source.path}/${source.file}`,
  repo: source.repo,
  build: process.env.NEXT_PUBLIC_BUILD_STAMP,
  chunks
});

const out = join(app, 'public/.well-known/billanta-vault.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
// The source itself, byte for byte, so its hash can be checked against the
// manifest without waiting for a separate repository. .txt, because a .ts
// file would be served as a video stream.
copyFileSync(sourceFile, join(app, 'public/.well-known/billanta-vault-source.txt'));
console.log(`vault-manifest: ${chunks.length} chunk(s) → ${relative(app, out)}`);
