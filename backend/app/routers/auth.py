from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from datetime import datetime, timedelta
from app.database import get_db
from app.models import User
from app.schemas import UserRegister, UserLogin, OTPVerify, ForgotPasswordRequest, Token, GoogleLoginRequest
from app.auth import (
    get_password_hash, verify_password, create_access_token, verify_google_token,
    hash_otp, verify_otp_code, needs_rehash,
)
from app.utils import generate_otp, send_otp_email, EmailDeliveryError
from app.config import settings
from app.rate_limit import limiter
from app.dependencies import get_current_user, oauth2_scheme
from app.security import audit, lockout, mfa, passwords, sessions

router = APIRouter(prefix="/api/auth", tags=["auth"])


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=1)


def _issue(db: Session, user: User, request: Request, mfa_satisfied: bool = False) -> str:
    """Mint a token backed by a revocable session row."""
    token, _session = sessions.issue(
        db,
        principal=user.email,
        is_admin=bool(user.is_admin),
        user_id=user.id,
        request=request,
        mfa_satisfied=mfa_satisfied,
        commit=False,
    )
    return token


def maybe_upgrade_hash(db: Session, user_id, stored_hash: str, plaintext: str) -> bool:
    """Re-hash a password whose stored work factor no longer matches the setting.

    Sign-in is the only moment the plaintext exists, so it is the only moment
    this is possible. Best-effort by design: a failure here must never turn a
    correct password into a failed sign-in, so it is swallowed and simply
    retried next time.
    """
    if not user_id or not stored_hash or not needs_rehash(stored_hash):
        return False
    try:
        db.query(User).filter(User.id == user_id).update(
            {"password_hash": get_password_hash(plaintext)}, synchronize_session=False
        )
        return True
    except Exception:  # noqa: BLE001 — never fail a valid sign-in over this
        return False


def _guard_lockout(db: Session, principal: str) -> None:
    """Refuse a sign-in attempt while the account is in its cooling-off period.

    The message says how long is left rather than staying vague: a locked-out
    health worker in the field needs to know whether to wait or to call someone,
    and the lockout is already discoverable by trying again.
    """
    active = lockout.active_lockout(db, principal)
    if not active:
        return
    seconds = lockout.seconds_remaining(active)
    minutes = max(1, (seconds + 59) // 60)
    audit.record(
        audit.Action.LOGIN_FAILURE,
        resource_type="account",
        resource_id=principal,
        outcome="denied",
        is_phi=False,
        record_count=0,
        detail={"principal": principal, "reason": "account_locked", "seconds_remaining": seconds},
    )
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=(
            f"Too many failed sign-in attempts. Try again in {minutes} minute"
            f"{'s' if minutes != 1 else ''}, or ask an administrator to unlock the account."
        ),
        headers={"Retry-After": str(seconds)},
    )


def _otp_expiry() -> datetime:
    return datetime.utcnow() + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)


def _recently_sent(user: User) -> bool:
    """True if the user's current (unexpired) OTP was issued within the resend cooldown."""
    if not user.otp_expires_at or user.otp_expires_at <= datetime.utcnow():
        return False
    sent_at = user.otp_expires_at - timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
    return (datetime.utcnow() - sent_at).total_seconds() < settings.OTP_RESEND_COOLDOWN_SECONDS


def _consume_otp(user: User, code: str, db: Session) -> None:
    """
    Validate a submitted OTP against the stored hash, enforcing expiry and an
    attempt cap. Raises HTTPException on any failure. On success the OTP is cleared.
    """
    if not user.otp_code or not user.otp_expires_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No active verification code. Please request a new one.")

    if user.otp_expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Verification code has expired. Please request a new one.")

    if (user.otp_attempts or 0) >= settings.OTP_MAX_ATTEMPTS:
        # Too many wrong guesses — invalidate the code to stop brute forcing.
        user.otp_code = None
        user.otp_expires_at = None
        user.otp_attempts = 0
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Too many incorrect attempts. Please request a new code.")

    if not verify_otp_code(code, user.otp_code):
        user.otp_attempts = (user.otp_attempts or 0) + 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Invalid verification code")

    # Success — single-use.
    user.otp_code = None
    user.otp_expires_at = None
    user.otp_attempts = 0


