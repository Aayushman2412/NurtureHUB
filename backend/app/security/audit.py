"""The audit trail: append-only, hash-chained, and hard to quietly edit.

Why this shape
--------------
Under the MOU, responsibility for a breach follows custody and control, and on
shared systems it is apportioned by fault. Both determinations are evidential:
they need a record of who touched which patient record, from where, and when —
and that record is only worth anything if it can be shown not to have been
edited after the fact. An ordinary log table fails the second test, because
anyone who can reach the database to steal the data can also reach it to tidy
up the log.

So every row carries `entry_hash = HMAC-SHA256(key, prev_hash || payload)`. The
key lives in the application environment, not the database. Altering or
removing a row breaks every hash after it in that chain, and forging a
consistent replacement requires the key. `AuditAnchor` rows, written on a timer,
close the remaining gap — a chain's *tail* can be truncated without breaking
anything, so anchors periodically notarise where each chain stood.

Chains are per writer process (`chain_key`), not global. A single global chain
would serialise every audit append behind one lock, and this trail is written on
the read path of every patient record. Per-writer chains keep appends
contention-free and are verified independently.

Durability
----------
Writes go through a bounded queue to a background thread, so a PHI read costs a
queue put rather than a database round-trip. Two rules keep that from becoming a
hole in the evidence:

* Security-critical events (authentication, admin action, breach handling,
  export) use `record_sync()` and are committed before the response is sent.
* Nothing is ever dropped. If the queue is saturated or the database write
  fails, events spill to an append-only JSONL spool on disk and are re-ingested
  on the next healthy flush. If the spool cannot be written either, the event
  goes to stderr — degraded, but never silent.
"""
from __future__ import annotations

import atexit
import hashlib
import hmac
import json
import logging
import os
import queue
import socket
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from app.config import settings
from app.security import context as ctx
from app.security.redaction import redact

logger = logging.getLogger("nurturehub.audit")

# ── Actions ──────────────────────────────────────────────────────────────────
# A closed vocabulary keeps the trail queryable. Add here rather than passing
# ad-hoc strings, so the security dashboard's filters stay meaningful.
class Action:
    # authentication
    LOGIN_SUCCESS = "auth.login.success"
    LOGIN_FAILURE = "auth.login.failure"
    LOGOUT = "auth.logout"
    OTP_SENT = "auth.otp.sent"
    OTP_VERIFIED = "auth.otp.verified"
    OTP_FAILED = "auth.otp.failed"
    PASSWORD_CHANGED = "auth.password.changed"
    PASSWORD_RESET = "auth.password.reset"
    ACCOUNT_LOCKED = "auth.account.locked"
    ACCOUNT_UNLOCKED = "auth.account.unlocked"
    SESSION_REVOKED = "auth.session.revoked"
    MFA_ENROLLED = "auth.mfa.enrolled"
    MFA_CHALLENGE_FAILED = "auth.mfa.failed"
    MFA_DISABLED = "auth.mfa.disabled"
    TOKEN_REJECTED = "auth.token.rejected"

    # patient data
    PHI_READ = "phi.read"
    PHI_LIST = "phi.list"
    PHI_CREATE = "phi.create"
    PHI_UPDATE = "phi.update"
    PHI_DELETE = "phi.delete"
    PHI_EXPORT = "phi.export"
    PHI_DENIED = "phi.denied"

    # administration
    ADMIN_ACTION = "admin.action"
    ADMIN_CONFIG_CHANGE = "admin.config.change"
    ADMIN_USER_CHANGE = "admin.user.change"
    PIPELINE_RUN = "admin.pipeline.run"

    # governance
    CONSENT_GRANTED = "consent.granted"
    CONSENT_WITHDRAWN = "consent.withdrawn"
    DSR_CREATED = "dsr.created"
    DSR_UPDATED = "dsr.updated"
    ERASURE = "data.erasure"
    RETENTION_RUN = "data.retention.run"

    # security operations
    ALERT_RAISED = "security.alert.raised"
    ALERT_UPDATED = "security.alert.updated"
    INCIDENT_OPENED = "security.incident.opened"
    INCIDENT_UPDATED = "security.incident.updated"
    NOTIFICATION_SENT = "security.notification.sent"
    AUDIT_VERIFIED = "security.audit.verified"
    AUDIT_EXPORTED = "security.audit.exported"
    KEY_ROTATED = "security.key.rotated"


