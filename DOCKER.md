# Running NurtureHUB with Docker Compose

A self-contained stack: **Postgres + FastAPI backend + nginx-served frontend**.
The frontend's nginx reverse-proxies `/api` and `/ws` to the backend, so the whole
app is served from one origin (no CORS to configure).

## Prerequisites
- Docker Desktop (or Docker Engine) with the Compose plugin.

## Quick start
```bash
cp .env.example .env          # optional — sensible dev defaults work as-is
docker compose up --build
```
Then open **http://localhost:8080**.

First boot takes ~30–45s while the backend applies Alembic migrations and seeds
demo data; the frontend will show until the API is ready.

- **App (SPA):** http://localhost:8080
- **API + docs:** http://localhost:8000 / http://localhost:8000/docs

## What runs
| Service    | Image / build      | Purpose |
|------------|--------------------|---------|
| `db`       | `postgres:16-alpine` | Database; data persists in the `db_data` volume |
| `backend`  | `./backend` (Python 3.12) | Runs `alembic upgrade head` + seed on boot, then `uvicorn` |
| `frontend` | `./frontend` (Node build → nginx) | Serves the built SPA and proxies `/api` + `/ws` |

## Configuration
Everything is driven by the root `.env` (see `.env.example`). Key values:

- `SEED_DEMO_DATA` — `true` seeds demo districts/users/tutorials/tests; set `false` for a clean DB.
- `GOOGLE_CLIENT_ID` — optional; blank falls back to a mock Google login.
- `FRONTEND_PORT` / `BACKEND_PORT` — host ports (default `8080` / `8000`).

### Production hardening
Set `APP_ENV=production` and the backend **refuses to boot** unless you also provide:
- a strong `JWT_SECRET_KEY` (`openssl rand -hex 32`),
- a non-default `DATABASE_URL` (change `POSTGRES_PASSWORD`),
- real `SMTP_USER` / `SMTP_PASSWORD` (so OTP emails send).

Also set `SEED_DEMO_DATA=false` in production.

## Common commands
```bash
docker compose up --build -d     # start in the background
docker compose logs -f backend   # tail backend logs
docker compose down              # stop (keeps the DB volume)
docker compose down -v           # stop and WIPE the database
docker compose build --no-cache frontend   # force a clean rebuild
```

## Notes
- The frontend is built with `VITE_API_URL=""` so the browser uses the same origin
  (nginx proxy). To point the SPA at a separate API host instead, set `VITE_API_URL`
  (and optionally `VITE_WS_URL`) in `.env` and rebuild the frontend.
- The DB port is not published by default; add a `ports:` entry under `db` if you
  want to connect from the host.