@router.post("/register", response_model=Token)
@limiter.limit(lambda: settings.RATE_LIMIT_REGISTER)
def register(request: Request, user_data: UserRegister, db: Session = Depends(get_db)):
    # Check if user already exists
    norm_email = user_data.email.strip().lower()
    existing_user = db.query(User).filter(func.lower(User.email) == norm_email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email address already exists"
        )

    # Password policy is enforced here rather than in the Pydantic schema so the
    # message can name the specific rule that failed. A 400 with "must be at
    # least 10 characters" is actionable; a 422 validation blob is not.
    try:
        passwords.validate(
            user_data.password, email=norm_email, full_name=user_data.full_name
        )
    except passwords.PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    # Generate OTP (plaintext is emailed; only the hash is stored)
    otp = generate_otp()

    new_user = User(
        email=norm_email,
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        is_verified=False,
        otp_code=hash_otp(otp),
        otp_expires_at=_otp_expiry(),
        otp_attempts=0,
        avatar_initials="".join([part[0].upper() for part in user_data.full_name.split() if part][:2])
    )

    db.add(new_user)
    db.flush()  # assign PK without committing, so we can roll back if email fails

    # Deliver the code before committing — in production a delivery failure must
    # not leave an orphan account that can never receive its verification code.
    try:
        send_otp_email(new_user.email, otp)
    except EmailDeliveryError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send the verification email. Please try again shortly."
        )

    passwords.record_history(db, norm_email, new_user.password_hash)
    access_token = _issue(db, new_user, request)
    audit.record_sync(
        audit.Action.OTP_SENT,
        db=db,
        resource_type="account",
        resource_id=norm_email,
        is_phi=False,
        actor_override={"actor_type": "learner", "actor_label": norm_email, "actor_id": new_user.id},
        detail={"principal": norm_email, "stage": "registration"},
    )
    db.commit()
    db.refresh(new_user)

    is_complete = bool(new_user.role is not None or new_user.is_admin)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": False,
        "is_profile_complete": is_complete,
        "is_admin": bool(new_user.is_admin)
    }