PHI_ACTIONS = {
    Action.PHI_READ, Action.PHI_LIST, Action.PHI_CREATE, Action.PHI_UPDATE,
    Action.PHI_DELETE, Action.PHI_EXPORT, Action.PHI_DENIED,
}

GENESIS = "0" * 64


# ── Chain identity ───────────────────────────────────────────────────────────
# host:pid:boot. The boot nonce disambiguates a recycled pid, so two chains can
# never accidentally share a key and interleave.
_CHAIN_KEY = f"{socket.gethostname()[:40]}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


def chain_key() -> str:
    return _CHAIN_KEY


def _audit_key() -> bytes:
    """MAC key for the chain.

    Falls back to a derivation from JWT_SECRET_KEY so a development instance
    still produces a valid chain. Production requires a distinct key — sharing
    it with the token secret means one leak forges both sessions and audit rows
    (see `config.Settings.validate_production`).
    """
    configured = (settings.AUDIT_HMAC_KEY or "").strip()
    if configured:
        return configured.encode("utf-8")
    return hashlib.sha256(
        b"nurturehub.audit.v1\x00" + settings.JWT_SECRET_KEY.encode("utf-8")
    ).digest()


# Fields that are hashed, in this order. Changing this list invalidates every
# existing chain, so it is versioned: bump the tag and old rows still verify
# under the old rule.
_HASH_VERSION = "v1"
_HASHED_FIELDS = (
    "occurred_at", "actor_type", "actor_id", "actor_label", "session_jti",
    "source_ip", "forwarded_for", "user_agent", "request_id", "action",
    "resource_type", "resource_id", "subject_type", "subject_id",
    "record_count", "is_phi", "method", "path", "outcome", "status_code",
    "detail",
)


def canonical_payload(event: dict) -> str:
    """Deterministic serialisation of the hashed fields.

    `sort_keys` plus an explicit field tuple means the digest does not depend on
    dict ordering, Python version or how the row came back from the database —
    a verifier years from now recomputes exactly what the writer computed.

    The datetime handling is the subtle part. A value is written as an aware UTC
    datetime, but comes back naive from SQLite (and from some driver
    configurations), and `.astimezone()` on a naive value assumes *local* time.
    Left alone, that produced a different string on read than on write and every
    row failed verification on a machine that was not on UTC — reporting
    tampering where there was none. Naive values are therefore treated as UTC,
    the same rule the rest of the codebase uses (see app/timeutils.py).
    """
    body = {}
    for name in _HASHED_FIELDS:
        value = event.get(name)
        if isinstance(value, datetime):
            aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
            value = aware.astimezone(timezone.utc).isoformat()
        body[name] = value
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)


def compute_hash(prev_hash: str, event: dict) -> str:
    message = f"{_HASH_VERSION}\x00{prev_hash}\x00{canonical_payload(event)}"
    return hmac.new(_audit_key(), message.encode("utf-8"), hashlib.sha256).hexdigest()


# ── Spool (never lose an event) ──────────────────────────────────────────────


def _spool_path() -> str:
    configured = (settings.AUDIT_SPOOL_PATH or "").strip()
    if configured:
        return configured
    # app/security/audit.py -> app/security -> app -> backend
    backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(backend_dir, "audit_spool.jsonl")


_spool_lock = threading.Lock()


def _json_default(value):
    """Serialise for the spool in a form `_coerce_datetime` can read back exactly.

    `str(datetime)` uses a space separator and `isoformat()` uses "T". Letting a
    datetime fall through to `default=str` therefore changed the value across a
    spool round-trip, and since the timestamp is part of the signed payload,
    every recovered event failed verification afterwards — the trail reported
    tampering on precisely the events that survived a database outage.
    """
    if isinstance(value, datetime):
        aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
        return aware.astimezone(timezone.utc).isoformat()
    return str(value)


