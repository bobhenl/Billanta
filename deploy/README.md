# Deploying Billanta to the VPS

The VPS (`ssh voxelrank`) also runs VoxelRank and TicketSmith behind the
host's Caddy. Billanta lives in `/opt/billanta`:

- `deploy/docker-compose.prod.yml` runs Postgres, Redis, backend and frontend,
  plus `ai-service` under the `ai` profile. Each container has a memory cap
  and rotated logs. Only loopback ports are published: frontend on 3110,
  backend on 3111, AI on 3112.
- `deploy/Caddyfile.billanta` is the block added to `/etc/caddy/Caddyfile`.
  It serves `http://149.56.99.247:8090` until there is a domain.
- `.env` is written once by `deploy/init-env.sh` with random secrets. It is
  never committed. Third-party keys (Resend, Stripe, Anthropic, OAuth…) are
  added by hand, followed by `docker compose … up -d`.

## Deploy

```bash
deploy/deploy.sh
```

This builds the images locally (the VPS is too small to build Next.js) and
streams them over SSH. It then runs `migrate`, which applies the Drizzle
migrations, then the RLS policies (safe to re-run), then the grants.
Finally it restarts the stack and deletes the migrate image (about 2.6 GB),
because the disk is small and every deploy ships that image again.

`SKIP_BUILD=1` ships the images that are already built. `WITH_AI=1` also
builds and ships `ai-service`.

`NEXT_PUBLIC_*` values are baked into the frontend image at build time, so
they come from the environment of the machine running `deploy.sh`, not
from the server `.env`. Set the public contact address that way, e.g.
`NEXT_PUBLIC_CONTACT_EMAIL=hello@billanta.com deploy/deploy.sh` (empty: the
contact page shows no e-mail). Put the same value in the server `.env` too,
where the backend reads it for the Fakturoid import User-Agent.

Port 8090 is opened in ufw for access by IP. Once there is a domain behind
Cloudflare, switch to the Cloudflare block described in
`Caddyfile.billanta` and remove that rule.

## Cleanup

`deploy/maintenance.sh` runs daily from the `ubuntu` crontab:

```
15 3 * * * /opt/billanta/deploy/maintenance.sh >> /opt/billanta/logs/maintenance.log 2>&1
```

Each run:

- takes a `pg_dump` into `backups/` and keeps 14 days of dumps (`KEEP_DAYS`).
  With `BACKUP_AGE_RECIPIENT` (an [age](https://age-encryption.org) public
  key) in `.env` the dump is encrypted for that key and saved as
  `.dump.age`. With `BACKUP_REMOTE` (an rclone `remote:path`) too, it is
  copied there and remote copies older than 60 days are deleted
  (`REMOTE_KEEP_DAYS`). The private key never goes on the server; restore
  with `age -d -i billanta-backup.key billanta-….dump.age | pg_restore …`;
- deletes logs older than 30 days;
- prunes unused Docker images, build cache and stopped containers older
  than 3 days.

The image and cache prune covers all three apps on the box.