@router.post("/login", response_model=Token)
@limiter.limit(lambda: settings.RATE_LIMIT_LOGIN)
def login(request: Request, credentials: UserLogin, db: Session = Depends(get_db)):
    norm_email = credentials.email.strip().lower()
    _guard_lockout(db, norm_email)

    user = db.query(User).filter(func.lower(User.email) == norm_email).first()

    # Read everything needed off the row, then END THE TRANSACTION before
    # hashing.
    #
    # Verifying a bcrypt hash costs ~300ms of CPU, and until this commit the
    # handler held its database connection open across the whole of it — an
    # "idle in transaction" connection per in-flight sign-in. When a test goes
    # live and a few hundred health workers sign in together, that exhausted
    # the pool (QueuePool limit of size 20 overflow 40 reached) and turned
    # legitimate sign-ins into 500s. The hash does not need a database, so it
    # should not hold one.
    stored_hash = user.password_hash if user else None
    user_id = user.id if user else None
    user_email = user.email if user else None
    user_is_admin = bool(user.is_admin) if user else False
    user_is_verified = bool(user.is_verified) if user else False
    user_role = user.role if user else None
    db.commit()

    if not stored_hash or not verify_password(credentials.password, stored_hash):
        # The attempt is recorded before the 401 is raised — a failed sign-in
        # against an account that does not exist is as interesting to an
        # investigation as one against an account that does.
        lockout.record_attempt(
            db,
            principal=norm_email,
            successful=False,
            surface="learner",
            reason="no_such_user" if not stored_hash else "bad_password",
            request=request,
        )
        audit.record(
            audit.Action.LOGIN_FAILURE,
            resource_type="account",
            resource_id=norm_email,
            outcome="denied",
            is_phi=False,
            record_count=0,
            detail={"principal": norm_email, "surface": "learner"},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # An administrator's credentials must not open a learner session. Admins sign
    # in at /api/admin/login; keeping the surfaces apart is what lets the audit
    # trail say which one a session came from.
    #
    # The check runs AFTER the password verification deliberately. Refusing
    # before it would answer instantly for administrators and only after ~300ms
    # of bcrypt for everyone else — enough of a timing difference to enumerate
    # who the administrators are. The message stays the generic one for the same
    # reason. It is NOT counted as a lockout attempt: the password was correct,
    # so this is a wrong-door mistake, not a credential guess, and counting it
    # would let an admin lock themselves out of the console by habit.
    if user_is_admin:
        audit.record(
            audit.Action.LOGIN_FAILURE,
            resource_type="account",
            resource_id=norm_email,
            outcome="denied",
            is_phi=False,
            record_count=0,
            detail={"principal": norm_email, "surface": "learner",
                    "reason": "admin_credentials_on_learner_surface"},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Profile is considered complete once a role/designation has been set, or if user is admin
    is_complete = bool(user_role is not None or user_is_admin)

    # The stored hash may predate a change to BCRYPT_ROUNDS. This is the only
    # moment the plaintext is available, so it is the only moment a rehash is
    # possible — see app/auth.py:needs_rehash.
    upgraded = maybe_upgrade_hash(db, user_id, stored_hash, credentials.password)

    lockout.record_attempt(
        db, principal=norm_email, successful=True, surface="learner", request=request, commit=False
    )
    access_token, _session = sessions.issue(
        db,
        principal=user_email,
        is_admin=user_is_admin,
        user_id=user_id,
        request=request,
        commit=False,
    )
    audit.record_sync(
        audit.Action.LOGIN_SUCCESS,
        db=db,
        resource_type="account",
        resource_id=norm_email,
        is_phi=False,
        actor_override={"actor_type": "learner", "actor_label": user_email, "actor_id": user_id},
        detail={"principal": user_email, "surface": "learner", "verified": user_is_verified,
                "password_hash_upgraded": upgraded},
    )
    db.commit()

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": user_is_verified,
        "is_profile_complete": is_complete,
        # user_is_admin, not user.is_admin: the row was expired by the commit
        # above, so touching the ORM object here issues a refresh SELECT — the
        # exact per-sign-in round-trip the read-then-commit dance avoids.
        # (Always False now; admins are refused above.)
        "is_admin": user_is_admin,
    }


@router.post("/verify-otp", response_model=Token)
@limiter.limit(lambda: settings.RATE_LIMIT_OTP)
def verify_otp(request: Request, data: OTPVerify, db: Session = Depends(get_db)):
    norm_email = data.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == norm_email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    _consume_otp(user, data.code, db)
    user.is_verified = True

    is_complete = bool(user.role is not None or user.is_admin)
    access_token = _issue(db, user, request)
    audit.record_sync(
        audit.Action.OTP_VERIFIED,
        db=db,
        resource_type="account",
        resource_id=norm_email,
        is_phi=False,
        actor_override={"actor_type": "learner", "actor_label": user.email, "actor_id": user.id},
        detail={"principal": user.email},
    )
    db.commit()

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": True,
        "is_profile_complete": is_complete,
        "is_admin": bool(user.is_admin)
    }