def _coerce_datetime(value):
    """Turn a spooled timestamp back into an aware UTC datetime."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace(" ", "T", 1))
        except ValueError:
            return None
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    return None


def _spill(events: Iterable[dict], reason: str) -> None:
    """Append events to the on-disk spool. Last line of defence before stderr."""
    path = _spool_path()
    try:
        with _spool_lock:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a", encoding="utf-8") as fh:
                for event in events:
                    fh.write(
                        json.dumps({**event, "_spill_reason": reason}, default=_json_default) + "\n"
                    )
    except Exception:  # noqa: BLE001
        for event in events:
            logger.critical(
                "AUDIT EVENT UNPERSISTED (%s): %s", reason, json.dumps(event, default=_json_default)
            )


def _drain_spool(db) -> int:
    """Re-ingest spooled events after the database comes back. Returns the count."""
    path = _spool_path()
    if not os.path.exists(path):
        return 0
    with _spool_lock:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                lines = [line for line in fh if line.strip()]
        except Exception:  # noqa: BLE001
            return 0
        if not lines:
            return 0
        recovered = []
        for line in lines:
            try:
                event = json.loads(line)
                event.pop("_spill_reason", None)
                # Back to a datetime before it is re-signed, so the value that
                # gets hashed is the same shape as the one read back from the
                # database on verification.
                event["occurred_at"] = _coerce_datetime(event.get("occurred_at"))
                event["detail"] = _merge_detail(event.get("detail"), {"recovered_from_spool": True})
                recovered.append(event)
            except Exception:  # noqa: BLE001
                continue
        if recovered:
            _persist(db, recovered)
        os.remove(path)
        return len(recovered)


def _merge_detail(detail, extra: dict) -> Optional[str]:
    try:
        current = json.loads(detail) if isinstance(detail, str) and detail else (detail or {})
        if not isinstance(current, dict):
            current = {"value": current}
    except Exception:  # noqa: BLE001
        current = {}
    current.update(extra)
    return json.dumps(current, default=str)


# ── Persistence ──────────────────────────────────────────────────────────────

_chain_lock = threading.Lock()
_chain_state = {"prev_hash": None, "sequence": 0}


def _load_chain_state(db) -> None:
    """Resume this process's chain if it already wrote rows (it normally has not)."""
    from app.models_security import AuditEvent

    row = (
        db.query(AuditEvent)
        .filter(AuditEvent.chain_key == _CHAIN_KEY)
        .order_by(AuditEvent.sequence.desc())
        .first()
    )
    if row:
        _chain_state["prev_hash"] = row.entry_hash
        _chain_state["sequence"] = row.sequence
    else:
        _chain_state["prev_hash"] = GENESIS
        _chain_state["sequence"] = 0


def _persist(db, events: list) -> None:
    """Chain and insert a batch. Caller owns the session and the commit."""
    from app.models_security import AuditEvent

    with _chain_lock:
        if _chain_state["prev_hash"] is None:
            _load_chain_state(db)
        rows = []
        for event in events:
            # The timestamp is part of the signed payload, so it must be a real
            # value here rather than left to the column's server default — the
            # signature would otherwise cover None while the row stored a time.
            if not isinstance(event.get("occurred_at"), datetime):
                event["occurred_at"] = (
                    _coerce_datetime(event.get("occurred_at")) or datetime.now(timezone.utc)
                )
            seq = _chain_state["sequence"] + 1
            prev = _chain_state["prev_hash"]
            entry_hash = compute_hash(prev, event)
            rows.append(
                AuditEvent(
                    occurred_at=event.get("occurred_at"),
                    actor_type=event.get("actor_type") or "anonymous",
                    actor_id=event.get("actor_id"),
                    actor_label=event.get("actor_label"),
                    session_jti=event.get("session_jti"),
                    source_ip=event.get("source_ip"),
                    forwarded_for=event.get("forwarded_for"),
                    user_agent=event.get("user_agent"),
                    request_id=event.get("request_id"),
                    action=event.get("action"),
                    resource_type=event.get("resource_type"),
                    resource_id=event.get("resource_id"),
                    subject_type=event.get("subject_type"),
                    subject_id=event.get("subject_id"),
                    record_count=event.get("record_count") or 0,
                    is_phi=bool(event.get("is_phi")),
                    method=event.get("method"),
                    path=event.get("path"),
                    outcome=event.get("outcome") or "success",
                    status_code=event.get("status_code"),
                    duration_ms=event.get("duration_ms"),
                    detail=event.get("detail"),
                    chain_key=_CHAIN_KEY,
                    sequence=seq,
                    prev_hash=prev,
                    entry_hash=entry_hash,
                )
            )
            _chain_state["sequence"] = seq
            _chain_state["prev_hash"] = entry_hash
        db.add_all(rows)


