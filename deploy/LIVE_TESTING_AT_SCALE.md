# Live testing at scale — 6,000 candidates at once

The runbook for running a formative/screening test with thousands of candidates
signing in and writing at the same time, with admins watching all of them live.

**First exam: 1 October.** Work backwards from it:

| By | Step |
|---|---|
| Sep 24 | Deploy this version with the live-testing setup (§1) and check it (§2) |
| Sep 25–28 | Full rehearsal on the server with 6,000 simulated candidates (§3) |
| Sep 29–30 | Fix anything the rehearsal found. **No changes after Sep 30.** |
| Oct 1 | Exam (§4) |

## What changes, in one paragraph

The backend runs as **12 processes** instead of 1, so sign-ins, test starts,
live events and submissions spread across the server's 64 cores. **Redis** (one
small new container) lets those processes share live monitoring — without it an
admin would see only the candidates on their own process. Postgres is allowed
**400 connections** instead of 100. The admin live monitor gets updates in
**one batch per second** and draws **one page of cards** at a time, so it stays
responsive with thousands of candidates. The test page **retries a failed
submission** instead of giving up, and the server **scores anyone whose device
never managed to submit**, from the answers it already received live.

Measured on a 16-core laptop: 2,000 simulated candidates across 8 processes —
0 failures, the admin page never froze, and one admin saw every candidate. The
server has 4× the cores and runs 12 processes.

---

## 1. Deploy (once, outside test hours — ~15 minutes)

On the server, as root (`ssh` to beta → `ssh` to narmada → `sudo -i`):

```bash
cd /websites_dir/NurtureHUB
```

**Back up the database first.** Nothing here should touch data, but this is the
step that makes a mistake cost minutes instead of a test:

```bash
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /root/nurturehub_before_scale_$(date +%F).dump && ls -lh /root/nurturehub_before_scale_*.dump
```

Get the new version:

```bash
git pull
```

**Make the live-testing setup permanent.** Add one line to the server's `.env`
so every future `docker compose` command — including the usual
`docker compose up -d --build` — uses it automatically. Forgetting it would
quietly put the site back on one process with no shared monitoring:

```bash
grep -q '^COMPOSE_FILE=' .env || echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.live.yml' >> .env
```

**Build first, and check the new nginx config before anything switches over.**
The site keeps running on the old containers while this happens; if the check
fails, stop here and send me the output — nothing has changed yet:

```bash
docker compose build
```

```bash
docker compose run --rm --no-deps frontend nginx -t
```

Expect `syntax is ok` and `test is successful`. Then switch over. Postgres
restarts for a few seconds to take the new connection limit; the data is on its
volume and is kept:

```bash
docker compose up -d
```

## 2. Check it is right (~5 minutes)

All containers up, including the new `redis`:

```bash
docker compose ps
```

All 12 backend processes connected to Redis — **expect 12**:

```bash
docker compose logs backend | grep -c "live monitoring shared through Redis"
```

Postgres connection limit — **expect 400**:

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "show max_connections"'
```

No errors since start:

```bash
docker compose logs --since 10m backend | grep -iE "traceback|error" | head
```

Live connections still reach the app through nginx — from any machine, **expect 403**:

```bash
curl -s -o /dev/null -w '%{http_code}\n' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==' 'https://nurturehub.edupyramids.org/ws/admin/monitor/1?token=bogus'
```

**Check the host nginx for per-address limits.** A whole venue or mobile carrier
reaches the server through one address, so a per-address limit tuned for one
person throttles a crowd. If this prints anything, send it over before the
rehearsal:

```bash
grep -rn "limit_req\|limit_conn" /etc/nginx/ 2>/dev/null
```

## 3. Rehearsal — 6,000 simulated candidates on the real server

Run this on a quiet day, at least a day before the exam. It uses **mock
learners only** (`@nurturehub.mock`); real accounts are never touched.

**a. Create 6,000 mock learners in Jalna** (takes a minute or two; learners that
already exist keep their data):

```bash
docker compose exec backend python -m scripts.seed_mock_learners --districts jalna --count 6000
```

**b. Sign-in burst — 6,000 real password logins**, 400 at a time. Expect
`RESULT: PASS`, and note the sign-ins per second:

```bash
docker compose exec backend python -m scripts.login_burst --count 6000 --concurrency 400
```

**c. Open the live monitor** in your browser as admin: Test Manager → Jalna's
formative test → Monitor Live. Keep it open for the next step.

**d. Live test — 6,000 candidates writing at once.** Joins spread over 2 minutes,
typical finish ~8 minutes, with the full mix of behaviour (tab switching, copy
paste, drop-outs, idle, speed-clicking):

```bash
docker compose exec backend python -m scripts.simulate_live_demo --reset --count 6000 --minutes 8 --ramp 120 --api http://localhost:8000 --ws ws://localhost:8000
```

While it runs, in a second server terminal, watch the load:

```bash
docker stats --no-stream nurturehub-backend-1 nurturehub-db-1 nurturehub-redis-1
```

**What passing looks like:**
- the script ends with `failed 0` and *"Everyone has submitted"*;
- the monitor's **Total Candidates** reaches 6,000 and the page stays usable
  (change page, sort, filter while it runs);
- warn someone and force-submit someone from the monitor — both take effect;
- no errors in `docker compose logs --since 30m backend | grep -iE "traceback|error"`.

Send me the script's output, the `docker stats` numbers and anything odd you saw.

**e. Clean up afterwards** (removes the simulated attempts from the test and
sets it back to scheduled):

```bash
docker compose exec backend python -m scripts.simulate_live_demo --cleanup
```

## 4. Exam day

**Before the test**
- Run the §2 checks in the morning.
- Tell candidates to **sign in 20–30 minutes before** the start. Sign-ins are
  the heaviest part (each is deliberately slow password hashing); spreading
  them over minutes instead of seconds makes them instant for everyone.
- Admins open **Monitor Live** before starting the test.

**During the test**
- Sort by **Risk Score** (the default): page 1 is exactly who needs watching.
  Use the status filters (Idle / Disconnected / Submitted) to find people.
- **Warn** stops a candidate's cheating; **Force Submit** ends their test with
  the answers they have.
- A candidate whose connection drops keeps writing — their answers are saved on
  the device and sent when the connection returns.

**When the time is up**
- Each candidate's test submits itself when *their* timer runs out.
- If a device cannot get through, it keeps retrying for ~2½ minutes (and tells
  the candidate to keep the page open).
- If a device never gets through at all — dead phone, closed tab — the server
  scores that candidate **5 minutes after their deadline** from the answers it
  received live. Nobody ends up as "not attempted" because of their device.
- **Wait until the monitor shows (almost) nobody still writing, then press
  End test.** End test stops new starts; it does not cut off people mid-test.

## 5. If something goes wrong

| Symptom | Likely cause | What to do |
|---|---|---|
| Admin sees only some candidates | Redis down, or started without the overlay | `docker compose ps redis`; check `COMPOSE_FILE` is in `.env`; `docker compose up -d` |
| Candidates get "server busy" on sign-in | Everyone signing in in the same minute | Nothing breaks — they retry; next time open sign-in earlier |
| Many 429 "too many requests" | A per-address limit (host nginx, §2) | Add the venue's address to the nginx exemption list, or raise the limit |
| Backend errors in logs | — | `docker compose logs --tail=300 backend` and send it over |

**Rolling back** to the old single-process setup (keeps all data; loses the
multi-process capacity):

```bash
sed -i '/^COMPOSE_FILE=/d' .env && docker compose up -d --build
```
