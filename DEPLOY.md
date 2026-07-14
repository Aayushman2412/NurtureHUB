# Production deployment

The compose stack is self-contained; a **host-level nginx** (managed by ops)
terminates TLS in front of it.

## Topology

```
                      TLS (443)          127.0.0.1:8080        docker network
  Internet  ───►  Host nginx (ops)  ───►  frontend (nginx)  ───►  backend  ───►  db
                  domain + certs          SPA + /api,/ws proxy      FastAPI      Postgres
```

- **Host nginx** (ops): HTTPS, the domain, forwards everything to `127.0.0.1:8080`. Sample: [`deploy/nginx.host.conf.example`](deploy/nginx.host.conf.example).
- **frontend container**: serves the built SPA and reverse-proxies `/api` + `/ws` to the backend — so ops never touches the backend directly.
- **backend / db**: internal to the compose network; ports bind to `127.0.0.1` only.

## Your part — bring the stack up

On the server (in the repo root):

```bash
cp .env.production.example .env
# then edit .env and fill every CHANGE_ME:
#   JWT_SECRET_KEY   →  openssl rand -hex 32
#   POSTGRES_PASSWORD → openssl rand -hex 24
#   SMTP_USER / SMTP_PASSWORD → real mailbox + app password
#   CORS_ORIGINS     →  https://<your-domain>

docker compose up -d --build
docker compose ps          # all three healthy?
docker compose logs -f backend   # watch migrations + seed on first boot
```

`.env` already sets `APP_ENV=production`, `SEED_DEMO_DATA=false`, and
`BIND_ADDR=127.0.0.1`. If any secret is still a dev default, the backend refuses
to boot and prints exactly what's wrong.

Sanity-check locally on the host (before wiring the domain):
```bash
curl -I http://127.0.0.1:8080          # SPA (200)
curl -s http://127.0.0.1:8080/api/... # proxied API through the frontend nginx
```

## Ops' part — host nginx + TLS

Hand [`deploy/nginx.host.conf.example`](deploy/nginx.host.conf.example) to the
server admin. They:
1. Set the real `server_name` and TLS cert paths (e.g. certbot).
2. Ensure the `map $http_upgrade $connection_upgrade { … }` block is present at the `http{}` scope (needed for WebSockets).
3. `nginx -t && systemctl reload nginx`.

That's all they need — one upstream (`127.0.0.1:8080`) with WebSocket upgrade.

## Updating a running deployment

```bash
git pull
docker compose up -d --build     # rebuilds changed images, re-applies migrations on boot
```
Migrations run automatically at backend startup. `docker compose down` keeps the
DB; `down -v` wipes it.

## Notes / follow-ups
- **Backups**: schedule `pg_dump` against the `db` service (or back up the `db_data` volume). Not included here.
- **Real client IPs**: rate limiting sees the proxy IP by default. If you need per-client limits, configure the backend to trust `X-Forwarded-For` (currently forwarded by both nginx layers).
- **Secrets**: keep the filled `.env` off git (it's already gitignored) and readable only by the deploy user.