# ── Background writer ────────────────────────────────────────────────────────

_queue: "queue.Queue" = queue.Queue(maxsize=10000)
_writer_thread: Optional[threading.Thread] = None
_stop = threading.Event()
_stats = {"written": 0, "spilled": 0, "recovered": 0, "failed_flushes": 0}


def stats() -> dict:
    return {**_stats, "queued": _queue.qsize(), "chain_key": _CHAIN_KEY}


def _flush(batch: list) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        _persist(db, batch)
        db.commit()
        _stats["written"] += len(batch)
        # The database is healthy again — pick up anything that spilled while it
        # was not. Kept out of the hot path by only trying after a good flush.
        try:
            recovered = _drain_spool(db)
            if recovered:
                db.commit()
                _stats["recovered"] += recovered
        except Exception:  # noqa: BLE001
            db.rollback()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _stats["failed_flushes"] += 1
        _stats["spilled"] += len(batch)
        # A failed batch may have advanced the in-memory chain state; reset so
        # the next flush re-reads the true head from the database rather than
        # writing rows whose prev_hash points at something never committed.
        with _chain_lock:
            _chain_state["prev_hash"] = None
        logger.error("audit flush failed (%s) - %d event(s) spooled", exc, len(batch))
        _spill(batch, f"db_error:{type(exc).__name__}")
    finally:
        db.close()


def _writer_loop() -> None:
    batch: list = []
    while not _stop.is_set() or not _queue.empty() or batch:
        timeout = 0.5
        try:
            event = _queue.get(timeout=timeout)
            batch.append(event)
            # Opportunistically absorb whatever else is waiting, so a burst
            # costs one transaction instead of one per event.
            while len(batch) < 200:
                try:
                    batch.append(_queue.get_nowait())
                except queue.Empty:
                    break
        except queue.Empty:
            pass
        if batch:
            _flush(batch)
            batch = []


def start_writer() -> None:
    global _writer_thread
    if _writer_thread and _writer_thread.is_alive():
        return
    _stop.clear()
    # Registered here as well as on first use, so the session hooks exist before
    # any request can reach a db-bound record_sync.
    _register_session_hooks()
    _writer_thread = threading.Thread(target=_writer_loop, name="audit-writer", daemon=True)
    _writer_thread.start()


def stop_writer(timeout: float = 5.0) -> None:
    """Flush and stop. Called on shutdown so in-flight events are not lost."""
    _stop.set()
    thread = _writer_thread
    if thread and thread.is_alive():
        thread.join(timeout=timeout)
    # Anything still queued after the join goes to the spool rather than nowhere.
    leftovers = []
    while True:
        try:
            leftovers.append(_queue.get_nowait())
        except queue.Empty:
            break
    if leftovers:
        _spill(leftovers, "shutdown")


atexit.register(stop_writer)


# ── Public API ───────────────────────────────────────────────────────────────


