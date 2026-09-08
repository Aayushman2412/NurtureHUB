"""Server-side sessions, so a token can actually be taken away.

A JWT is a bearer credential that the server has no opinion about once signed:
it is valid until it expires, "log out" is a client-side gesture, and a stolen
token keeps working for the rest of its 24-hour life. That is exactly the wrong
property for a system holding patient records, because the first containment
step in almost every real incident is *kill the attacker's session*.

Every token now carries a `jti` naming an `AuthSession` row. Authentication
checks the row, so revocation is immediate and per-session; an administrator can
end one suspicious session or every session for a principal, and the incident
workflow can end every session in the system at once.

Cost control
------------
Checking the row would add a query to every request. A short-TTL per-process
cache absorbs that, the same pattern the user lookup already uses. The tradeoff
is explicit: with N workers, a revocation takes effect everywhere within
`SESSION_CACHE_TTL_SECONDS` (15s by default), and `revoke_*` clears the local
cache immediately. For a containment action that window is acceptable; setting
the TTL to 0 makes revocation instant at the cost of a query per request.

Legacy tokens
-------------
Tokens minted before this layer existed have no `jti`. `SESSION_ALLOW_LEGACY_TOKENS`
lets them through for one token lifetime so a deploy does not sign every field
worker out mid-visit — each one is audited, and because tokens live at most
`ACCESS_TOKEN_EXPIRE_MINUTES`, the allowance drains itself. Turn it off a day
after rollout.
"""
from __future__ import annotations

import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.security import audit
from app.security.context import device_fingerprint

# jti -> (expires_at_monotonic, snapshot)
_cache: dict = {}
_cache_lock = threading.Lock()


def _snapshot(session) -> dict:
    return {
        "id": session.id,
        "jti": session.jti,
        "principal": session.principal,
        "user_id": session.user_id,
        "is_admin": bool(session.is_admin),
        "expires_at": session.expires_at,
        "revoked_at": session.revoked_at,
        "device_hash": session.device_hash,
        "mfa_satisfied": bool(session.mfa_satisfied),
    }


def _cache_put(snap: dict) -> None:
    ttl = settings.SESSION_CACHE_TTL_SECONDS
    if ttl <= 0:
        return
    with _cache_lock:
        _cache[snap["jti"]] = (time.monotonic() + ttl, snap)


def _cache_get(jti: str):
    ttl = settings.SESSION_CACHE_TTL_SECONDS
    if ttl <= 0:
        return None
    with _cache_lock:
        entry = _cache.get(jti)
        if not entry:
            return None
        if entry[0] <= time.monotonic():
            _cache.pop(jti, None)
            return None
        return entry[1]


def invalidate(jti: Optional[str]) -> None:
    if not jti:
        return
    with _cache_lock:
        _cache.pop(jti, None)


def invalidate_all() -> None:
    with _cache_lock:
        _cache.clear()


def new_jti() -> str:
    return secrets.token_urlsafe(24)


def _actor_for(by):
    """Attribute a revocation to whoever asked for it.

    Sign-out decodes its own token rather than going through the auth
    dependency, so the request context has no actor by the time the revocation
    is recorded. Without this the containment action that matters most in an
    incident — "who cut off these sessions" — would read `anonymous`.
    """
    if not by:
        return None
    return {"actor_type": "admin" if "@" in str(by) else "system", "actor_label": str(by)}


