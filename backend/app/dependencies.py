import time

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.auth import decode_access_token
from app.models import User
from app.security import audit, sessions
from app.security import context as security_context

# Standard OAuth2 scheme for JWT token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

_SESSION_ENDED_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Your session has ended. Please sign in again.",
    headers={"WWW-Authenticate": "Bearer"},
)

_FROZEN_EXCEPTION = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail=(
        "Access to patient records is temporarily suspended while a security incident "
        "is investigated. Contact your programme administrator."
    ),
)

# ── verified-user cache ──────────────────────────────────────────────────
# Every authenticated request otherwise re-runs SELECT users WHERE email=…, one
# DB round-trip per request. This per-process cache holds a scalar snapshot of
# verified users for a short TTL; on a hit we hand back a *detached* User built
# from the snapshot (read-only paths only touch scalar columns), skipping the
# query. Writes to a user row must call invalidate_user_cache() so the change is
# visible immediately rather than after the TTL.
_user_cache: dict[str, tuple[float, dict]] = {}
_USER_COLUMNS = [c.name for c in User.__table__.columns]


def invalidate_user_cache(email: str | None) -> None:
    if email:
        _user_cache.pop(email, None)


def _snapshot(user: User) -> dict:
    return {name: getattr(user, name) for name in _USER_COLUMNS}


def _detached_from_snapshot(snap: dict) -> User:
    u = User()
    for name, value in snap.items():
        setattr(u, name, value)
    return u


# ── token → principal ────────────────────────────────────────────────────
# Every path below funnels through _resolve_token, which does three things the
# old code did not: it checks the token's session row so a revoked token stops
# working immediately, it publishes the caller's identity to the audit context
# so every downstream audit row is attributable, and it records the rejection
# when a token is refused — the refusals are what an investigation reads.


def _reject(reason: str, principal: str | None = None):
    audit.record(
        audit.Action.TOKEN_REJECTED,
        resource_type="token",
        outcome="denied",
        is_phi=False,
        record_count=0,
        detail={"reason": reason, "principal": principal},
    )


def _resolve_token(token: str, db: Session, request: Request | None, *, require_admin: bool = False) -> dict:
    """Validate a bearer token and publish its identity. Returns the JWT payload."""
    if not token:
        raise _CREDENTIALS_EXCEPTION

    payload = decode_access_token(token)
    if payload is None:
        _reject("invalid_or_expired_signature")
        raise _CREDENTIALS_EXCEPTION

    email = payload.get("sub")
    if not email:
        _reject("no_subject_claim")
        raise _CREDENTIALS_EXCEPTION

    is_admin_claim = bool(payload.get("is_admin"))
    if require_admin and not is_admin_claim:
        _reject("not_an_admin_token", email)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )

    jti = payload.get("jti")
    if jti:
        session = sessions.lookup(db, jti)
        if session is None:
            _reject("session_revoked_or_expired", email)
            raise _SESSION_ENDED_EXCEPTION
        # An administrator whose privilege was removed keeps a token that still
        # claims is_admin. The session row is the current truth.
        if require_admin and not session["is_admin"]:
            _reject("session_not_admin", email)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Administrator privileges required",
            )
        security_context.set_actor(
            "admin" if is_admin_claim else "learner",
            actor_label=email,
            actor_id=session.get("user_id"),
            session_jti=jti,
        )
        if request is not None:
            sessions.touch(db, jti, request)
    else:
        # Pre-rollout token. Accepted only while the allowance is on, and
        # recorded every time so the tail of legacy usage is visible.
        if not settings.SESSION_ALLOW_LEGACY_TOKENS:
            _reject("legacy_token_without_session", email)
            raise _SESSION_ENDED_EXCEPTION
        security_context.set_actor(
            "admin" if is_admin_claim else "learner", actor_label=email
        )
        audit.record(
            "auth.token.legacy",
            resource_type="token",
            outcome="success",
            is_phi=False,
            record_count=0,
            detail={"principal": email, "note": "token predates the session layer"},
        )
    return payload


def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = _resolve_token(token, db, request)
    email = payload.get("sub")

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        _reject("user_row_missing", email)
        raise _CREDENTIALS_EXCEPTION

    security_context.update_context(actor_id=user.id)

    # Note: this dependency allows unverified users through so they can complete
    # the onboarding flow (fetch /users/me, verify OTP, build profile).
    # Content routes should depend on get_verified_user instead.
    return user


def get_verified_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Require an authenticated AND OTP-verified account. Use on content routes.

    Backed by a short-TTL per-process cache so the common case skips the DB
    lookup entirely. Only OTP-verified users are ever cached, and the cached
    object is detached — safe because every consumer of this dependency reads
    scalar user fields only (they write to other tables, never the User row).
    """
    payload = _resolve_token(token, db, request)
    email = payload.get("sub")

    ttl = settings.USER_CACHE_TTL_SECONDS
    if ttl > 0:
        entry = _user_cache.get(email)
        if entry is not None and entry[0] > time.monotonic():
            snap = entry[1]
            security_context.update_context(actor_id=snap.get("id"))
            return _detached_from_snapshot(snap)

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        _reject("user_row_missing", email)
        raise _CREDENTIALS_EXCEPTION
    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not verified. Please verify your email to continue.",
        )
    security_context.update_context(actor_id=user.id)
    if ttl > 0:
        _user_cache[email] = (time.monotonic() + ttl, _snapshot(user))
    return user


def get_current_admin(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """
    Require a valid admin token (JWT carrying an is_admin claim, issued by
    /api/admin/login). Guards every /api/admin/* route except login itself.

    Unlike before, this now consults the database: the token names a session
    row, and a revoked session — or an account whose administrator rights were
    withdrawn — is refused at once rather than remaining valid until the token
    happens to expire.
    """
    payload = _resolve_token(token, db, request, require_admin=True)
    return {
        "email": payload.get("sub"),
        "is_admin": True,
        "jti": payload.get("jti"),
    }


def get_admin_email(admin: dict = Depends(get_current_admin)) -> str:
    """Convenience dependency returning just the admin's email (for audit fields)."""
    return admin.get("email") or ""


def require_phi_access() -> None:
    """Emergency containment gate for every endpoint that returns patient data.

    During an active incident the correct first move is often to stop the
    bleeding before the cause is known. Setting PHI_ACCESS_FROZEN=true and
    restarting turns off patient-data access across the whole platform while
    sign-in, administration and the security console keep working, so the
    investigation can proceed. Nothing is deleted and nothing is lost — the
    freeze is lifted by unsetting the flag.
    """
    if settings.PHI_ACCESS_FROZEN:
        audit.record(
            audit.Action.PHI_DENIED,
            resource_type="endpoint",
            outcome="denied",
            record_count=0,
            is_phi=False,
            detail={"reason": "phi_access_frozen"},
        )
        raise _FROZEN_EXCEPTION
