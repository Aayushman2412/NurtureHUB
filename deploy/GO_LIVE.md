# Go-live runbook — data protection layer

For whoever is deploying this to the live server. Follow it top to bottom.

`DEPLOY.md` is the reference manual; this is the ordered checklist. Where they
disagree, `DEPLOY.md` is authoritative on *how* the stack works and this file is
authoritative on *what order to do things in*.

Budget **about 90 minutes**, plus a 24-hour wait before the final step. Do it in
a window when field workers are not mid-visit.

---

## ⚠️ Read this first — the failure mode that looks like success

The usual update is:

```bash
git pull && docker compose up -d --build
```

**If you do only that, the deploy will succeed and protect nothing.**

Every new guard is gated on `APP_ENV=production`. The live server currently runs
in relaxed mode (`APP_ENV=development`), so the app will start happily, apply the
new migration, show a new Data Protection console — and:

- mothers' and learners' phone numbers and emails stay in **plaintext**
- the audit trail is signed with a key **derived from `JWT_SECRET_KEY`**, so
  anyone who can forge a session can also forge the log that would have recorded it
- none of the required-config checks run

Nothing errors. Nothing looks wrong. That is exactly what makes it dangerous.

**So either complete this runbook, or postpone the deploy.** A half-done rollout
is worse than the old version, because the console will report protections that
are not actually there.

---

## Part 1 — Things to obtain BEFORE you touch the server

These come from people, not from a terminal. Two of them are hard blockers: with
a placeholder value the app **refuses to start**.

| # | What | From whom | Blocker? |
|---|------|-----------|----------|
| 1 | **DPO name, email, phone** — a real person who answers privacy requests | The business / head of company | **YES — will not boot** |
| 2 | **The live domain**, confirmed exactly | Ops | **YES — will not boot** |
| 3 | **Office / NAT egress IP addresses** of ICDS block offices and any site doing bulk sign-ins | Ops / the programme | No, but skipping causes throttling |
| 4 | **List of every administrator account** who will need an authenticator app | You / the team | No, but step 8 fails without it |
| 5 | **A confirmed, restorable database backup** | You | **YES — do not proceed without it** |
| 6 | **A secure place to store 3 new keys** (password manager or sealed ops vault) | You | **YES — see the warning below** |
| 7 | **Who can reload the host nginx** — it is ops-managed, not in the compose stack | Ops | No, but step 10 needs them |
| 8 | The MOU annexure's **breach reporting window**, if it names one | The business | No — affects config only |

### On item 1

`DPO_EMAIL` must not be left as `privacy@nurturehub.org`. The app checks for that
exact placeholder and refuses to boot. The DPDP Act requires a published, reachable
contact for data-principal requests, so a shared alias nobody monitors is not
sufficient — a person has to actually answer it.

### On item 5 — back up before you start

Step 7 rewrites every contact-detail row in place. It is safe and re-runnable, but
take the backup anyway and **verify it restores**:

```bash
docker compose exec db pg_dump -U <user> <dbname> > ~/nurturehub-pre-dp-$(date +%F).sql
ls -lh ~/nurturehub-pre-dp-*.sql        # confirm it is not 0 bytes
```

### ⚠️ On item 6 — losing these keys destroys data permanently

There is no recovery, no reset, no support path.

- Lose **`PHI_ENCRYPTION_KEYS`** → every mother's and learner's phone number and
  email is permanently unreadable. The rows survive; the contents do not.
- Lose **`PHI_INDEX_KEY`** → phone-number lookup breaks until every row is re-indexed.
- Lose **`AUDIT_HMAC_KEY`** → the entire access history becomes unverifiable, which
  is the one thing the MOU relies on it for.

Store all three somewhere durable **the moment you generate them, before you deploy**.
Not only in `.env` on the server — that file dies with the disk.

Equally: never commit them, never paste them into chat or a ticket, and never reuse
`JWT_SECRET_KEY` for `AUDIT_HMAC_KEY` (the app rejects that anyway).

---

## Part 2 — Generate the three keys on the server

Do this **on the server**, not on a laptop, and paste the output straight into
`.env` and your vault.

```bash
# 1. PHI_ENCRYPTION_KEYS  — seals contact details at rest
docker compose exec backend python -c \
  "from app.security.crypto import generate_key; print('v1:'+generate_key())"

# 2. PHI_INDEX_KEY  — separate key for the searchable blind index
openssl rand -base64 32

# 3. AUDIT_HMAC_KEY — signs the audit chain. MUST differ from JWT_SECRET_KEY
openssl rand -hex 32
```

Keep the `v1:` prefix on the first one — it is the key-ring version, and rotation
later depends on old versions staying listed.

---

## Part 3 — The deploy

Each step has a **stop gate**. If a gate fails, do not continue to the next step;
jump to *Rollback*.

### Step 1 — Pull the code

```bash
cd /path/to/NurtureHUB
git pull
```

### Step 2 — Fill in `.env`

Open `.env` on the server (this is the live file — `docker compose` reads `.env`,
not `.env.production`). Use `.env.production.example` as the field-by-field
reference; it documents every value.

**Required — the app will not start without these:**

```ini
APP_ENV=production                    # ← this is what turns every guard on

PHI_ENCRYPTION_KEYS=v1:<from Part 2>
PHI_ENCRYPTION_ACTIVE_KEY=v1
PHI_INDEX_KEY=<from Part 2>
AUDIT_HMAC_KEY=<from Part 2>          # must differ from JWT_SECRET_KEY

DPO_NAME=<real person>
DPO_EMAIL=<real, monitored address>
DPO_PHONE=+91-<number>
ORG_LEGAL_NAME=Spoken Tutorial Project, IIT Bombay

ALLOWED_HOSTS=<your.domain>
PUBLIC_BASE_URL=https://<your.domain>
CORS_ORIGINS=https://<your.domain>    # must NOT contain *
JWT_SECRET_KEY=<32+ chars, not the dev default>
```

**Must be off in production** (each is individually checked at boot):

```ini
SEED_DEMO_DATA=false
ALLOW_DEV_ADMIN=false
RAW_EXPORT_MOCK=false
ENABLE_API_DOCS=false
SERVE_LOCAL_UPLOADS=false
```

**Leave these exactly as shown for now** — steps 8 and 9 change them later, and
changing them early locks people out:

```ini
MFA_REQUIRED_FOR_ADMINS=false
SESSION_ALLOW_LEGACY_TOKENS=true
TRUST_PROXY_HEADERS=true
HSTS_ENABLED=true
```

Also make sure `ADMIN_BOOTSTRAP_PASSWORD` is **empty or absent**. It exists only to
create the very first administrator on an empty database; production refuses to
boot while it is set. (If this is a fresh database with no admin, see *Fresh
database* at the end.)

> `CORS_ORIGINS=*` and the simple dev `JWT_SECRET_KEY` are the two relaxed-mode
> leftovers most likely to still be in the live `.env`. Both are now hard failures.
> Note that changing `JWT_SECRET_KEY` signs everyone out — expected, do it here.

### Step 3 — Bring the stack up

```bash
docker compose up -d --build
docker compose logs -f backend
```

**🚦 Stop gate.** Watch the log. You want to see migrations apply and the app
finish starting.

If configuration is wrong you will get a single explicit error listing every
problem at once:

```
Refusing to start in production with insecure configuration:
  - AUDIT_HMAC_KEY must be different from JWT_SECRET_KEY.
  - DPO_EMAIL is still the placeholder. ...
```

That message is the feature working. Fix every line it lists, then
`docker compose up -d` again. **Do not** work around it by setting
`APP_ENV=development` — that silently disables the protections and returns you to
the failure described at the top of this file.

### Step 4 — Confirm the migration applied

```bash
docker compose exec backend alembic current      # expect: f49dcd0d8f64 (head)
```

**🚦 Stop gate.** If this is not at head, stop. The audit, session, consent,
breach-register and retention tables do not exist yet, and step 7 will fail.

### Step 5 — Smoke-test before touching data

```bash
curl -I http://127.0.0.1:8080                        # SPA → 200 (use your FRONTEND_PORT)
curl -s http://127.0.0.1:8080/api/metadata/states    # API through the frontend proxy
```

Then sign in through the real domain in a browser and open
**Admin → Data Protection → Overview**.

**🚦 Stop gate.** Encryption and audit-key rows should now read green. MFA and
legacy-session rows will still read amber — that is correct at this stage; steps 8
and 9 fix them.

### Step 6 — Check the audit chain is being written

Data Protection → **Access log**, then run the chain verification.

**🚦 Stop gate.** It must report the chain intact. Verifying it now, before the
back-fill, means that if a problem appears later you know the back-fill caused it.

### Step 7 — Seal the contact details already in the database

Everything so far only protects *new* writes. Existing rows are still plaintext.

```bash
docker compose exec backend python -m scripts.encrypt_phi --dry-run    # counts only
docker compose exec backend python -m scripts.encrypt_phi
```

Run `--dry-run` first and sanity-check the count against roughly how many mothers
and learners you expect.

This is safe to interrupt and safe to re-run. The app stays fully usable while it
runs — reads tolerate plaintext, and each value is sealed by one atomic UPDATE.

**🚦 Stop gate.** Re-run `--dry-run` afterwards; it should report nothing left to
do. Then open a mother's record in the UI and confirm her phone number still
displays correctly, and that searching by phone number still finds her.

### Step 8 — Administrator MFA (order matters)

**First** have every administrator enrol: Data Protection → Access control → *Set
up an authenticator app*. Each person scans the QR code and **saves their recovery
codes somewhere offline**.

**Only once every one of them has enrolled and confirmed:**

```ini
MFA_REQUIRED_FOR_ADMINS=true
```

```bash
docker compose up -d
```

> ⚠️ Setting this before everyone has enrolled locks **every administrator** out of
> the console, including you. Recovering means editing `.env` and restarting — so if
> it happens, don't panic, but do avoid it.

### Step 9 — After 24 hours, close the legacy-token window

Wait one full token lifetime (~24h) so tokens issued before the deploy have
expired. Then:

```ini
SESSION_ALLOW_LEGACY_TOKENS=false
```

```bash
docker compose up -d
```

Doing this immediately would sign out every field worker mid-visit. Waiting means
each one simply signs in again next time.

### Step 10 — Host nginx (needs ops)

The host nginx is **not** part of the compose stack. Hand
`deploy/nginx.host.conf.example` to whoever administers it.

Two things in it genuinely matter:

1. **Add the real office/NAT addresses** (item 3 in Part 1) to the
   `geo $nh_limit_key` block. The committed file has placeholders. Sites left out
   still work, but get the default ceilings.
2. **`proxy_set_header X-Forwarded-For $remote_addr;`** — not
   `$proxy_add_x_forwarded_for`. The appending form lets a client send its own
   header and have every action in the audit log attributed to an address it made
   up. Do not "fix" this to the more familiar form.

Also confirm `proxy_pass` points at your actual `FRONTEND_PORT`.

```bash
nginx -t && systemctl reload nginx
```

> ⚠️ **The shipped config has never been validated with `nginx -t`** — there was no
> nginx available where it was written. Treat step 10 as the step most likely to
> fail, and run `nginx -t` before reloading, never after.

**🚦 Stop gate.** After the reload, verify WebSockets still work — the live test
monitor depends on the upgrade headers surviving the proxy:

```bash
curl -s -o /dev/null -w '%{http_code}\n' --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==' \
  'https://<your.domain>/ws/admin/monitor/1?token=bogus'
```

**403 = working** (the app rejected the bogus token, so the headers arrived).
**404 = broken** (headers were stripped; the live monitor will silently show
nothing).

---

## Part 4 — Final verification

- [ ] Data Protection → **Overview** — every control green
- [ ] Data Protection → **Access log** — new entries appearing, chain verifies
- [ ] A mother's phone number **displays** correctly in the UI
- [ ] **Searching** by phone number still finds her
- [ ] A field worker can sign in on a phone
- [ ] An administrator sign-in **prompts for the authenticator code**
- [ ] The **privacy notice** at `/privacy` shows the real DPO contact
- [ ] Live test monitor shows a connected candidate (the 403 probe above)
- [ ] `docker compose ps` — all three services healthy

---

## Part 5 — Rollback

Nothing here deletes data, and rollback is quick.

**Config problem (most likely).** Fix `.env`, then `docker compose up -d`. The boot
guard means a bad config cannot start — it fails loudly instead of running wrong.

