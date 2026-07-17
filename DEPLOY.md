# Production deployment

The compose stack is self-contained; a **host-level nginx** (managed by ops)
terminates TLS in front of it.

> **Current rollout:** internal testing for team members (not public users yet).
> The shipped `.env.production` runs in *relaxed* mode — simple secrets +
> `CORS_ORIGINS=*` — which is fine for a trusted internal audience. Before a
> public launch, harden the two values called out in
> [Before going public](#before-going-public).

## Topology

```
                      TLS (443)          127.0.0.1:8080        docker network
  Internet  ───►  Host nginx (ops)  ───►  frontend (nginx)  ───►  backend  ───►  db
                  domain + certs          SPA + /api,/ws proxy      FastAPI      Postgres
```

- **Host nginx** (ops): HTTPS, the domain, forwards everything to `127.0.0.1:8080`. Sample: [`deploy/nginx.host.conf.example`](deploy/nginx.host.conf.example).
- **frontend container**: serves the built SPA and reverse-proxies `/api` + `/ws` to the backend — so ops never touches the backend directly.
- **backend / db**: internal to the compose network; ports bind to `127.0.0.1` only.

## The env file — `.env.production` is delivered, not pulled

`.env.production` holds the SMTP password, so it is **gitignored** — `git pull`
will **not** bring it to the server. Deliver the filled file out-of-band (e.g.
`scp` it, or paste it into a file on the server). Never commit it.

One naming gotcha: `docker compose` reads a file literally named **`.env`**, not
`.env.production`. So once the file is on the server, either:

```bash
mv .env.production .env                         # simplest, then plain `docker compose up`
# — or — keep the name and pass it every time:
docker compose --env-file .env.production up -d --build
```

The committed `.env.production.example` documents the *strict* production shape
(random secrets, real domain in CORS). It is a reference only — the actual deploy
uses the filled `.env.production` you were handed.

## Ports — set them in the env file, never edit the compose file

Only **two** host ports are published, both driven by env vars. Postgres has no
host port at all, so it can never collide.

| Service  | Host binding (default)     | Env var         | Conflicts? | If you change it… |
|----------|----------------------------|-----------------|------------|-------------------|
| frontend | `127.0.0.1:8080` → :80     | `FRONTEND_PORT` | possible   | **also update the host nginx `proxy_pass`** |
| backend  | `127.0.0.1:8000` → :8000   | `BACKEND_PORT`  | possible   | nothing else — localhost debug only |
| db       | *not published*            | —               | **never**  | — |

If `8080` or `8000` is already taken on the server, bump the value in
`.env.production` (or `.env`) — do **not** hand-edit `docker-compose.yml`.

The single cross-file linkage to remember: **`FRONTEND_PORT` must match the host
nginx upstream.** If you set `FRONTEND_PORT=9090`, the nginx config must say
`proxy_pass http://127.0.0.1:9090;`. `BACKEND_PORT` needs **no** nginx change —
nginx never talks to the backend directly (the frontend container proxies `/api`
+ `/ws` internally); that port is only for `curl`-ing the backend from the server
shell while debugging.

## Deploy flow

On the server, in the repo root:

```bash
git pull

# 1. Put the delivered .env.production in place, then fix ports if they collide:
mv .env.production .env
#    - edit FRONTEND_PORT / BACKEND_PORT in .env if 8080 / 8000 are taken
#    - relaxed mode is already set: APP_ENV=development, SEED_DEMO_DATA=false,
#      simple JWT_SECRET_KEY, CORS_ORIGINS=*, real SMTP filled in

# 2. Configure host nginx (see below) — matching FRONTEND_PORT in the upstream.

# 3. Bring the stack up:
docker compose up -d --build
docker compose ps                 # all three healthy?
docker compose logs -f backend    # watch migrations + seed on first boot
```

Sanity-check locally on the host (before wiring the domain):

```bash
curl -I http://127.0.0.1:8080          # SPA → 200  (use your FRONTEND_PORT)
curl -s http://127.0.0.1:8080/api/metadata/states   # proxied API through the frontend nginx
```

> Relaxed mode logs each OTP to `docker compose logs backend` **and** emails it via
> the configured Gmail SMTP — handy if a tester doesn't receive the email.

## Ops' part — host nginx + TLS

Hand [`deploy/nginx.host.conf.example`](deploy/nginx.host.conf.example) to the
server admin. They:

1. Set the real `server_name` and TLS cert paths (e.g. certbot).
2. Point the upstream at the frontend container — `proxy_pass http://127.0.0.1:8080;`
   (change `8080` to whatever `FRONTEND_PORT` was set to).
3. Ensure the `map $http_upgrade $connection_upgrade { … }` block is present at the `http{}` scope (needed for WebSockets).
4. `nginx -t && systemctl reload nginx`.

That's all they need — one upstream (`127.0.0.1:$FRONTEND_PORT`) with WebSocket upgrade.

## Updating a running deployment

```bash
git pull
docker compose up -d --build     # rebuilds changed images, re-applies migrations on boot
```

Migrations run automatically at backend startup. `docker compose down` keeps the
DB; `down -v` wipes it.

## Before going public

The relaxed settings are deliberate for internal testing. Before real users:

1. **`JWT_SECRET_KEY`** → `openssl rand -hex 32` (do it during a planned cutover —
   it invalidates existing sessions).
2. **`CORS_ORIGINS`** → your real `https://<domain>` (drop the `*`).

Optionally flip `APP_ENV=production` for strict mode; with real SMTP + a non-default
JWT key + the Postgres DB URL, the boot-time guardrail will pass. In strict mode the
OTP is emailed only (no longer printed to the logs).

## Scaling out (pgbouncer + multiple workers + read replica)

The base compose is a single backend instance — fine for internal testing. For
high concurrency (the load-test report sizes ~50k concurrent users), use the
scale overlay, which adds **pgbouncer** in front of Postgres and runs the backend
with **multiple uvicorn workers**:

```bash
# one-time: create the pgbouncer auth file from the example and fill in the
# real SCRAM verifier (SELECT rolname, rolpassword FROM pg_authid;)
cp deploy/pgbouncer/userlist.txt.example deploy/pgbouncer/userlist.txt

docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --build
```

What it changes (all overridable in `.env`):

- **pgbouncer** (`pool_mode=transaction`) multiplexes many app connections down to
  a few real Postgres connections. The backend's `DATABASE_URL` points at it;
  `ALEMBIC_DATABASE_URL` still points at the real primary (DDL + the boot advisory
  lock must not run on a pooled connection).
- **`UVICORN_WORKERS`** (default 4) — one process per core; the boot advisory lock
  serializes their migrate/seed so they don't race.
- **`DB_POOL_SIZE` / `DB_MAX_OVERFLOW`** kept small per worker so
  `workers × pool` stays under pgbouncer's `default_pool_size`.
- **`POSTGRES_MAX_CONNECTIONS`** (default 300) raises Postgres's ceiling for the
  pgbouncer server pool.
- **`READ_DATABASE_URL`** — point at a read replica to route reference-data
  (`/api/metadata/*`) reads off the primary. Unset ⇒ everything hits the primary.
- **`RATE_LIMIT_STORAGE_URI`** — set to `redis://…` so the rate limiter is shared
  across workers (in-memory storage is per-process). `TRUST_PROXY_HEADERS=true` is
  set so each real client gets its own bucket behind the proxy.

Still per-process (needs Redis pub/sub to go truly multi-worker for live
monitoring): the WebSocket connection manager. Candidate sockets work fine on any
worker, but an admin monitor only sees candidates on its own worker until that's
added. See `loadtest/REPORT.md` for the full 50k topology.

## Notes / follow-ups

- **Backups**: schedule `pg_dump` against the `db` service (or back up the `db_data` volume). Not included here.
- **Real client IPs**: rate limiting sees the proxy IP by default. Set `TRUST_PROXY_HEADERS=true` so the backend keys limits on the `X-Forwarded-For` client (forwarded by both nginx layers).
- **Secrets**: keep the filled `.env` off git (it's already gitignored) and readable only by the deploy user. The pgbouncer `userlist.txt` is gitignored too.