def _build(
    action: str,
    *,
    resource_type=None,
    resource_id=None,
    subject_type=None,
    subject_id=None,
    record_count: int = 1,
    outcome: str = "success",
    status_code=None,
    duration_ms=None,
    is_phi=None,
    detail=None,
    actor_override: dict = None,
) -> dict:
    current = ctx.get_context()
    actor = actor_override or {}
    payload = {
        "occurred_at": datetime.now(timezone.utc),
        "actor_type": actor.get("actor_type", current.actor_type),
        "actor_id": actor.get("actor_id", current.actor_id),
        "actor_label": actor.get("actor_label", current.actor_label),
        "session_jti": actor.get("session_jti", current.session_jti),
        "source_ip": current.source_ip,
        "forwarded_for": current.forwarded_for,
        "user_agent": (current.user_agent or None) and current.user_agent[:512],
        "request_id": current.request_id,
        "action": action,
        "resource_type": resource_type,
        "resource_id": str(resource_id)[:64] if resource_id is not None else None,
        "subject_type": subject_type,
        "subject_id": str(subject_id)[:64] if subject_id is not None else None,
        "record_count": int(record_count or 0),
        "is_phi": bool(action in PHI_ACTIONS if is_phi is None else is_phi),
        "method": current.method,
        "path": (current.path or None) and current.path[:512],
        "outcome": outcome,
        "status_code": status_code,
        "duration_ms": duration_ms,
    }
    merged_detail = dict(detail) if isinstance(detail, dict) else ({"note": detail} if detail else {})
    if current.access_reason:
        merged_detail.setdefault("access_reason", current.access_reason)
    payload["detail"] = json.dumps(redact(merged_detail), default=str) if merged_detail else None
    return payload


def record(action: str, **kwargs) -> None:
    """Queue an audit event. Non-blocking on the happy path; never silent.

    Use for high-volume, non-security-critical events — the PHI read path. If
    the queue is full the event spills to disk rather than blocking the request
    or being discarded.
    """
    event = _build(action, **kwargs)
    try:
        _queue.put_nowait(event)
    except queue.Full:
        _stats["spilled"] += 1
        _spill([event], "queue_full")


_PENDING_KEY = "nh_audit_pending"
# Set once a chain position has been handed to a row that is not yet committed,
# and cleared by the after_commit hook. Anything still marked when the session
# is released means the commit never completed, so the position was consumed
# for a row that never landed.
_UNCONFIRMED_KEY = "nh_audit_position_unconfirmed"


def record_sync(action: str, db=None, **kwargs) -> None:
    """Write an audit event durably before returning.

    For events whose absence would itself be evidence of tampering:
    authentication, privilege changes, exports, breach handling.

    When `db` is given the event is attached to that session and written as part
    of its commit, so the action and its audit record land together. It is
    deliberately *not* chained at this moment — see `_flush_pending` for why
    that distinction matters.
    """
    event = _build(action, **kwargs)
    if db is not None:
        _register_session_hooks()
        db.info.setdefault(_PENDING_KEY, []).append(event)
        return
    _flush([event])


# ── Session-bound events ─────────────────────────────────────────────────────
# Chain positions are assigned at commit, never when record_sync() is called.
#
# The reason is a failure this got wrong first: a caller that recorded an event
# and then raised (a rejected multi-factor code, say) had already consumed a
# sequence number, but its transaction rolled back and the row was never
# written. The chain was then missing sequence 12 — and a missing sequence is
# exactly the signature of someone deleting rows to cover their tracks. The
# trail reported tampering that had not happened, which is the worst possible
# failure for a control whose entire value is that people believe it.
#
# So: assign positions inside `before_commit`, where a rollback simply never
# reserved one. And on rollback, hand the events to the background writer
# instead of dropping them — a failed sign-in must still be recorded even
# though the request that produced it failed.

_hooks_registered = False


def _register_session_hooks() -> None:
    global _hooks_registered
    if _hooks_registered:
        return
    from sqlalchemy import event as sa_event
    from sqlalchemy.orm import Session as SASession

    sa_event.listen(SASession, "before_commit", _flush_pending)
    sa_event.listen(SASession, "after_commit", _confirm_positions)
    sa_event.listen(SASession, "after_rollback", _requeue_pending)
    sa_event.listen(SASession, "after_soft_rollback", _requeue_pending_soft)
    _hooks_registered = True


def _confirm_positions(session) -> None:
    """The commit completed, so the positions handed out in it really landed."""
    session.info.pop(_UNCONFIRMED_KEY, None)


def _flush_pending(session) -> None:
    """Chain and insert this session's pending events as part of its commit."""
    events = session.info.pop(_PENDING_KEY, None)
    if not events:
        return
    try:
        _persist(session, events)
        # Not confirmed until the commit finishes — see _UNCONFIRMED_KEY.
        session.info[_UNCONFIRMED_KEY] = True
        _stats["written"] += len(events)
    except Exception as exc:  # noqa: BLE001
        with _chain_lock:
            _chain_state["prev_hash"] = None
        logger.error("inline audit write failed (%s) - spooling %d event(s)", exc, len(events))
        _spill(events, f"inline_error:{type(exc).__name__}")


def _requeue_pending(session) -> None:
    """The transaction rolled back. Record the events anyway, out of band.

    Also invalidates this process's cached chain head. Positions are assigned in
    `before_commit`, which is early enough to survive a caller rolling back on
    purpose — but not early enough if the COMMIT ITSELF fails, as it does when a
    burst exhausts the connection pool. The position was handed out, the row
    never landed, and the chain was left with a hole that verification correctly
    but misleadingly reports as deleted rows. Dropping the cached head makes the
    next write re-read the true maximum from the database and carry on from
    there, so a failed commit costs nothing.
    """
    with _chain_lock:
        _chain_state["prev_hash"] = None

    events = session.info.pop(_PENDING_KEY, None)
    if not events:
        return
    for event in events:
        event["detail"] = _merge_detail(event.get("detail"), {"transaction_rolled_back": True})
        try:
            _queue.put_nowait(event)
        except queue.Full:
            _stats["spilled"] += 1
            _spill([event], "queue_full_after_rollback")


def _requeue_pending_soft(session, previous_transaction) -> None:  # noqa: ANN001
    _requeue_pending(session)


def release_session(session) -> None:
    """Last chance before a session is closed: rescue anything still pending,
    and notice a commit that never completed.

    `Session.close()` does not reliably emit `after_rollback`, so this is the
    only hook guaranteed to run for every request. Two jobs:

    * Rescue audit events the request never got to commit — a request that
      raised is exactly the one whose evidence matters most.
    * Detect a chain position handed out to a row that never landed. That
      happens when the COMMIT ITSELF fails, which a burst large enough to
      exhaust the connection pool reliably causes. Left alone it leaves a hole
      that verification reports as deleted rows — a control crying wolf about
      its own infrastructure. Dropping the cached head makes the next write
      re-read the true maximum from the database and continue from there.

    Called from `database.get_db`.
    """
    if session.info.pop(_UNCONFIRMED_KEY, None):
        with _chain_lock:
            _chain_state["prev_hash"] = None
    if session.info.get(_PENDING_KEY):
        _requeue_pending(session)


def note_decryption_failure(context_label: str) -> None:
    """Called by the crypto layer when a sealed column will not open."""
    record(
        "security.decrypt.failure",
        resource_type="column",
        resource_id=context_label,
        outcome="error",
        is_phi=False,
        detail={"column": context_label},
    )


# ── Verification ─────────────────────────────────────────────────────────────


def verify_chain(db, chain: str, start_sequence: int = 1, limit: int = 100000) -> dict:
    """Recompute a chain's MACs and report the first divergence.

    Returns a dict rather than raising: a broken chain is a finding to be
    reported and investigated, not an exception to be swallowed by a handler.
    """
    from app.models_security import AuditEvent

    rows = (
        db.query(AuditEvent)
        .filter(AuditEvent.chain_key == chain, AuditEvent.sequence >= start_sequence)
        .order_by(AuditEvent.sequence.asc())
        .limit(limit)
        .all()
    )
    if not rows:
        return {"chain_key": chain, "checked": 0, "valid": True, "issues": []}

    issues = []
    # A chain whose first surviving row is not sequence 1 has lost its head.
    # That is a materially different finding from a broken link in the middle —
    # "the oldest N events are gone" points at retention or a truncation, where
    # a mid-chain break points at an edit — so it is reported as its own issue
    # and the remaining rows are then checked against each other rather than
    # every one of them being flagged as following nothing.
    head_missing = start_sequence <= 1 and rows[0].sequence > 1
    if head_missing:
        issues.append({
            "type": "chain_head_missing",
            "at_id": rows[0].id,
            "sequence": rows[0].sequence,
            "missing_before": rows[0].sequence - 1,
            "meaning": (
                f"this chain's first {rows[0].sequence - 1} event(s) are absent; "
                "the surviving rows are verified against each other below"
            ),
        })
    expected_prev = rows[0].prev_hash if (start_sequence > 1 or head_missing) else GENESIS
    expected_seq = rows[0].sequence
    for row in rows:
        if row.sequence != expected_seq:
            issues.append({
                "type": "sequence_gap",
                "at_id": row.id,
                "expected_sequence": expected_seq,
                "found_sequence": row.sequence,
                "meaning": "rows were deleted from the middle of this chain",
            })
            expected_seq = row.sequence
        if row.prev_hash != expected_prev:
            issues.append({
                "type": "broken_link",
                "at_id": row.id,
                "sequence": row.sequence,
                "meaning": "this row does not follow the one before it",
            })
        recomputed = compute_hash(row.prev_hash, {
            "occurred_at": row.occurred_at,
            "actor_type": row.actor_type,
            "actor_id": row.actor_id,
            "actor_label": row.actor_label,
            "session_jti": row.session_jti,
            "source_ip": row.source_ip,
            "forwarded_for": row.forwarded_for,
            "user_agent": row.user_agent,
            "request_id": row.request_id,
            "action": row.action,
            "resource_type": row.resource_type,
            "resource_id": row.resource_id,
            "subject_type": row.subject_type,
            "subject_id": row.subject_id,
            "record_count": row.record_count,
            "is_phi": row.is_phi,
            "method": row.method,
            "path": row.path,
            "outcome": row.outcome,
            "status_code": row.status_code,
            "detail": row.detail,
        })
        if not hmac.compare_digest(recomputed, row.entry_hash):
            issues.append({
                "type": "content_modified",
                "at_id": row.id,
                "sequence": row.sequence,
                "occurred_at": row.occurred_at.isoformat() if row.occurred_at else None,
                "meaning": "this row's contents were changed after it was written",
            })
        expected_prev = row.entry_hash
        expected_seq = row.sequence + 1

    return {
        "chain_key": chain,
        "checked": len(rows),
        "from_sequence": rows[0].sequence,
        "to_sequence": rows[-1].sequence,
        "valid": not issues,
        "issues": issues[:50],
        "issue_count": len(issues),
    }


def verify_all(db, limit_per_chain: int = 100000) -> dict:
    """Verify every chain plus the anchor chain. This is the compliance answer."""
    from sqlalchemy import func as sql_func

    from app.models_security import AuditEvent

    chains = [row[0] for row in db.query(AuditEvent.chain_key).distinct().all()]
    results = [verify_chain(db, chain, limit=limit_per_chain) for chain in chains]
    total = db.query(sql_func.count(AuditEvent.id)).scalar() or 0
    anchors = verify_anchors(db)
    return {
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "total_events": total,
        "chains": results,
        "chain_count": len(chains),
        "anchors": anchors,
        "valid": all(r["valid"] for r in results) and anchors["valid"],
    }


# ── Anchors ──────────────────────────────────────────────────────────────────


def _anchor_hash(prev: str, body: dict) -> str:
    message = f"anchor.{_HASH_VERSION}\x00{prev}\x00" + json.dumps(
        body, sort_keys=True, separators=(",", ":"), default=str
    )
    return hmac.new(_audit_key(), message.encode("utf-8"), hashlib.sha256).hexdigest()


def write_anchors(db) -> int:
    """Notarise the head of every chain. Returns how many anchors were written.

    Without this, an attacker who deletes the newest N rows of a chain leaves
    something that still verifies — the chain simply looks shorter. An anchor
    written before the deletion says how long it was.
    """
    from sqlalchemy import func as sql_func

    from app.models_security import AuditAnchor, AuditEvent

    heads = (
        db.query(
            AuditEvent.chain_key,
            sql_func.max(AuditEvent.sequence).label("seq"),
            sql_func.count(AuditEvent.id).label("cnt"),
        )
        .group_by(AuditEvent.chain_key)
        .all()
    )
    if not heads:
        return 0

    last_anchor = db.query(AuditAnchor).order_by(AuditAnchor.id.desc()).first()
    prev_hash = last_anchor.anchor_hash if last_anchor else GENESIS
    written = 0
    for chain, seq, cnt in heads:
        existing = (
            db.query(AuditAnchor)
            .filter(AuditAnchor.chain_key == chain)
            .order_by(AuditAnchor.id.desc())
            .first()
        )
        if existing and existing.last_sequence == seq:
            continue  # nothing new to notarise for this chain
        head = (
            db.query(AuditEvent)
            .filter(AuditEvent.chain_key == chain, AuditEvent.sequence == seq)
            .first()
        )
        if not head:
            continue
        body = {
            "chain_key": chain,
            "last_event_id": head.id,
            "last_sequence": seq,
            "last_entry_hash": head.entry_hash,
            "event_count": cnt,
        }
        anchor_hash = _anchor_hash(prev_hash, body)
        db.add(
            AuditAnchor(
                chain_key=chain,
                last_event_id=head.id,
                last_sequence=seq,
                last_entry_hash=head.entry_hash,
                event_count=cnt,
                prev_anchor_hash=prev_hash,
                anchor_hash=anchor_hash,
            )
        )
        prev_hash = anchor_hash
        written += 1
    if written:
        db.commit()
    return written


def verify_anchors(db) -> dict:
    """Check the anchor chain, and check each anchor against the events that survive."""
    from app.models_security import AuditAnchor, AuditEvent

    anchors = db.query(AuditAnchor).order_by(AuditAnchor.id.asc()).all()
    if not anchors:
        return {"checked": 0, "valid": True, "issues": []}

    issues = []
    prev = GENESIS
    for anchor in anchors:
        body = {
            "chain_key": anchor.chain_key,
            "last_event_id": anchor.last_event_id,
            "last_sequence": anchor.last_sequence,
            "last_entry_hash": anchor.last_entry_hash,
            "event_count": anchor.event_count,
        }
        if anchor.prev_anchor_hash != prev:
            issues.append({"type": "anchor_link_broken", "anchor_id": anchor.id})
        if not hmac.compare_digest(_anchor_hash(anchor.prev_anchor_hash, body), anchor.anchor_hash):
            issues.append({"type": "anchor_modified", "anchor_id": anchor.id})
        prev = anchor.anchor_hash

    # The truncation test: the newest anchor for each chain says how far that
    # chain had got. If the chain is now shorter, rows were removed from its tail.
    newest: dict = {}
    for anchor in anchors:
        newest[anchor.chain_key] = anchor
    for chain, anchor in newest.items():
        row = (
            db.query(AuditEvent)
            .filter(AuditEvent.chain_key == chain, AuditEvent.sequence == anchor.last_sequence)
            .first()
        )
        if row is None:
            issues.append({
                "type": "chain_truncated",
                "chain_key": chain,
                "anchored_sequence": anchor.last_sequence,
                "meaning": "events notarised by an anchor are no longer present",
            })
        elif row.entry_hash != anchor.last_entry_hash:
            issues.append({
                "type": "anchored_event_modified",
                "chain_key": chain,
                "anchored_sequence": anchor.last_sequence,
            })

    return {"checked": len(anchors), "valid": not issues, "issues": issues[:50]}
