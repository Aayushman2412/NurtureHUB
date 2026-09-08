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

## Data protection (`backend/app/security/`) — IMPORTANT

The platform holds identified maternal and child health records, and the Maharashtra
MOU makes NurtureHUB answerable for what happens to them. Full rationale and the
legal mapping live in **`SECURITY.md`** — read it before changing anything below.

### Rules when touching patient data

- **Every route that reads or writes a mother/child record must record it.** Use the
  helpers in `app/security/phi.py` (`log_read`, `log_list`, `log_create`, `log_update`,
  `log_delete`, `log_export`, `log_denied`) rather than calling `audit.record` directly —
  they keep the trail queryable by *data principal*, which is the query both a breach
  investigation and a DPDP access request start from.
- **`subject_type`/`subject_id` is the person the data is about**, which is not always
  the resource. A growth measurement's resource is a form response; its subject is the
  child. Getting this wrong makes the register unable to answer the questions the law
  gives people the right to ask.
- **Exports and deletions use the synchronous path** (`log_export`, `log_delete` with
  `db=`) and commit with the action. At the moment of export the data leaves this
  system's custody, and under the MOU custody is what responsibility follows.
- **Never log an identifier's value.** Audit details record the *names* of the sensitive
  fields returned, never their contents. Details are deep-redacted on write anyway
  (`app/security/redaction.py`), but do not rely on that as a licence.
- **Routers returning patient data carry `Depends(require_phi_access)`** so the
  `PHI_ACCESS_FROZEN` emergency switch reaches them.
- **Ownership refusals answer 404, not 403** (so they don't confirm a record exists) —
  but they must call `phi.log_denied` with the true reason, or the
  denied-access-burst detection rule has nothing to see.

### Encrypted columns

`mothers.mobile/alternate_mobile/email` and `users.phone/alternate_phone` are
`EncryptedString` (AES-256-GCM, transparent at the ORM boundary). Consequences:

- **They cannot appear in a SQL predicate** — no `filter`, `ilike`, `order_by`.
  Ciphertext is non-deterministic. Use the blind index (`mothers.mobile_lookup`,
  `phone_index(value, domain)`) for exact-match lookup.
- Adding another encrypted column means calling `sync_lookups()` on write if it has
  an index, and extending `scripts/encrypt_phi.py` so existing rows get sealed.
- Names are deliberately NOT encrypted (search/sort depend on them). Don't "fix" this
  without reading the reasoning in `SECURITY.md` §5.

### The audit chain

`audit_events` rows are signed with a keyed MAC and chained. Two traps:

- **Never change `_HASHED_FIELDS` or `canonical_payload` in place** — that invalidates
  every existing row. Bump `_HASH_VERSION` and keep the old rule for old rows.
- **Chain positions are assigned at commit, not at `record_sync()`.** A rolled-back
  transaction must not consume one: a sequence gap is indistinguishable from someone
  deleting rows, and a trail that cries wolf is worse than none. Anything writing
  audit rows outside a request must go through `_persist`/`_flush`, never raw SQL.

Verify after any change here: `venv/bin/python -m pytest tests/test_security_layer.py`.

### Adding a consent purpose or a retention rule

`app/security/consent.py:PURPOSES` and `app/security/retention.py:DEFAULT_POLICIES`
are the sources of truth; the privacy notice is generated from the former, so the two
cannot drift. Bump `NOTICE_VERSION` whenever the notice text changes — consent is only
meaningful against the notice the person actually saw.

## Notes

- Don't hardcode option lists in the UI — serve them from the backend (metadata endpoints).
- The learner profile is one `User` row; `role` (legacy designation string) gates
  "profile complete" — keep it populated when writing the FK `designation_id`.