def issue(
    db,
    *,
    principal: str,
    is_admin: bool = False,
    user_id: Optional[int] = None,
    request=None,
    mfa_satisfied: bool = False,
    expires_minutes: Optional[int] = None,
    commit: bool = True,
):
    """Create a session row and the token that names it.

    Returns ``(token, session)``. Administrator tokens get a shorter life than
    learner tokens: an admin token unlocks every record in the programme, so its
    blast radius if stolen justifies re-authenticating more often, while a field
    worker on a patchy connection should not be signed out mid-visit.
    """
    from app.auth import create_access_token
    from app.models_security import AuthSession
    from app.security.context import client_ip

    minutes = expires_minutes or (
        settings.ADMIN_TOKEN_EXPIRE_MINUTES if is_admin else settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    jti = new_jti()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=minutes)

    session = AuthSession(
        jti=jti,
        principal=principal,
        user_id=user_id,
        is_admin=is_admin,
        expires_at=expires_at,
        source_ip=client_ip(request) if request is not None else None,
        user_agent=(request.headers.get("user-agent") or "")[:512] if request is not None else None,
        device_hash=device_fingerprint(request) if request is not None else None,
        mfa_satisfied=mfa_satisfied,
        last_seen_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.flush()

    token = create_access_token(
        data={"sub": principal, "is_admin": is_admin, "jti": jti},
        expires_delta=timedelta(minutes=minutes),
    )
    if commit:
        db.commit()
    _cache_put(_snapshot(session))
    return token, session


def lookup(db, jti: str):
    """Return a validated session snapshot, or ``None`` if it must not be honoured."""
    if not jti:
        return None
    snap = _cache_get(jti)
    if snap is None:
        from app.models_security import AuthSession

        row = db.query(AuthSession).filter(AuthSession.jti == jti).first()
        if row is None:
            return None
        snap = _snapshot(row)
        _cache_put(snap)

    if snap["revoked_at"] is not None:
        return None
    expires = snap["expires_at"]
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            return None
    return snap


def touch(db, jti: str, request=None) -> None:
    """Update `last_seen_at` occasionally, and notice a session changing device.

    Throttled to once per `SESSION_TOUCH_INTERVAL_SECONDS` so an active user does
    not generate a write per request. The device check is the point of the
    exercise: a live session whose browser fingerprint changes is what a stolen
    token looks like from the server's side.
    """
    interval = settings.SESSION_TOUCH_INTERVAL_SECONDS
    if interval <= 0:
        return
    key = f"touch:{jti}"
    with _cache_lock:
        last = _cache.get(key)
        now = time.monotonic()
        if last and last[0] > now:
            return
        _cache[key] = (now + interval, None)

    from app.models_security import AuthSession

    try:
        row = db.query(AuthSession).filter(AuthSession.jti == jti).first()
        if not row:
            return
        row.last_seen_at = datetime.now(timezone.utc)
        if request is not None:
            current_device = device_fingerprint(request)
            if row.device_hash and current_device and current_device != row.device_hash:
                from app.security.anomaly import raise_alert

                raise_alert(
                    db,
                    rule="session_device_change",
                    severity="high",
                    title=f"Session for {row.principal} presented a different device",
                    description=(
                        "A live session's browser fingerprint changed mid-session. This is "
                        "consistent with a token being replayed from another machine."
                    ),
                    actor_label=row.principal,
                    evidence={"jti": row.jti, "session_id": row.id},
                    commit=False,
                )
                row.device_hash = current_device
        db.commit()
    except Exception:  # noqa: BLE001 — housekeeping must not fail a request
        db.rollback()


def revoke(db, jti: str, reason: str = "logout", by: Optional[str] = None, commit: bool = True) -> bool:
    from app.models_security import AuthSession

    row = db.query(AuthSession).filter(AuthSession.jti == jti).first()
    if row is None or row.revoked_at is not None:
        invalidate(jti)
        return False
    row.revoked_at = datetime.now(timezone.utc)
    row.revoked_reason = reason
    row.revoked_by = by
    audit.record_sync(
        audit.Action.SESSION_REVOKED,
        db=db,
        resource_type="auth_session",
        resource_id=row.id,
        is_phi=False,
        actor_override=_actor_for(by),
        detail={"principal": row.principal, "reason": reason, "revoked_by": by},
    )
    if commit:
        db.commit()
    invalidate(jti)
    return True


def revoke_all_for(db, principal: str, reason: str = "admin", by: Optional[str] = None,
                   except_jti: Optional[str] = None, commit: bool = True) -> int:
    """End every live session for one principal. The per-account containment action."""
    from app.models_security import AuthSession

    query = db.query(AuthSession).filter(
        AuthSession.principal == principal, AuthSession.revoked_at.is_(None)
    )
    if except_jti:
        query = query.filter(AuthSession.jti != except_jti)
    rows = query.all()
    now = datetime.now(timezone.utc)
    for row in rows:
        row.revoked_at = now
        row.revoked_reason = reason
        row.revoked_by = by
        invalidate(row.jti)
    if rows:
        audit.record_sync(
            audit.Action.SESSION_REVOKED,
            db=db,
            resource_type="auth_session",
            record_count=len(rows),
            is_phi=False,
            actor_override=_actor_for(by),
            detail={"principal": principal, "reason": reason, "revoked_by": by, "count": len(rows)},
        )
    if commit:
        db.commit()
    return len(rows)


def revoke_everything(db, reason: str = "breach", by: Optional[str] = None) -> int:
    """End every live session in the system. The break-glass containment action."""
    from app.models_security import AuthSession

    rows = db.query(AuthSession).filter(AuthSession.revoked_at.is_(None)).all()
    now = datetime.now(timezone.utc)
    for row in rows:
        row.revoked_at = now
        row.revoked_reason = reason
        row.revoked_by = by
    audit.record_sync(
        audit.Action.SESSION_REVOKED,
        db=db,
        record_count=len(rows),
        is_phi=False,
        actor_override=_actor_for(by),
        detail={"scope": "all_sessions", "reason": reason, "revoked_by": by, "count": len(rows)},
    )
    db.commit()
    invalidate_all()
    return len(rows)


def active_sessions(db, principal: Optional[str] = None, limit: int = 200):
    from app.models_security import AuthSession

    query = db.query(AuthSession).filter(
        AuthSession.revoked_at.is_(None),
        AuthSession.expires_at > datetime.now(timezone.utc),
    )
    if principal:
        query = query.filter(AuthSession.principal == principal)
    return query.order_by(AuthSession.last_seen_at.desc().nullslast()).limit(limit).all()


def purge_expired(db, older_than_days: int = 30) -> int:
    """Drop long-dead session rows. The audit trail keeps the history."""
    from app.models_security import AuthSession

    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    deleted = (
        db.query(AuthSession)
        .filter(AuthSession.expires_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted
