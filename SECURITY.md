# Data protection in NurtureHUB

This document exists because of one clause in the Maharashtra MOU:

> The responsibility for handling any data breach of patient medical records and
> compliance with applicable reporting obligations shall lie with the Party in
> whose custody, control, or technical system such breach occurs. In cases where
> the breach arises from shared systems or joint processes, responsibility shall
> be determined mutually based on principles of fault, control, and applicable
> law. Each Party shall comply with applicable data protection, cybersecurity,
> and reporting obligations under prevailing laws.

Read carefully, that clause is not a promise to be careful. It is a promise to be
**answerable**: to be able to show, after the fact and to a third party, which
system an incident happened in, who did what and from where, and that the record
proving it has not been edited. A platform that cannot do that cannot honour the
clause no matter how securely it is written.

What follows is what NurtureHUB does about that, and — just as importantly —
what it does not.

---

## 1. What is at stake

NurtureHUB holds, for each family in the programme:

| Data | About whom |
|---|---|
| Name, age, mobile, alternate mobile, email, village | Mother |
| Weight, height, LMP, expected delivery date, obstetric history | Mother |
| Education, occupation, ration-card type, social category | Mother |
| Name, date of birth, birth weight and length, delivery method | Child |
| Weight/height/MUAC over time, WHO z-scores, nutritional status | Child |
| Breastfeeding and complementary-feeding assessments | Child |
| Measurement photographs | Child |

Under the DPDP Act 2023 this is personal data about identifiable data
principals, most of it health data, and a large part of it about **children**,
which s.9 singles out for stricter treatment.

---

## 2. The layers, in the order a request meets them

| # | Layer | Where |
|---|---|---|
| 1 | Transport — TLS 1.2+, HSTS, CSP, no-store on patient responses, host pinning | `deploy/nginx.host.conf.example`, `frontend/nginx.conf`, `app/security/middleware.py` |
| 2 | Identity — password policy, account lockout, TOTP second factor, revocable sessions | `app/security/{passwords,lockout,mfa,totp,sessions}.py` |
| 3 | Authorisation — ownership and role scoping, already enforced per router | `app/routers/*` |
| 4 | Confidentiality — AES-256-GCM field encryption + keyed blind indexes | `app/security/crypto.py` |
| 5 | Accountability — hash-chained, append-only audit trail | `app/security/audit.py` |
| 6 | Detection — anomaly rules over the trail | `app/security/anomaly.py` |
| 7 | Governance — consent, data-principal rights, retention, breach register | `app/security/{consent,retention,incidents,ropa}.py` |

Layers 5–7 are the ones that make the MOU clause answerable at all. Everything
above them reduces the chance of an incident; those three determine whether you
can say anything true about one after it happens.

---

## 3. How the clause is actually satisfied

### 3.1 "the Party in whose custody, control, or technical system such breach occurs"

Every access to a patient record is written to `audit_events` with: the account,
the account type, the session, the network address (and the full proxy chain),
the browser, the action, the record, **the data principal the record is about**,
how many records, the outcome, and the request id.

That last distinction matters more than it looks. The trail is keyed by *data
principal*, not just by endpoint, so the question "who has ever touched this
child's record" is one query — which is the question both a breach investigation
and a DPDP access request begin with.

Exports are recorded separately and **synchronously**, before the bytes leave.
This is the custody boundary made explicit: at the moment of export the data
leaves this system, and custody of that copy follows whoever holds the file.
The breach register says so in as many words in the counterparty notification.

### 3.2 "...shall be determined mutually based on principles of fault, control"

Opening an incident gives you a **Custody and fault evidence** view assembled
from the audit trail rather than from memory: which accounts acted in the window
around discovery, from which addresses, against how many records, and every
export that occurred. That is the material the fault-and-control test is applied
to, and it can be handed to the counterparty for joint examination.

Ticking **shared system or joint process** on the incident automatically creates
a counterparty notification obligation, so the mutual determination starts on a
clock instead of waiting for someone to remember it.

### 3.3 "...and that the record can be trusted"

An ordinary log table fails here: anyone who can reach the database to steal the
data can reach it to tidy up the log afterwards.

Each audit row carries `entry_hash = HMAC-SHA256(key, prev_hash || payload)`.
The key lives in the application environment, not the database. Altering or
deleting a row breaks every hash after it, and forging a consistent replacement
requires the key. `audit_anchors`, written on a timer, notarise where each chain
stood, which closes the one gap a hash chain leaves open — truncation of a
chain's tail.

Any administrator can run **Verify integrity** from the console and get a
yes/no plus, on failure, the exact row where the trail diverges.

This is tested, not asserted. `backend/tests/test_security_layer.py` tampers
with a committed audit row and with the chain, and asserts that verification
catches both.

### 3.4 "...comply with applicable data protection, cybersecurity, and reporting obligations"

| Obligation | Source | How it is met |
|---|---|---|
| Report a cyber incident within **6 hours** of noticing | CERT-In Directions, 28 Apr 2022, under s.70B(6) IT Act 2000 | Opening an incident creates the CERT-In obligation with a 6-hour deadline from `discovered_at` and a pre-filled draft |
| Retain logs **180 days**, in Indian jurisdiction | Same Directions | Retention default 400 days; the schedule **refuses** to be set below 180 for log-shaped data |
| Intimate the Board and each affected Data Principal of a breach | DPDP Act 2023 s.8(6) | Obligations created automatically, with plain-language drafts for data principals |
| Consent: free, specific, informed, revocable | DPDP Act 2023 s.6 | Per-purpose consent captured at registration; optional purposes are never bundled with essential ones |
| Verifiable parental consent for a child; no tracking of children | DPDP Act 2023 s.9 | Guardian consent recorded against the child with the relationship and verification method; no behavioural tracking or advertising exists in the platform |
| Access, correction, erasure, grievance | DPDP Act 2023 ss.11–14 | Request queue with due dates, an access bundle, and an erasure register that proves deletion without keeping a copy |
| Erasure when consent is withdrawn or the purpose ends | DPDP Act 2023 s.8(7) | Withdrawal surfaces the record for erasure; erasure is logged in `erasure_records` |
| Published contact for the accountable person | DPDP Act 2023 | `DPO_*` settings, shown in the public privacy notice and every notification |

> **Confirm the numbers before signature.** The 6-hour CERT-In window is settled.
> The DPDP timelines depend on the notified Rules, and the counterparty window is
> whatever the executed MOU annexure says. All of them are settings
> (`BREACH_*_HOURS`, `DSR_RESPONSE_DAYS`) — align them with the operative text,
> do not change code.

---

## 4. What each layer actually does

### Encryption at rest

`EncryptedString` is a SQLAlchemy type that seals a value with AES-256-GCM before
it reaches the database. A stolen dump, a replica, a backup tarball or a `SELECT`
by a DBA yields `enc:v1:…`, not a mother's phone number. Applied to:

- `mothers.mobile`, `mothers.alternate_mobile`, `mothers.email`
- `users.phone`, `users.alternate_phone`

**Names are deliberately not encrypted.** The admin learner list searches and
sorts on `full_name`, and the growth monitor orders by `mother_name`; encrypting
them would break both and, because ciphertext is non-deterministic, could not be
made to work without a design that leaks ordering anyway. Names are instead
protected by ownership scoping, the audit trail, and disk-level encryption on
the host. This is a real, stated limit rather than an oversight — say so if
asked, and pair it with full-disk encryption on the database volume.

Because ciphertext cannot be searched, `mothers.mobile_lookup` holds a keyed,
truncated HMAC of the number so "find the mother with this mobile" still works
without the number being stored. The index key is **separate** from the
encryption key ring, so leaking one does not compromise the other.

Keys are versioned (`v1:`, `v2:`…) so they can be rotated without a flag-day
rewrite. Keep old versions listed until `scripts/encrypt_phi.py --rewrap` has
finished, or rows written under them become unreadable.

### Sessions you can actually revoke

A bare JWT is valid until it expires; "log out" is a client-side gesture and a
stolen token keeps working for the rest of its life. That is the wrong property
for a system holding patient records, because the first containment step in
almost every real incident is *kill the attacker's session*.

Every token now names an `auth_sessions` row. Sign-out revokes it server-side; an
administrator can end one session, every session for an account, or every session
in the system (the break-glass action on an incident, which signs out the person
using it — that is intended).

Revocation propagates within `SESSION_CACHE_TTL_SECONDS` (15s default) across
workers; set it to 0 for instant revocation at the cost of a query per request.

### Password policy

The old rule was `min_length=6`, which admits `123456` on accounts holding
identified maternal and child health records. The policy now follows NIST
SP 800-63B rather than the traditional complexity-classes approach: length
carries the strength, common and breach-corpus-shaped passwords are rejected,
anything derived from the account's own name or email is rejected, and there is
**no forced expiry** — rotation is event-triggered, on suspected compromise.

Administrators need 12 characters, field learners 10. That difference is
deliberate: learners type on phone keyboards in the field, and the shorter
minimum is paired with lockout and rate limiting.

### Lockout, and why there is no IP block

Two axes, treated differently on purpose:

- **Per account** — repeated failures lock the account for a period that
  lengthens with each repeat. This is what stops guessing.
- **Per source address** — failures spread across many *distinct* accounts from
  one address is credential stuffing. This **raises an alert and never blocks**,
  because an entire ICDS block office sits behind one NAT address and an IP
  block would sign out a whole district because one person mistyped.

Lockouts are temporary and self-clearing; a permanent lock would hand an attacker
a denial-of-service against any account whose email they know.

### Detection

Rules run on a timer over the audit trail: bulk patient-record reads, large
exports, out-of-hours access, an administrator acting from a never-before-seen
address, bursts of refusals (someone walking record ids), mass deletion, and
failure of the trail's own integrity check.

Every rule is a **signal, not a verdict**. A supervisor legitimately reviewing a
block's caseload will trip the bulk-read rule, and that is correct: it is
recorded, a human confirms it was expected, and the dismissal is itself logged
with a required reason. Rules that blocked on their own would be switched off
within a week — which is how most such systems actually fail.

Alerts are deduplicated. Without that, one long export session produces a hundred
alerts and the operator learns to ignore the list.

### The audit trail's failure modes, handled

- **Performance.** Writes go through a bounded queue to a background thread, so a
  patient-record read costs a queue put, not a database round-trip.
- **Loss.** Nothing is dropped. If the queue saturates or the database write
  fails, events spill to an append-only JSONL spool on disk and are re-ingested
  on the next healthy flush. If the spool cannot be written either, the event
  goes to stderr — degraded, never silent. **The spool must be on a volume**
  (`AUDIT_SPOOL_PATH`), or a container restart discards exactly the evidence a
  restart-shaped incident needs.
- **Criticality.** Authentication, exports, deletions and breach handling use a
  synchronous path and are committed with the action itself.
- **False alarms.** Chain positions are assigned at commit, not when the event is
  recorded. An earlier version assigned them on call, so a request that recorded
  an event and then rolled back left a gap in the sequence — and a gap is exactly
  the signature of someone deleting rows. The trail reported tampering that had
  not happened, which is the worst possible failure for a control whose whole
  value is that people believe it.
- **Leakage.** Audit rows record the *names* of sensitive fields read, never the
  values, and details are deep-redacted before storage. A log that copies the
  data it protects is a second copy of the breach surface. A redacting filter is
  also installed on the application loggers, so a stray f-string containing a
  mobile number is masked before it reaches `docker logs`.

### The emergency switch

`PHI_ACCESS_FROZEN=true` plus a restart makes every patient-data endpoint refuse
requests, while sign-in, administration and the security console keep working.
During an active incident the right first move is often to stop the bleeding
before the cause is known. Nothing is deleted; unset the flag to lift it.

---

## 5. What this does NOT do

State these plainly rather than letting them be discovered.

- **Names are stored in plaintext** in the database (see above). Mitigate with
  full-disk encryption on the database volume.
- **Application-level encryption does not protect against a compromised
  application.** Code running as the app has the keys. It protects dumps,
  backups, replicas and direct database access — which is where these incidents
  usually start, but not all of them.
- **Media on Cloudflare R2 is protected by unguessable URLs, not by
  authorisation.** Anyone with a measurement photograph's URL can fetch it. This
  is a genuine gap for child growth photographs and should be closed with signed
  URLs before scale-up.
- **The local `/uploads` mount is unauthenticated.** Set
  `SERVE_LOCAL_UPLOADS=false` in production and use R2.
- **TOTP is phishable in real time.** It removes the entire class of attack that
  starts with a password from a breach corpus, which is how these accounts are
  actually taken — but a live adversary-in-the-middle defeats it. Passkeys would
  not.
- **Detection is not prevention.** The rules narrow the window between an
  incident and awareness. They do not stop anything.
- **Data residency is a deployment fact, not a code guarantee.** The database is
  wherever the server is; R2 media may be replicated outside India, which is
  recorded in the processing register (`cross_border`). Confirm this against
  whatever the MOU says about residency.
- **Backups are out of scope here.** A backup of this database is a full copy of
  the patient records; encrypt it, restrict it, and bring it inside the retention
  schedule. Nothing in this codebase does that for you.
- **A connection-pool exhaustion event can leave a gap in the audit chain.**
  Chain positions are handed out in `before_commit`; if the COMMIT ITSELF then
  fails — which a burst large enough to exhaust the pool causes — the position
  is consumed by a row that never lands, and verification reports a
  `sequence_gap` that looks like deleted rows. Measured at roughly one gap per
  300 events under a deliberately pathological burst (300 sockets at once), and
  **zero** under realistic load. It is a false positive, not lost evidence: the
  event itself is still recorded, via the disk spool. Mitigations in place: the
  cached chain head is invalidated whenever a commit does not complete, and a
  saturating burst now returns a fast 503 rather than queueing into the failure.
  The proper fix is to stop caching the head in memory and derive positions
  inside the transaction, which needs a way to serialise concurrent appends
  without holding a lock across a commit. Until then, investigate a
  `sequence_gap` by checking whether the platform was returning 503s at that
  timestamp before treating it as tampering.

- **No penetration test has been performed.** This is engineering, not
  assurance. Before signature, budget an independent assessment.

---

## 6. Operating it

### Rolling it out

1. Generate the keys **on the server** and put them in `.env`:
   ```bash
   docker compose exec backend python -c "from app.security.crypto import generate_key; print('v1:'+generate_key())"   # PHI_ENCRYPTION_KEYS
   openssl rand -base64 32    # PHI_INDEX_KEY
   openssl rand -hex 32       # AUDIT_HMAC_KEY  (MUST differ from JWT_SECRET_KEY)
   ```
2. Fill in `DPO_NAME`, `DPO_EMAIL`, `DPO_PHONE`, `ALLOWED_HOSTS`, `PUBLIC_BASE_URL`.
3. Set `ALLOW_DEV_ADMIN=false`, `ENABLE_API_DOCS=false`, `SERVE_LOCAL_UPLOADS=false`,
   `TRUST_PROXY_HEADERS=true`.
4. Deploy. The migration runs on boot; production **refuses to start** if any
   required key is missing.
5. Seal the rows that already exist:
   ```bash
   docker compose exec backend python -m scripts.encrypt_phi --dry-run
   docker compose exec backend python -m scripts.encrypt_phi
   ```
   Safe to interrupt and safe to re-run — the app can read every row at every
   moment during it.
6. Enrol every administrator with an authenticator app (**Data Protection →
   Access control**), *then* set `MFA_REQUIRED_FOR_ADMINS=true`. Turning it on
   first locks every administrator out.
7. About 24 hours later, set `SESSION_ALLOW_LEGACY_TOKENS=false`.
8. Review the retention schedule and the processing register against what the
   MOU annexure actually says.

### When something happens

1. **Data Protection → Breaches → Report a breach.** Do this on suspicion, not on
   certainty — the six-hour clock runs from awareness.
2. Contain: **End every session**, or revoke the affected account's. Consider
   `PHI_ACCESS_FROZEN=true`.
3. **Assemble from the audit trail** for the custody and fault evidence.
4. Work the notification obligations. Each has a draft; read it, send it, record
   the acknowledgement number.
5. An incident cannot be closed while a statutory obligation is unmet — the
   register would otherwise say the opposite of what happened.

### Routine

- **Weekly**: triage open alerts; every dismissal needs a reason.
- **Monthly**: run **Verify integrity**; check for overdue data-principal requests.
- **Quarterly**: dry-run the retention schedule, then apply it; review the
  processing register; confirm every administrator still needs their access.

---

## 7. Verifying the claims yourself

```bash
cd backend
venv/bin/python -m pytest tests/test_security_layer.py -v
```

The suite covers encryption round-tripping and blind-index lookup, chain
verification against real tampering (edit, delete, truncate), rollback not
corrupting the chain, password policy, TOTP including replay rejection, lockout
escalation, redaction, statutory deadline arithmetic, and consent lifecycle.

Reference: `app/security/` — every module opens with why it exists, not just
what it does.
