# NurtureHUB load & stress test — findings, fixes, and 50k readiness

**Date:** 2026-07-17 · **Branch:** `perf/loadtest-hardening` · **Scope:** backend
(FastAPI + SQLAlchemy + Postgres) under the full learner journey at high concurrency.

## TL;DR

The stock app **congestion-collapsed at ~150 concurrent test VUs** (11% of requests
returned HTTP 500 from database-connection-pool timeouts) and the live-proctoring
**WebSocket failed 100% of connects** under a simultaneous-exam ("thundering herd") load.
Both were caused by a small set of concrete defects, all now fixed and verified:

- After the fixes, a **single worker** eliminates the catastrophic failure mode (max
  latency 30,395 ms → 1,063 ms at 50 VUs, 0 failures) and the **herd WebSocket works**
  (connect failures 100% → 0, throughput 9× higher).
- A **3-worker deployment handles the exact load that collapsed the original**:
  1.1% failures / 123 req/s / 220 ms median — **25× the baseline throughput**.
- Data integrity holds under concurrency and across processes: **0 duplicate answers**
  across 61 simultaneous submits; the seed no longer double-inserts under multi-worker boot.

A single laptop cannot physically open 50,000 connections against itself, so the runs
below push the local stack to its real ceiling, fix what breaks, and the fixes are exactly
the ones that make the app **scale horizontally** to 50k on real infrastructure (sizing
at the end).

## Method

- **Locust framework** (`loadtest/`) driving the real request sequence reverse-engineered
  from the frontend: login → `/users/me` → dashboard → stages → per-tutorial watch
  beats/complete/quiz → tests+results → instructions → start → **candidate proctoring
  WebSocket** (exact `{type,timestamp,sequence,payload}` protocol) → bulk submit → results
  → mother + child registration, plus the 15 s notification poll every page runs.
- **Time compression** `NH_TIME_SCALE=0.02` (50×): each virtual user generates ~50× a real
  user's request rate, so N VUs ≈ 50·N real users of steady-state load.
- **Pre-minted JWTs** for capacity runs to isolate content-endpoint capacity from the login
  funnel (see "Login wall").
- Postgres connection state + process CPU sampled every 2 s (`monitor_server.py`).
- Dedicated `nurturehub_loadtest` DB, 5,000 seeded accounts.

## What was measured — before

| run | VUs | rps | fail % | median | p95 | max | Postgres conns |
|-----|----:|----:|-------:|-------:|----:|----:|----------------|
| 50 VU journey | 50 | 88 | 0.4% | 240 ms | 400 ms | **30,395 ms** | 31 (30 idle-in-txn) |
| 150 VU journey | 150 | 5 | **11.1%** | 370 ms | 30 s | 60 s | 31 (30 idle-in-txn) |
| 150 VU, WS off | 150 | 5 | 12.1% | 400 ms | 30 s | 60 s | 31 (30 idle-in-txn) |
| 80 VU herd | 80 | 7 | 16% | 760 ms | 31 s | 61 s | 31 — **WS connect 100% fail** |

Every scenario pegged at **30 database connections, ~all idle-in-transaction**, and
requests past that waited 30 s then failed with `QueuePool limit of size 10 overflow 20
reached` (109 such errors in one 75 s run).