**Need to revert the code:**

```bash
git log --oneline -15          # find the commit before the data-protection work
git checkout 8de970d           # the release immediately before this rollout
docker compose up -d --build
```

The new tables simply go unused. **Do not** downgrade the migration — you would drop
the audit history, which is the evidence the MOU obliges us to keep.

⚠️ **One-way door:** if you have already run step 7, contact details are encrypted.
Rolling back to code that cannot decrypt them will show them as unreadable. Restore
from the Part 1 backup, or roll forward instead. This is the one step to be sure
about before running.

**Never run `docker compose down -v`** — it wipes the database volume.

---

## Part 6 — Traps worth knowing

**Encrypted columns cannot be searched with SQL.** `mothers.mobile`,
`alternate_mobile`, `email` and `users.phone`, `alternate_phone` can never appear in
a `WHERE`, `ILIKE` or `ORDER BY` again — the ciphertext is non-deterministic. Use the
blind index (`mobile_lookup` / `phone_lookup`). Any script or query you have that
filters on a phone number **will stop matching** — it will not error, it will just
return nothing.

**Names are deliberately not encrypted.** The admin learner list and the growth
monitor search and sort on them. Full-disk encryption on the database volume is what
covers that gap — check it is on. Reasoning is in `SECURITY.md` §5.

**The audit spool needs its volume.** Already wired in `docker-compose.yml` as
`audit_spool`. It is where audit events go when the database is briefly unavailable.
Without it, a container restart discards exactly the evidence a restart-shaped
incident would need.

**Do not tighten the sign-in rate limits.** They look loose on purpose. A whole block
office reaches the internet through one NAT address, so a per-address limit tuned for
one person throttles a district while barely inconveniencing an attacker. Brute force
is handled per *account* by the lockout table. The old `10/minute` setting was
measured refusing **50 of 60 legitimate sign-ins** from one address.

**Known limitation, so it does not alarm you:** under a burst heavy enough to exhaust
the connection pool, the audit chain can report roughly one gap per 300 events. It is
a false positive, not lost evidence — the event still reaches the disk spool. Zero
gaps under normal load. Documented in `SECURITY.md` §5.

---

## If a test day is coming

Measured capacity, one worker: **~26 sign-ins/second**; 300 sign-ins arriving over a
few seconds all succeed in ~12s. The limit is bcrypt CPU, not the database.

For a cohort much larger than 300, in order of preference:

1. **More workers** (`--workers N`, N ≈ cores). Also set
   `RATE_LIMIT_STORAGE_URI=redis://…` so ceilings are shared rather than per-process.
2. **`BCRYPT_ROUNDS=10`** — ~4× cheaper; existing hashes upgrade in place on next
   sign-in, no password resets. Weakens offline-cracking resistance, so prefer cores.
3. **Stagger the start.** Even 30 seconds of spread makes the problem disappear.

---

## If a breach is suspected

Open the incident **on suspicion, not on certainty** — the CERT-In clock is six hours
from *awareness*, not from confirmation.

Data Protection → **Breaches** → *Report a breach*. Containment (end every session)
and the notification drafts are in the incident view.

For a hard stop, set `PHI_ACCESS_FROZEN=true` and restart: every patient-data endpoint
refuses, while sign-in, administration and the security console keep working.

---

## Fresh database only

If this is a brand-new database with no administrator yet, there is a chicken-and-egg:
`ADMIN_BOOTSTRAP_PASSWORD` creates the first admin, but production refuses to boot
while it is set. So:

1. Start once with `APP_ENV=development` and `ADMIN_BOOTSTRAP_EMAIL` /
   `ADMIN_BOOTSTRAP_PASSWORD` set (12+ characters).
2. Confirm the admin exists and you can sign in.
3. **Remove `ADMIN_BOOTSTRAP_PASSWORD`**, set `APP_ENV=production`, restart.

On an existing database that already has administrators, skip this entirely.

---

## Still outstanding from the business

Not code — nobody can deploy these:

- **A named DPO** with real contact details (blocks step 2).
- **The MOU annexure's breach reporting window**, if it specifies one shorter than
  CERT-In's six hours.
