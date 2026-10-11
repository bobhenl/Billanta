# apps/backup — nightly Postgres backup -> Google Drive

Implements the backup requirement from `docs/CZ-SK-Invoicing-SaaS-Blueprint.md`
§8 (Security & GDPR): nightly logical (`pg_dump`) backup, pushed off-VPS,
30-day retention. The blueprint originally suggested Backblaze B2 / Hetzner
Object Storage; this implementation targets **Google Drive** instead (more
accessible for a solo founder — no separate object-storage account needed),
via [rclone](https://rclone.org/), which is destination-agnostic: switching
to B2/S3 later is a config change, not a code change (see "Using a different
remote" below).

**An untested backup is not a backup.** Read the "Restore" section below and
actually run it once now, then again every quarter.

---

## 1. One-time setup (do this yourself, not automatable)

Google Drive access requires an interactive OAuth consent flow in a browser,
which cannot happen inside an unattended container. You authorize it once,
on your own machine, and hand the resulting token to the container as a
read-only file.

1. Install rclone on your own machine: https://rclone.org/downloads/
2. Run:
   ```
   rclone config
   ```
3. Walk through the prompts:
   - `n` — New remote
   - name: `gdrive` (must match this exactly — `BACKUP_RCLONE_REMOTE` in
     `.env` refers to this name, e.g. `gdrive:faktur-backups`)
   - storage type: choose `drive` (Google Drive) from the list
   - client_id / client_secret: leave blank to use rclone's default
     (fine for personal use; create your own OAuth app in Google Cloud
     Console instead if you outgrow the shared default's rate limits)
   - scope: `1` (full access) or `2` (read/write, no delete of files rclone
     didn't create) — either works; `1` is simplest
   - root_folder_id / service_account: leave blank
   - "Edit advanced config?": `n`
   - "Use auto config?": `y` — this opens your browser for the Google OAuth
     consent screen. Log in and approve access.
   - "Configure this as a Shared Drive (Team Drive)?": `n` (unless you
     specifically want backups in a Shared Drive)
   - confirm the resulting config block, `y` to keep it, `q` to quit
4. This writes a config block like the following into rclone's own config
   file (usually `~/.config/rclone/rclone.conf` on the machine you ran this
   on):
   ```ini
   [gdrive]
   type = drive
   client_id =
   client_secret =
   scope = drive
   token = {"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}
   team_drive =
   ```
5. Copy that file (or just the `[gdrive]` block, if the file has other
   remotes you don't want to share) to this repo's root as `rclone.conf`:
   ```
   <repo-root>/rclone.conf
   ```
   This path is already gitignored (see root `.gitignore`) — **never commit
   this file**, it contains a live OAuth refresh token equivalent to a
   password for your Google Drive.
6. In your `.env` (copied from root `.env.example`), confirm:
   ```
   BACKUP_RCLONE_REMOTE=gdrive:faktur-backups
   BACKUP_RETENTION_DAYS=30
   BACKUP_INTERVAL_HOURS=24
   ```
   The path after the colon (`faktur-backups`) is a folder name/path inside
   your Drive — rclone creates it on first upload if it doesn't exist.
7. Start the stack as usual (`docker compose up -d`); the `backup` service
   picks up `rclone.conf` via the read-only volume mount in
   `docker-compose.yml`.

### How the container finds the config

`docker-compose.yml` mounts `./rclone.conf` (repo root) to
`/config/rclone/rclone.conf` read-only inside the container. The image sets
`XDG_CONFIG_HOME=/config` (see `apps/backup/Dockerfile`), which is rclone's
own convention for where to look, and `backup.sh` also passes
`--config /config/rclone/rclone.conf` explicitly, so it works even if that
env var were ever removed. The config is never baked into the image and
never committed to git.

---

## 2. Manually triggering a one-off backup (for testing)

With the stack running:

```
docker compose run --rm backup --once
```

This runs a single backup-and-prune cycle and exits (instead of looping
forever), so you can watch it succeed or fail in your terminal. Check for a
line like:

```
... [backup] SUCCESS: faktur-backup-20260101-030000.sql.gz uploaded to gdrive:faktur-backups
```

If it fails, the log line starts with `FAILURE:` and says why (missing
config, empty dump, upload error, etc.) — see "Troubleshooting" below.

You can also exec into the running long-lived service and trigger a run
without restarting it as `--once`:

```
docker compose exec backup /app/backup.sh --once
```

---

## 3. Restore procedure (test this quarterly — blueprint §8)

1. Get a backup file, either from Google Drive directly (download the
   `.sql.gz` file from the `faktur-backups` folder) or from the local
   staging volume:
   ```
   docker compose cp backup:/backups/faktur-backup-<timestamp>.sql.gz .
   ```
2. **Restore into a scratch database first** — never restore directly over
   the running production database without a very good reason. Spin up a
   throwaway Postgres (or a separate database on the same server) and point
   `DATABASE_URL` at that instead.
3. Restore:
   ```
   gunzip -c faktur-backup-<timestamp>.sql.gz | psql "$DATABASE_URL"
   ```
   (`pg_dump`'s default plain-SQL output is what `backup.sh` produces, so a
   plain `psql` replay is all that's needed — no `pg_restore`/custom-format
   tooling required.)
4. Sanity-check the restored data: row counts on a few key tables, a spot
   check of a recent invoice, RLS policies still present
   (`\d+ <table>` in `psql` should still show `ROW SECURITY`).
5. Record the date and outcome of the drill somewhere durable (a line in
   this file, a ticket, a calendar note) so "quarterly restore drills"
   is verifiable, not just aspirational.

If step 3 fails or produces obviously wrong data, that's exactly what this
drill is for — better to find out here than during a real incident.

---

## 4. What the script actually does (`backup.sh`)

Runs in a loop (`BACKUP_INTERVAL_HOURS`, default 24h) inside the container.
Each cycle:

1. `pg_dump $DATABASE_URL | gzip` -> `faktur-backup-<UTC timestamp>.sql.gz`
   in the local `/backups` volume.
2. Verifies the dump is non-empty and passes `gzip -t` before trusting it.
3. `rclone copy` uploads it to `BACKUP_RCLONE_REMOTE`.
4. Prunes backups older than `BACKUP_RETENTION_DAYS` (default 30), both
   locally (`find -mtime`) and on the remote (`rclone delete --min-age`).
5. Logs a `SUCCESS:` or `FAILURE:` line either way — this log is the only
   visibility into whether backups are working absent real monitoring
   (Sentry/uptime alerting on this service's logs is a good fast-follow;
   not implemented here).

Retention deliberately avoids hand-rolled shell date-arithmetic (Alpine's
BusyBox `date` doesn't support GNU's `-d "N days ago"` relative parsing):
local pruning uses `find -mtime +N` (mtime vs. filesystem clock, no date
string parsing) and remote pruning uses rclone's own `--min-age Nd` flag
(parsed by rclone itself). Both were verified against files planted with
ages of 10, 29, 31, and 45 days at a 30-day retention setting: 29-day files
survive, 31- and 45-day files are pruned, on both local and remote sides.

## Using a different remote (B2 / S3 / etc.)

Nothing in `backup.sh` is Google-Drive-specific — it just runs `rclone copy`
and `rclone delete` against whatever `BACKUP_RCLONE_REMOTE` points at. To
switch (or add a second destination), run `rclone config` again to add a
`[b2]` or `[s3]` remote, and change `BACKUP_RCLONE_REMOTE` in `.env`
accordingly (e.g. `BACKUP_RCLONE_REMOTE=b2:faktur-backups`). No script or
Dockerfile changes needed.

## Troubleshooting

- `FAILURE: no rclone config found at /config/rclone/rclone.conf` — the
  `./rclone.conf` file doesn't exist at the repo root yet, or the volume
  mount isn't in effect. Redo step 1.
- `FAILURE: pg_dump/gzip pipeline failed` — check `DATABASE_URL` is
  reachable from inside the container (`docker compose exec backup sh -c
  'pg_dump --version'` and check Postgres is up/healthy).
- `FAILURE: rclone upload ... failed` — usually an expired/revoked OAuth
  token or wrong remote name; re-run `rclone config` (step 1) and re-copy
  `rclone.conf`.
- `WARNING: remote prune step failed` — the backup itself still succeeded;
  old backups are just accumulating on the remote until this is fixed
  manually (`rclone delete` errors are usually permission or rate-limit
  related — check `docker compose logs backup`).
