# NurtureHUB load & stress testing

A [Locust](https://locust.io) framework that drives the **real** NurtureHUB learner
journey — login → tutorials (watch beats, complete, quiz) → tests (start → live
proctoring WebSocket event stream → bulk submit → results) → mother + child
registration — plus the 15s notification poll every authenticated page runs.

Two scenarios:

- **`journey` (`JourneyUser`)** — the full lifecycle, request-for-request identical to
  the React frontend. At any instant the population is naturally scattered across all
  phases, which models "users at different progress, all completing eventually."
- **`herd` (`ExamHerdUser`)** — the thundering herd: a cohort completes tutorials, all
  start the same exam, stream proctoring events, then fire their submits at the **same
  instant** through a synchronization barrier.

Timing is compressed by `NH_TIME_SCALE` (default `0.02` = 50×): request **counts** per
user stay identical to real life, only the pacing shrinks, so **1 virtual user ≈ 50 real
users of steady-state request rate**. 200 VUs ≈ 10,000 real users of aggregate load.

## Layout

| file | purpose |
|------|---------|
| `locustfile.py` | the two user classes + the herd barrier |
| `ws_client.py` | candidate proctoring WebSocket client (exact NurtureHUB protocol) |
| `config.py` | all knobs, env-overridable (`NH_*`) |
| `seed_accounts.py` | bulk-create / reset load-test accounts (guarded to `loadtest_%@nhload.org`) |
| `setup_env.py` | admin API: activate tests + inflate question counts |
| `monitor_server.py` | samples backend CPU/RSS + Postgres connection state → CSV |
| `run.py` | one-command runner: reset → setup → monitor → locust → CSV |
| `summarize.py` | compact per-endpoint summary of a result dir |

## Setup (once)

```bash
cd loadtest
python -m venv venv-win
venv-win/Scripts/pip install -r requirements.txt

# create a dedicated DB and 5000 accounts (never point at prod)
createdb nurturehub_loadtest
# start the backend against it once so migrations+seed run, then:
python seed_accounts.py --count 5000
```

Accounts are `loadtest_1@nhload.org` … `loadtest_5000@nhload.org`, password `password123`,
all verified + profile-complete + attached to the Meghalaya program district.

## Run

```bash
# ramp profile — find the ceiling (pre-mint JWTs to isolate content capacity
# from the login wall; see "Login wall" below)
python run.py --scenario journey --users 200 --spawn-rate 20 --duration 120 --premint

# thundering herd — 200 users submit one 20-question exam simultaneously
python run.py --scenario herd --users 200 --spawn-rate 50 --duration 180 \
    --premint --herd-size 200 --questions 20

python summarize.py            # summarize all runs
```

Results land in `loadtest/results/<label>/` as Locust CSVs + `monitor.csv`.

### The login wall (important)

`POST /api/auth/login` is bcrypt cost-12 (~250 ms CPU) **and** rate-limited
`10/minute per client IP`. From one load-generator IP you get **exactly 10 logins then
429** (measured). For capacity testing use `--premint`, which mints 24h JWTs client-side
(modeling the real world where users hold long-lived tokens) so you measure content-endpoint
capacity, not the login funnel. To load-test login itself, spread across many source IPs
or raise `RATE_LIMIT_LOGIN` / set `RATE_LIMIT_ENABLED=false` on a throwaway env.

## Scaling to a true 50,000-user run

One machine cannot open 50k real connections against itself; you need distributed Locust
+ a horizontally-scaled backend. See [`../DEPLOY.md`](../DEPLOY.md) topology and:

1. **Backend** — run N app instances behind nginx. Each instance:
   `uvicorn app.main:app --workers W`, with `DB_POOL_SIZE`/`DB_MAX_OVERFLOW` set so
   `(total workers) × (pool_size) ≤ pgbouncer client limit`. Front Postgres with
   **pgbouncer** (transaction pooling) — do NOT point 60 workers straight at Postgres.
   Set `RATE_LIMIT_STORAGE_URI=redis://…`, `TRUST_PROXY_HEADERS=true`, and add Redis
   pub/sub for cross-worker WebSocket admin fan-out (the in-memory `ws_manager` is
   per-process). Run migrations+seed as a one-shot init job (the boot advisory lock also
   guards it).
2. **Load generators** — distributed Locust: `locust -f locustfile.py --master` +
   `--worker` on several boxes. Each worker process gets a disjoint account slice via
   `NH_WORKER_INDEX` × `NH_ACCOUNTS_PER_WORKER`. Budget ~1 generator vCPU per ~500 VUs.
3. **Point at staging you own**, seeded with enough accounts, and tell your cloud
   provider first — an unannounced 50k flood looks like a DoS and gets throttled.

## Key `NH_*` knobs

`NH_HOST`, `NH_TIME_SCALE`, `NH_PREMINT_TOKENS`, `NH_WS` (candidate socket on/off),
`NH_NOTIF_POLL`, `NH_MOTHER_FORMS`, `NH_HERD_SIZE`, `NH_HERD_TEST_ID`, `NH_VIDEO_SECONDS`,
`NH_ACCOUNT_COUNT`, `NH_ACCOUNTS_PER_WORKER`, `NH_WORKER_INDEX`. Full list in `config.py`.
