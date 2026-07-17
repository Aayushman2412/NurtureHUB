import time

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.auth import decode_access_token
from app.models import User

# Standard OAuth2 scheme for JWT token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
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


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    if not token:
        raise _CREDENTIALS_EXCEPTION

    payload = decode_access_token(token)
    if payload is None:
        raise _CREDENTIALS_EXCEPTION

    email: str = payload.get("sub")
    if email is None:
        raise _CREDENTIALS_EXCEPTION

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise _CREDENTIALS_EXCEPTION

    # Note: this dependency allows unverified users through so they can complete
    # the onboarding flow (fetch /users/me, verify OTP, build profile).
    # Content routes should depend on get_verified_user instead.
    return user


def get_verified_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    """Require an authenticated AND OTP-verified account. Use on content routes.

    Backed by a short-TTL per-process cache so the common case skips the DB
    lookup entirely. Only OTP-verified users are ever cached, and the cached
    object is detached — safe because every consumer of this dependency reads
    scalar user fields only (they write to other tables, never the User row).
    """
    if not token:
        raise _CREDENTIALS_EXCEPTION
    payload = decode_access_token(token)
    if payload is None:
        raise _CREDENTIALS_EXCEPTION
    email: str = payload.get("sub")
    if email is None:
        raise _CREDENTIALS_EXCEPTION

    ttl = settings.USER_CACHE_TTL_SECONDS
    if ttl > 0:
        entry = _user_cache.get(email)
        if entry is not None and entry[0] > time.monotonic():
            return _detached_from_snapshot(entry[1])

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise _CREDENTIALS_EXCEPTION
    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not verified. Please verify your email to continue.",
        )
    if ttl > 0:
        _user_cache[email] = (time.monotonic() + ttl, _snapshot(user))
    return user


def get_current_admin(token: str = Depends(oauth2_scheme)) -> dict:
    """
    Require a valid admin token (JWT carrying an is_admin claim, issued by
    /api/admin/login). Guards every /api/admin/* route except login itself.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(token)
    if payload is None or not payload.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )
    return {"email": payload.get("sub"), "is_admin": True}


def get_admin_email(admin: dict = Depends(get_current_admin)) -> str:
    """Convenience dependency returning just the admin's email (for audit fields)."""
    return admin.get("email") or ""