## Root causes and fixes

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | **DB pool = 30** (`pool_size=10 + max_overflow=20`) is the hard ceiling; every scenario saturated it. | Critical | Env-tunable pool (`DB_POOL_SIZE`/`DB_MAX_OVERFLOW`, default 20+40) + `pool_pre_ping`. |
| 2 | **WebSocket handlers held one pooled connection for the whole socket lifetime** → N sockets consumed N of 30 connections; sockets idling between 30 s heartbeats still pinned a connection. | Critical | Short-lived `session_scope()` per event; idle sockets now hold **zero** connections (idle-in-txn 30 → 1). |
| 3 | **Sync SQLAlchemy ran on the single async event loop** inside WS handlers → a many-candidates-at-once connect storm blocked the loop → WS connect 100% timeout. | Critical | All WS DB work offloaded via `run_in_threadpool`; the loop stays free. |
| 4 | **`GET /api/stages` N+1** (~30–40 queries) — the post-login landing call, refetched on every tutorial-player event. | High | Batched to a fixed handful (tutorials/tests/attempts by `IN`, one grouped quiz COUNT, eligibility computed once in memory). |
| 5 | **`GET /api/tests` N+1** (~13 queries) — ~4 eligibility queries per test. | High | One district-wide eligibility computation. |
| 6 | **Per-question lazy-load N+1** in start/submit (a 100-question test = 100 extra queries per call). | Medium | `selectinload(Question.options)`. |
| 7 | **Double-submit race** — non-atomic "already submitted?" check, no unique constraint → concurrent submits duplicated answer rows + notifications. | High | Atomic `UPDATE … WHERE submitted_at IS NULL` claim + `UNIQUE(attempt_id, question_id)`. |
| 8 | **No indexes** on hot FK/filter columns (Postgres doesn't auto-index FKs) → sequential scans as tables grow to millions of rows. | High | 10 indexes (migration `c1d1b325a402`). |
| 9 | **Rate limiter keys on the direct peer** → behind a proxy all users share one bucket; login is 10/min/IP. | High | Proxy-aware key (`X-Forwarded-For` when `TRUST_PROXY_HEADERS`) + env-tunable limits. |
| 10 | **Migrate+seed runs per worker** → multiple workers race Alembic's version table and the seed's read-then-insert guards. | Medium | Wrapped in a `pg_advisory_lock` so boots serialize — **enables horizontal scaling**. |

## What was measured — after

**Single worker (pool 60):**

| run | VUs | rps | fail % | median | max | vs before |
|-----|----:|----:|-------:|-------:|----:|-----------|
| 50 VU journey | 50 | 99 | **0.0%** | 580 ms | **1,063 ms** | max was 30,395 ms; catastrophic tail gone |
| 80 VU herd | 80 | 61 | 4.0% | — | 19 s | **WS connect 100%→0% fail; 9× throughput** (645→12,712 reqs) |

**Horizontal scale — 3 workers (pool 24 each):**

| run | VUs | rps | fail % | median | p95 | integrity |
|-----|----:|----:|-------:|-------:|----:|-----------|
| 150 VU journey | 150 | **123** | **1.1%** | **220 ms** | 630 ms | 0 dup answers / attempts / notifications |

The 150-VU load that collapsed the original (11% fail, 5 rps) is handled at **1.1% fail,
123 rps, 220 ms median — 25× the throughput**. The remaining ceiling at 3 workers was the
72-connection pool maxing (not CPU), which is exactly what pgbouncer + more Postgres
headroom removes in production.

**Correctness preserved** (verified end-to-end after the refactors): eligibility gating
still exact ("2 remaining"/"5 remaining" then unlock), submit scores correctly (5/20 →
25%), double-submit rejected with 400, seed idempotent across 3 simultaneous worker boots.

## The login wall (separate finding)

`POST /api/auth/login` is bcrypt cost-12 (~250 ms CPU each) **and** rate-limited
**10/minute per client IP** — measured exactly 10 successes then `429` from one IP. Two
implications: (a) 50k users logging in over a short window is a CPU wall of its own —
rely on the 24 h JWT so users log in ~once/day, and stagger; (b) behind a proxy that
doesn't forward the real client IP, *all* users share one bucket — fix #9 addresses this,
and the limit is now env-tunable.

## Capacity model — reaching 50,000 concurrent users

**Demand (50k concurrent active learners):**
- Notification poll (every page, 15 s): 50,000 / 15 ≈ **3,300 req/s** — the dominant load.
- Tutorial watch beats (~30% watching, 1 / 10 s): ≈ **1,500 req/s**.
- Navigation/actions + test start/submit: ≈ **500–1,000 req/s**.
- **Peak ≈ 5,000–6,000 HTTP req/s**, plus up to **50,000 concurrent WebSocket sockets**
  during a synchronized exam (~1,700 heartbeat writes/s at idle + interaction bursts).

**Sizing (derived from measured ~80–100 healthy req/s per worker for this mixed workload):**
- **~50–60 app worker processes** → ~8–10 instances at 6 workers each (8 vCPU boxes).
- **pgbouncer** (transaction pooling) in front of Postgres — 60 workers × ~12 pool = ~720
  client connections must be multiplexed down to ~150–250 real Postgres connections. Do
  **not** point the workers straight at Postgres (its default `max_connections=100` is the
  wall we hit locally as "too many clients already").
- **Postgres**: tuned `max_connections` (~300) + a **read replica** for the read-heavy
  endpoints (stages/dashboard/notifications).
- **Redis**: (a) slowapi rate-limit storage (shared across workers), (b) pub/sub for
  cross-worker WebSocket admin fan-out — the in-memory `ws_manager` is per-process, so an
  admin on worker A can't currently see a candidate on worker B.
- **nginx** with `X-Forwarded-For` + `TRUST_PROXY_HEADERS=true`, WebSocket upgrade; run
  migrations/seed as a one-shot init job.

**Bandwidth correction:** the earlier plan assumed webcam-snapshot proctoring (~300 MB/s
of media). Real NurtureHUB proctoring is **WebSocket JSON text events** (a few hundred
bytes each), so proctoring bandwidth is single-digit MB/s at 50k — a much smaller concern
than assumed.

## Follow-up optimizations — now implemented

All four originally-recommended next steps landed on this branch and were verified
under a 100-VU WebSocket load run (0 failures, ~320 req/s on a single worker — up
from ~99 req/s before these changes):

1. **WebSocket heartbeats no longer cost a DB transaction each.** Heartbeats write no
   `activity_events` row at all, and `last_heartbeat` persistence is throttled to
   `WS_HEARTBEAT_PERSIST_SECONDS` (default 60 s); liveness stays in-memory for the stale
   sweeper. Verified: 0 HEARTBEAT rows in `activity_events`, `last_heartbeat` still set on
   every session.
2. **`get_verified_user` is cached** (short-TTL, per-process) so the hot read endpoints skip
   `SELECT users WHERE email=` on every request. Only verified users are cached; user-row
   writes invalidate the entry. Verified: correct data + a district change takes effect
   immediately (no stale read).
3. **`GET /api/notifications` supports ETag / 304.** The 15 s poll now returns `304 Not
   Modified` with no body when nothing changed; the frontend sends `If-None-Match` and keeps
   its cached list.
4. **Read replica + pgbouncer.** `READ_DATABASE_URL` + `get_read_db` route the
   `/api/metadata/*` reference reads off the primary; a pgbouncer transaction-pooling config
   and a `docker-compose.scale.yml` overlay (pgbouncer + multi-worker backend) are documented
   in `DEPLOY.md`.

### Still open (longer term)

- Redis pub/sub so the WebSocket admin monitor works across workers (candidate sockets
  already do); Redis-backed rate-limit storage for multi-worker.
- Move the WebSocket path to an async DB driver (asyncpg) to drop the threadpool hop.
- WebSocket push (or `ETag`/304 on more polled endpoints) to shrink the notification poll
  further.

## Artifacts in this branch

`loadtest/` — the full framework (`locustfile.py`, `ws_client.py`, `config.py`,
`seed_accounts.py`, `setup_env.py`, `monitor_server.py`, `run.py`, `summarize.py`,
`README.md`). Backend fixes across `database.py`, `config.py`, `event_processor.py`,
`routers/ws_routes.py`, `routers/tutorials.py`, `routers/tests.py`, `flow.py`, `models.py`,
`rate_limit.py`, `routers/auth.py`, `main.py`, and migration `c1d1b325a402`.