@router.post("/forgot-password")
@limiter.limit(lambda: settings.RATE_LIMIT_REGISTER)
def forgot_password(request: Request, data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    generic_response = {"message": "If the email is registered, a password reset code has been sent."}

    if not user:
        # Avoid user enumeration — respond the same whether or not the email exists.
        return generic_response

    # Throttle resends without leaking existence: silently skip if a code was
    # just sent, but return the same generic message.
    if _recently_sent(user):
        return generic_response

    otp = generate_otp()
    user.otp_code = hash_otp(otp)
    user.otp_expires_at = _otp_expiry()
    user.otp_attempts = 0

    try:
        send_otp_email(user.email, otp)
    except EmailDeliveryError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send the reset email. Please try again shortly."
        )

    db.commit()
    return generic_response


class PasswordResetRequest(OTPVerify):
    """Reset payload. `new_password` travels in the body, never the URL.

    It used to be a query parameter, which put the plaintext password into the
    nginx access log, the browser's history and every proxy in between. The
    query form is still accepted for one release so a client running a cached
    bundle is not stranded mid-reset, and its use is recorded.
    """

    new_password: Optional[str] = None


@router.post("/reset-password")
@limiter.limit(lambda: settings.RATE_LIMIT_OTP)
def reset_password(
    request: Request,
    data: PasswordResetRequest,
    new_password: Optional[str] = None,
    db: Session = Depends(get_db),
):
    submitted = data.new_password or new_password
    if not submitted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Provide the new password.")
    if data.new_password is None and new_password is not None:
        audit.record(
            "auth.password.reset.deprecated_query",
            resource_type="account",
            resource_id=(data.email or "").strip().lower(),
            is_phi=False,
            record_count=0,
            detail={"note": "new_password arrived as a URL query parameter (old client bundle)"},
        )

    norm_email = (data.email or "").strip().lower()
    user = db.query(User).filter(func.lower(User.email) == norm_email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    try:
        passwords.enforce(
            db,
            submitted,
            principal=user.email,
            is_admin=bool(user.is_admin),
            full_name=user.full_name,
        )
    except passwords.PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    _consume_otp(user, data.code, db)
    user.password_hash = get_password_hash(submitted)
    user.is_verified = True
    passwords.record_history(db, user.email, user.password_hash)

    # A password reset is the standard response to a suspected compromise, so it
    # must end every session that credential opened. Leaving them alive would
    # mean the attacker keeps their access and the legitimate owner believes the
    # problem is solved.
    revoked = sessions.revoke_all_for(
        db, user.email, reason="password_reset", by=user.email, commit=False
    )
    lockout.clear(db, user.email, by="password_reset", commit=False)
    audit.record_sync(
        audit.Action.PASSWORD_RESET,
        db=db,
        resource_type="account",
        resource_id=user.email,
        is_phi=False,
        actor_override={"actor_type": "learner", "actor_label": user.email, "actor_id": user.id},
        detail={"principal": user.email, "sessions_revoked": revoked},
    )
    db.commit()

    return {
        "message": "Password reset successful. You can now login with your new password.",
        "sessions_ended": revoked,
    }


@router.post("/change-password")
def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change your own password, proving you know the current one.

    Other sessions are ended; the one making the change survives, so a person
    changing their password on a shared device is not signed out of the browser
    they are standing at while every other copy of the credential is cut off.
    """
    if not current_user.password_hash or not verify_password(
        payload.current_password, current_user.password_hash
    ):
        audit.record(
            audit.Action.LOGIN_FAILURE,
            resource_type="account",
            resource_id=current_user.email,
            outcome="denied",
            is_phi=False,
            record_count=0,
            detail={"principal": current_user.email, "stage": "change_password"},
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Your current password is not correct.")
    try:
        passwords.enforce(
            db,
            payload.new_password,
            principal=current_user.email,
            is_admin=bool(current_user.is_admin),
            full_name=current_user.full_name,
        )
    except passwords.PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    current_user.password_hash = get_password_hash(payload.new_password)
    passwords.record_history(db, current_user.email, current_user.password_hash)

    from app.security import context as security_context

    keep = security_context.get_context().session_jti
    revoked = sessions.revoke_all_for(
        db, current_user.email, reason="password_change", by=current_user.email,
        except_jti=keep, commit=False,
    )
    audit.record_sync(
        audit.Action.PASSWORD_CHANGED,
        db=db,
        resource_type="account",
        resource_id=current_user.email,
        is_phi=False,
        detail={"principal": current_user.email, "other_sessions_revoked": revoked},
    )
    db.commit()
    from app.dependencies import invalidate_user_cache

    invalidate_user_cache(current_user.email)
    return {"message": "Password changed.", "other_sessions_ended": revoked}


@router.post("/logout")
def logout(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """End this session on the server.

    Previously signing out only cleared the browser's copy of the token, which
    left the credential valid for the rest of its life — a real problem on the
    shared phones field workers use.
    """
    from app.auth import decode_access_token

    payload = decode_access_token(token) if token else None
    if not payload:
        return {"message": "Signed out."}
    jti = payload.get("jti")
    principal = payload.get("sub")
    if jti:
        sessions.revoke(db, jti, reason="logout", by=principal)
    audit.record_sync(
        audit.Action.LOGOUT,
        resource_type="account",
        resource_id=principal,
        is_phi=False,
        actor_override={"actor_type": "learner", "actor_label": principal, "session_jti": jti},
        detail={"principal": principal},
    )
    return {"message": "Signed out."}


@router.get("/password-policy")
def password_policy(is_admin: bool = False):
    """The rules, so the sign-up form can state them instead of guessing."""
    return passwords.describe_policy(is_admin=is_admin)


@router.post("/google", response_model=Token)
@limiter.limit(lambda: settings.RATE_LIMIT_OTP)
def google_auth(request: Request, google_request: GoogleLoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate user via Google ID Token.
    If the user does not exist, create them and mark as verified.
    """
    payload = verify_google_token(google_request.id_token)
    if not payload:
        # Development-only fallback: accept a mock token so Google sign-in can be
        # exercised locally without a configured Client ID. Disabled in production.
        if not settings.is_production and google_request.id_token.startswith("mock_google_token_"):
            email = google_request.id_token.replace("mock_google_token_", "") + "@gmail.com"
            payload = {
                "email": email,
                "full_name": "Google Test User",
                "google_id": "google_12345_" + email.split("@")[0],
                "avatar_initials": "GU"
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid Google credential token"
            )

    # Check if google_id or email already exists
    user = db.query(User).filter((User.google_id == payload["google_id"]) | (User.email == payload["email"])).first()

    if not user:
        # Create new user, marked as verified since verified by Google
        user = User(
            email=payload["email"],
            full_name=payload["full_name"],
            google_id=payload["google_id"],
            avatar_initials=payload["avatar_initials"],
            is_verified=True
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        # Update google_id if matching email only
        if not user.google_id:
            user.google_id = payload["google_id"]
            user.is_verified = True
            db.commit()

    # An administrator's account does not open a learner session, whichever door
    # it knocks on. Unlike the password path this message can be specific: a valid
    # Google ID token proves the caller owns the address, so naming the right door
    # tells them nothing they did not already know.
    if user.is_admin:
        audit.record(
            audit.Action.LOGIN_FAILURE,
            resource_type="account",
            resource_id=user.email,
            outcome="denied",
            is_phi=False,
            record_count=0,
            detail={"principal": user.email, "surface": "google",
                    "reason": "admin_credentials_on_learner_surface"},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This is an administrator account — sign in through the admin console.",
        )

    is_complete = bool(user.role is not None or user.is_admin)
    access_token = _issue(db, user, request)
    audit.record_sync(
        audit.Action.LOGIN_SUCCESS,
        db=db,
        resource_type="account",
        resource_id=user.email,
        is_phi=False,
        actor_override={"actor_type": "learner", "actor_label": user.email, "actor_id": user.id},
        detail={"principal": user.email, "surface": "google"},
    )
    db.commit()

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": True,
        "is_profile_complete": is_complete,
        "is_admin": bool(user.is_admin)
    }
