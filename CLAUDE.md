# NurtureHUB

Training, assessment, and field data-collection platform for ICDS / health workers.
A learner (health worker) signs up, completes a profile, works through staged
tutorials + tests (with live monitoring), and registers the mothers/children they
serve.

## Stack & layout

- **Backend** — `backend/`: FastAPI + SQLAlchemy 2.0 + **Postgres**, Alembic migrations,
  WebSockets for live test monitoring. Python venv at `backend/venv/`.
- **Frontend** — `frontend/`: React 19 + Vite + TypeScript + Tailwind v4, Zod validation.

## Running locally

Postgres must be running with a database matching `DATABASE_URL` (see `backend/.env`;
falls back to `config.py:DEV_DATABASE_URL`).

```bash
# Backend (port 8000) — applies migrations + seeds on startup
cd backend && venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend (port 5173)
cd frontend && npm install && npm run dev
```

Type-check / lint the frontend: `cd frontend && npx tsc -b` and `npm run lint`.

> **Use `tsc -b`, never `tsc --noEmit`.** The root `tsconfig.json` is a solution-style
> config (`"files": []` plus `references`), so `tsc --noEmit` type-checks **zero files**
> and always exits 0 — it will happily pass on code that fails the real build. `tsc -b`
> is what `npm run build` runs. Before anything that produces a build artifact (a Docker
> image, a deploy), run the real thing: `npm run build`.

## Database migrations — Alembic (IMPORTANT)

Alembic is the **single source of truth** for the schema. On startup `main.py` runs
`alembic upgrade head` (`run_migrations()`), then seeds. There is **no** `create_all()`
or auto-`ALTER` at boot — editing a model does **not** change the DB by itself; you must
generate a migration.

Migrations live in `backend/alembic/versions/`. `alembic/env.py` sources the DB URL from
`app.config.settings` (override with `ALEMBIC_DATABASE_URL`) and imports both `app.models`
and `app.models_live`, so all tables are tracked.

### Adding a schema change

1. Edit the model in `backend/app/models.py` (or `models_live.py`).
2. Autogenerate a revision against a **clean Postgres DB at head** — never SQLite, never
   your drifted dev DB (both produce wrong migrations):

   ```bash
   cd backend
   createdb nh_tmp
   ALEMBIC_DATABASE_URL=postgresql://<user>@localhost/nh_tmp venv/bin/alembic upgrade head
   ALEMBIC_DATABASE_URL=postgresql://<user>@localhost/nh_tmp venv/bin/alembic revision --autogenerate -m "describe change"
   ALEMBIC_DATABASE_URL=postgresql://<user>@localhost/nh_tmp venv/bin/alembic check   # expect: "No new upgrade operations detected"
   dropdb nh_tmp
   ```
3. **Review the generated file.** Gotchas:
   - A `NOT NULL` column added to an existing (populated) table needs `server_default=...`
     to backfill, then `op.alter_column(..., server_default=None)` to match the ORM.
   - Autogenerate leaves FK constraint names as `None` (breaks `downgrade()`) — name them
     `<table>_<col>_fkey`.
4. Commit the migration file alongside the model change. It applies on next app boot.

## Seeding (`backend/app/seed.py`)

Two layers, all idempotent via count guards:
1. **Essential reference data** (geography, qualifications, achievements, and the
   Learner-Registration professional-axis: departments/designations/facility-types +
   dept-scoped education) — always seeded.
2. **Demo data** (program districts, demo users, 4-phase tutorial/test content) — only
   when `SEED_DEMO_DATA=true`. Set `SEED_DEMO_DATA=false` in production.

## Frontend conventions

- **Reuse shared components** — prefer `frontend/src/components/ui/*` over inline markup;
  unify before editing.
- **Validation = Zod** (client) + Pydantic (server, authoritative). Per-feature schema
  (e.g. `lib/learnerSchema.ts`) + generic helpers in `lib/validation.ts` (`toFieldErrors`
  maps a safeParse result → `{field: message}`). Show inline errors via the `error` prop
  on `Field` / `Input` / `Select` / `SelectField`.
- **Cascading dropdowns** — filtered `/api/metadata/*` endpoints + a fetch-on-change hook
  (see `hooks/useLearnerMetadata.ts`). The cascade change handler sets the value and resets
  its dependents; the hook only fetches.

## Notes

- Don't hardcode option lists in the UI — serve them from the backend (metadata endpoints).
- The learner profile is one `User` row; `role` (legacy designation string) gates
  "profile complete" — keep it populated when writing the FK `designation_id`.
