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
3. **Work through "Data protection rollout" below.** With `APP_ENV=production` the
   app now REFUSES to boot without the encryption and audit keys, `ALLOWED_HOSTS`,
   a real DPO contact, and demo/mock data off. That is deliberate: booting without
   them means the platform cannot honestly claim protections the MOU commits us to.

In strict mode (`APP_ENV=production`) the OTP is emailed only (no longer printed
to the logs).

## Before a test goes live (capacity)

A scheduled test is the platform's peak: a few hundred health workers sign in
within a couple of minutes. Measured on a 16-core box with one worker:

| Arrival pattern | Result |
|---|---|
| 300 sign-ins, spread over a few seconds | **300/300 succeed in ~12s**, p95 wait 2.0s |
| 300 sign-ins, all sockets in the same instant | 212 succeed, 88 get a retryable **503 + Retry-After** |

Sustained throughput is **~26 sign-ins/second per worker**. The wall is bcrypt,
not the database — each verification costs ~310ms of CPU at `BCRYPT_ROUNDS=12`,
so 300 sign-ins is ~93 CPU-seconds however the rest is tuned.

**If a cohort is larger than ~300, or the box has few cores:**

1. **Add workers** (`--workers N`, N ≈ cores). Capacity scales with CPU. Also set
   `RATE_LIMIT_STORAGE_URI=redis://…` so the ceilings are shared rather than
   per-process, and keep `(DB_POOL_SIZE + DB_MAX_OVERFLOW) × N` under the
   Postgres `max_connections`.
2. **`BCRYPT_ROUNDS=10`** — roughly 4× cheaper. Existing hashes are upgraded in
   place on each user's next sign-in, so no reset is needed. 10 is the floor
   OWASP still accepts for bcrypt; this weakens offline-cracking resistance, so
   prefer more cores if you can have them.
3. **Stagger the start.** Arrivals spread over even 30 seconds are trivially
   handled — the pathological case above is 300 sockets in one instant, which
   real users do not produce.

> **Do NOT tighten the sign-in rate limits to "harden" this.** They are flood
> ceilings, not brute-force controls. A whole ICDS block office reaches the
> internet through one NAT address, so a per-address limit tuned for one human
> throttles a district while doing nothing to an attacker, who has many
> addresses. Brute force is handled per **account** by the lockout table.
> The original `10/minute` setting was measured refusing 50 of 60 legitimate
> sign-ins from one address.

Rate limiting now sits at two levels:

- **nginx** (`deploy/nginx.host.conf.example`) sheds volumetric floods before
  they cost a worker or a connection. Add your office/NAT egress addresses to
  the `geo $nh_limit_key` exemption block so a test start can never be
  throttled at the edge.
- **The application** limits unauthenticated endpoints by address (generous
  ceilings) and authenticated ones by **account** — exports at
  `RATE_LIMIT_EXPORT`, pipeline runs at `RATE_LIMIT_PIPELINE`. Keying on the
  account is what makes those safe to set tight: a shared office address is
  many accounts, but a stolen token is one.

## Data protection rollout

Full rationale in **`SECURITY.md`**. The order matters — steps 5 and 6 lock people
out if done early.

```bash
# 1. Generate the keys ON THE SERVER and add them to .env
docker compose exec backend python -c \
  "from app.security.crypto import generate_key; print('v1:'+generate_key())"   # PHI_ENCRYPTION_KEYS
openssl rand -base64 32    # PHI_INDEX_KEY
openssl rand -hex 32       # AUDIT_HMAC_KEY   (MUST differ from JWT_SECRET_KEY)
```

2. Fill in `DPO_NAME`, `DPO_EMAIL`, `DPO_PHONE`, `ALLOWED_HOSTS`, `PUBLIC_BASE_URL`,
   and set `ALLOW_DEV_ADMIN=false`, `ENABLE_API_DOCS=false`, `SERVE_LOCAL_UPLOADS=false`,
   `TRUST_PROXY_HEADERS=true`. See `.env.production.example` for the full list.

3. Deploy as usual (`docker compose up -d --build`). The migration
   (`f49dcd0d8f64`) applies on boot and creates the audit, session, consent,
   breach-register and retention tables.

4. Seal the contact details already in the database:

```bash
docker compose exec backend python -m scripts.encrypt_phi --dry-run   # count first
docker compose exec backend python -m scripts.encrypt_phi
```

   Safe to interrupt and safe to re-run. The app can read every row at every moment
   during it — reads tolerate plaintext, and each value is sealed by a single atomic
   UPDATE.

5. Enrol every administrator with an authenticator app — **Data Protection → Access
   control → Set up an authenticator app** — and have them save their recovery codes.
   THEN set `MFA_REQUIRED_FOR_ADMINS=true` and restart. Doing this in the other order
   locks every administrator out of the console.

6. About 24 hours later (one full token lifetime), set
   `SESSION_ALLOW_LEGACY_TOKENS=false` and restart. Until then, tokens issued before
   the deploy keep working so field workers are not signed out mid-visit.

7. Update the host nginx from `deploy/nginx.host.conf.example` — it now carries TLS
   hardening, HSTS, and the `X-Forwarded-For` line that makes audit rows record the
   real client address instead of the proxy. Then `nginx -t && systemctl reload nginx`.

8. Open **Data Protection → Overview** and confirm every control reads green, then
   review the retention schedule and the processing register against the MOU annexure.

### Two things that must be on volumes

- `audit_spool` — the on-disk fallback that keeps audit events from being lost while
  the database is briefly unavailable. Already wired in `docker-compose.yml`. Without
  it, a container restart discards exactly the evidence a restart-shaped incident needs.
- The database volume itself should sit on an encrypted filesystem. Application-level
  encryption covers contact details; mothers' and children's **names** are stored in
  plaintext because the admin search and the growth monitor sort on them
  (`SECURITY.md` §5). Full-disk encryption is what covers that gap.

### If a breach is suspected

Open the incident **on suspicion, not on certainty** — the CERT-In clock is six hours
from awareness. Data Protection → Breaches → Report a breach. Containment (end every
session) and the notification drafts are in the incident view. For a hard stop, set
`PHI_ACCESS_FROZEN=true` and restart: every patient-data endpoint refuses while
sign-in, administration and the security console keep working.

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
