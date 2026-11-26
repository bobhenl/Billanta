#!/usr/bin/env node
/**
 * Runs the production build locally (no on-demand page compiling) for demos:
 * backend on :3000, frontend on http://localhost:3100.
 *
 *   node scripts/local-prod.mjs           # build if the code changed, then start
 *   node scripts/local-prod.mjs --no-build
 *
 * Turbo hashes the sources, so an unchanged tree restores the last build from
 * its cache in seconds instead of running `next build` again. The frontend is
 * built without `output: 'standalone'` (see next.config.mjs), which Windows
 * cannot produce without symlink rights.
 */
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, NEXT_STANDALONE: '0' };
const run = (args) => spawn('pnpm', args, { cwd: root, env, stdio: 'inherit', shell: true });

if (!process.argv.includes('--no-build')) {
  const build = spawnSync(
    'pnpm',
    ['exec', 'turbo', 'run', 'build', '--filter=@faktur/frontend', '--filter=@faktur/backend'],
    { cwd: root, env, stdio: 'inherit', shell: true },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const children = [
  run(['--filter', '@faktur/backend', 'start']),
  run(['--filter', '@faktur/frontend', 'start', '-p', '3100']),
];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => { stop(); process.exitCode = code ?? 0; }));
