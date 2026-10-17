# deploy — production on a single VPS

See `README.md` here for the full procedure. Billanta lives in
`/opt/billanta` on a shared VPS (`ssh voxelrank`) that **also runs the
VoxelRank and TicketSmith production sites** behind the host's Caddy.

- `docker-compose.prod.yml`: Postgres, Redis, backend and frontend, plus
  `ai-service` under the `ai` profile. Only loopback ports are published
  (3110 frontend, 3111 backend, 3112 AI). Every container has a memory cap.
- `deploy.sh` builds the images locally, streams them over SSH and runs
  migrate (migrations, then RLS policies, then grants). Then it restarts and
  removes the migrate image. Use `SKIP_BUILD=1` or `WITH_AI=1`.
- `init-env.sh` writes the server `.env` once with random secrets.
  `maintenance.sh` runs daily from cron: `pg_dump` rotation, log cleanup
  and Docker prune.

## Rules

- Deploying, restarting or stopping anything on the VPS is an outward-facing
  action. **Ask first.**
- Don't disturb the other sites. Before touching `/etc/caddy/Caddyfile`,
  back it up and run `caddy validate`. Reload; don't restart.
- The disk is small (about 40 GB). Don't build on the server. Prune build
  cache and images after big deploys.
- Never print or commit the server `.env` or any secret from it.
- A migration must be safe to run on live data and idempotent. The deploy
  re-runs `rls-policies.sql` and `app-role-grants.sql` every time.
