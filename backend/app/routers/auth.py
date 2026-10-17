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
    get_password_hash, verify_password, match_password, create_access_token, verify_google_token,
    hash_otp, verify_otp_code, needs_rehash,
)
from app.utils import generate_otp, send_otp_email, EmailDeliveryError
from app.config import settings
from app.rate_limit import limiter
from app.dependencies import get_current_user, oauth2_scheme
from app.security import audit, lockout, mfa, passwords, sessions
from app import identity
from app.messaging import whatsapp

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


def _note_weakness(db: Session, user_id, plaintext: str, email: Optional[str]) -> None:
    """Re-judge an existing password as it is used — accounts made before the
    learners' simpler rule (review of 17 Oct 2026) get the "choose a harder
    password" nudge too. Best-effort, like the rehash beside it."""
    if not user_id or not plaintext:
        return
    try:
        db.query(User).filter(User.id == user_id).update(
            {"password_weak": passwords.is_weak(plaintext, email=email)}, synchronize_session=False)
    except Exception:  # noqa: BLE001 — never fail a valid sign-in over this
        pass


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
        password_weak=passwords.is_weak(user_data.password, email=norm_email, full_name=user_data.full_name),
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
    if user is None:
        # A learner who signed up with a mobile number and later added — and
        # verified — an email address can sign in with that address too.
        user = (db.query(User)
                .filter(func.lower(User.contact_email) == norm_email,
                        User.contact_email_verified.is_(True), User.is_admin.is_(False))
                .first())

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

    matched = match_password(credentials.password, stored_hash) if stored_hash else None
    if not matched:
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
    # who the administrators are. It is NOT counted as a lockout attempt: the
    # password was correct, so this is a wrong-door mistake, not a credential
    # guess, and counting it would let an admin lock themselves out of the
    # console by habit.
    #
    # The answer names the right door ("use_admin_sign_in"), and the sign-in
    # page then signs in at /api/admin/login itself (review of 14 Oct 2026: an
    # admin on a new phone, another laptop or the installed app lands on this
    # form and was told "incorrect email or password" for a correct password).
    # Only someone who already holds the correct password ever sees it, so it
    # tells an attacker nothing they could not learn by trying the admin form.
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
            detail="use_admin_sign_in",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Profile is considered complete once a role/designation has been set, or if user is admin
    is_complete = bool(user_role is not None or user_is_admin)

    # The stored hash may predate a change to BCRYPT_ROUNDS. This is the only
    # moment the plaintext is available, so it is the only moment a rehash is
    # possible — see app/auth.py:needs_rehash.
    upgraded = maybe_upgrade_hash(db, user_id, stored_hash, matched)
    _note_weakness(db, user_id, matched, user_email)

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
    user.password_weak = passwords.is_weak(submitted, email=user.email, full_name=user.full_name)
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
    current_user.password_weak = passwords.is_weak(
        payload.new_password, email=current_user.email, full_name=current_user.full_name)
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


# ── Mobile number first (review of 17 Oct 2026) ───────────────────────────
#
# Sir: "let's not take email as the first step to login — let's take WhatsApp
# number based login as the first approach … email would be the last
# information which you collect … email issue should not be a hindrance for a
# person to register." A learner signs up with her name, mobile number and a
# password; the number is confirmed by a WhatsApp code when WhatsApp is set
# up, and later otherwise; an email address is optional and comes last.


@router.get("/options")
def sign_in_options():
    """What the sign-in screens can offer on this deployment — so nothing is
    shown that does not work (Google sign-in said "not configured" on the live
    site on 17 Oct 2026)."""
    return {
        "google": bool((settings.GOOGLE_CLIENT_ID or "").strip()),
        "whatsapp_otp": whatsapp.available(),
        "whatsapp_configured": whatsapp.configured(),
    }


class MobileRegister(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=10, max_length=20)
    password: str = Field(min_length=1, max_length=256)


class MobileLogin(BaseModel):
    phone: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=256)


class MobileOnly(BaseModel):
    phone: str = Field(min_length=1, max_length=20)


class MobileReset(BaseModel):
    phone: str = Field(min_length=1, max_length=20)
    code: str = Field(min_length=4, max_length=8)
    new_password: str = Field(min_length=1, max_length=256)


class CodeOnly(BaseModel):
    code: str = Field(min_length=4, max_length=8)


class ContactEmailIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)


def _mobile_or_400(raw: str) -> str:
    mobile = identity.normalise_mobile(raw)
    if mobile is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Enter a valid 10-digit mobile number.")
    return mobile


def _send_phone_code(db: Session, user: User, mobile: str) -> bool:
    """Give the account a fresh code and send it by WhatsApp. False when it
    could not be sent — the caller carries on without it."""
    if not whatsapp.available():
        return False
    from app.utils import generate_otp

    code = generate_otp()
    user.otp_code = hash_otp(code)
    user.otp_expires_at = _otp_expiry()
    user.otp_attempts = 0
    try:
        whatsapp.send_otp(mobile, code)
    except whatsapp.WhatsAppDeliveryError:
        user.otp_code = None
        user.otp_expires_at = None
        return False
    return True


def _token_body(user: User, token: str, otp_channel: Optional[str] = None) -> dict:
    return {
        "access_token": token,
        "token_type": "bearer",
        "is_verified": bool(user.is_verified),
        "is_profile_complete": bool(user.role is not None or user.is_admin),
        "is_admin": False,
        "otp_channel": otp_channel,
        "principal": user.email,
    }


@router.post("/register-mobile", response_model=Token)
@limiter.limit(lambda: settings.RATE_LIMIT_REGISTER)
def register_mobile(request: Request, data: MobileRegister, db: Session = Depends(get_db)):
    mobile = _mobile_or_400(data.phone)
    full_name = " ".join(data.full_name.split())
    if not full_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter your full name.")
    if identity.users_with_mobile(db, mobile, limit=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=(
            "This mobile number is already registered. Sign in with it, "
            "or use “Forgot password”."))
    try:
        passwords.validate(data.password, full_name=full_name)
    except passwords.PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    user = User(
        email=identity.placeholder_email(),
        phone=mobile,
        full_name=full_name,
        password_hash=get_password_hash(data.password),
        password_weak=passwords.is_weak(data.password, full_name=full_name),
        is_verified=False,
        phone_verified=False,
        otp_attempts=0,
        avatar_initials="".join(part[0].upper() for part in full_name.split()[:2]),
    )
    user.sync_lookups()
    db.add(user)
    db.flush()

    sent = _send_phone_code(db, user, mobile)
    if not sent:
        # No way to send a code (WhatsApp not set up, or it refused): the
        # number is confirmed later, and registration is not held up by it.
        user.is_verified = True
    passwords.record_history(db, user.email, user.password_hash)
    token = _issue(db, user, request)
    audit.record_sync(
        audit.Action.OTP_SENT if sent else "auth.register.mobile",
        db=db,
        resource_type="account",
        resource_id=user.email,
        is_phi=False,
        actor_override={"actor_type": "learner", "actor_label": user.email, "actor_id": user.id},
        detail={"principal": user.email, "stage": "registration", "method": "mobile",
                "channel": "whatsapp" if sent else "none"},
    )
    db.commit()
    db.refresh(user)
    return _token_body(user, token, "whatsapp" if sent else None)


@router.post("/verify-phone", response_model=Token)
@limiter.limit(lambda: settings.RATE_LIMIT_OTP)
def verify_phone(request: Request, data: CodeOnly, current_user: User = Depends(get_current_user),
                 token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """Confirm the account's mobile number with the WhatsApp code."""
    _consume_otp(current_user, data.code.strip(), db)
    current_user.phone_verified = True
    current_user.is_verified = True
    audit.record_sync(
        audit.Action.OTP_VERIFIED,
        db=db,
        resource_type="account",
        resource_id=current_user.email,
        is_phi=False,
        detail={"principal": current_user.email, "method": "mobile"},
    )
    db.commit()
    from app.dependencies import invalidate_user_cache

    invalidate_user_cache(current_user.email)
    return _token_body(current_user, token)


@router.post("/resend-phone-code")
@limiter.limit(lambda: settings.RATE_LIMIT_OTP)
def resend_phone_code(request: Request, current_user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    mobile = identity.normalise_mobile(current_user.phone)
    if mobile is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Add your mobile number to your profile first.")
    if _recently_sent(current_user):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="A code was just sent. Please wait a minute before asking again.")
    if not _send_phone_code(db, current_user, mobile):
        db.rollback()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="WhatsApp codes cannot be sent right now. Please try again later.")
    db.commit()
    return {"message": "A new code has been sent on WhatsApp.", "channel": "whatsapp"}


@router.post("/login-mobile", response_model=Token)
@limiter.limit(lambda: settings.RATE_LIMIT_LOGIN)
def login_mobile(request: Request, credentials: MobileLogin, db: Session = Depends(get_db)):
    mobile = _mobile_or_400(credentials.phone)
    # Accounts holding this number, through the blind index (usually one; a
    # shared facility phone can give a few — the password tells them apart).
    candidates = [(u.id, u.email, u.password_hash, bool(u.is_verified), u.role)
                  for u in identity.users_with_mobile(db, mobile)]
    # The lockout counts per account when the number names one; otherwise
    # per number — keyed by its blind index, never the number itself.
    principal = candidates[0][1] if len(candidates) == 1 else f"mobile:{identity.lookup_token(mobile)}"
    _guard_lockout(db, principal)
    db.commit()   # no connection held across bcrypt — see login()

    hit = None
    for uid, email, stored_hash, verified, role in candidates:
        matched = match_password(credentials.password, stored_hash) if stored_hash else None
        if matched:
            hit = (uid, email, stored_hash, verified, role, matched)
            break
    if hit is None:
        lockout.record_attempt(
            db, principal=principal, successful=False, surface="learner",
            reason="no_such_user" if not candidates else "bad_password", request=request,
        )
        audit.record(
            audit.Action.LOGIN_FAILURE,
            resource_type="account",
            resource_id=principal,
            outcome="denied",
            is_phi=False,
            record_count=0,
            detail={"principal": principal, "surface": "learner", "method": "mobile"},
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Incorrect mobile number or password",
                            headers={"WWW-Authenticate": "Bearer"})

    uid, email, stored_hash, verified, role, matched = hit
    upgraded = maybe_upgrade_hash(db, uid, stored_hash, matched)
    _note_weakness(db, uid, matched, email)
    lockout.record_attempt(db, principal=email, successful=True, surface="learner",
                           request=request, commit=False)
    access_token, _session = sessions.issue(db, principal=email, is_admin=False, user_id=uid,
                                            request=request, commit=False)
    audit.record_sync(
        audit.Action.LOGIN_SUCCESS,
        db=db,
        resource_type="account",
        resource_id=email,
        is_phi=False,
        actor_override={"actor_type": "learner", "actor_label": email, "actor_id": uid},
        detail={"principal": email, "surface": "learner", "method": "mobile", "verified": verified,
                "password_hash_upgraded": upgraded},
    )
    db.commit()
    return {
        "access_token": access_token, "token_type": "bearer", "is_verified": verified,
        "is_profile_complete": role is not None, "is_admin": False, "principal": email,
    }


@router.post("/forgot-password-mobile")
@limiter.limit(lambda: settings.RATE_LIMIT_REGISTER)
def forgot_password_mobile(request: Request, data: MobileOnly, db: Session = Depends(get_db)):
    """A reset code by WhatsApp. The answer is the same whether or not the
    number is registered."""
    mobile = _mobile_or_400(data.phone)
    if not whatsapp.available():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=(
            "Password reset by WhatsApp is not switched on yet. Reset it with your email "
            "address if you added one, or ask your trainer or batch monitor for help."))
    generic = {"message": "If the number is registered, a code has been sent on WhatsApp."}
    users = identity.users_with_mobile(db, mobile, limit=1)
    if not users or _recently_sent(users[0]):
        return generic
    if _send_phone_code(db, users[0], mobile):
        db.commit()
    else:
        db.rollback()
    return generic


@router.post("/reset-password-mobile")
@limiter.limit(lambda: settings.RATE_LIMIT_OTP)
def reset_password_mobile(request: Request, data: MobileReset, db: Session = Depends(get_db)):
    mobile = _mobile_or_400(data.phone)
    users = identity.users_with_mobile(db, mobile, limit=1)
    if not users:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No active verification code. Please request a new one.")
    user = users[0]
    try:
        passwords.enforce(db, data.new_password, principal=user.email, full_name=user.full_name)
    except passwords.PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    _consume_otp(user, data.code.strip(), db)
    user.password_hash = get_password_hash(data.new_password)
    user.password_weak = passwords.is_weak(data.new_password, email=user.email, full_name=user.full_name)
    user.phone_verified = True
    user.is_verified = True
    passwords.record_history(db, user.email, user.password_hash)
    revoked = sessions.revoke_all_for(db, user.email, reason="password_reset", by=user.email, commit=False)
    lockout.clear(db, user.email, by="password_reset", commit=False)
    audit.record_sync(
        audit.Action.PASSWORD_RESET,
        db=db,
        resource_type="account",
        resource_id=user.email,
        is_phi=False,
        actor_override={"actor_type": "learner", "actor_label": user.email, "actor_id": user.id},
        detail={"principal": user.email, "method": "mobile", "sessions_revoked": revoked},
    )
    db.commit()
    return {"message": "Password reset. You can now sign in with your new password.",
            "sessions_ended": revoked}


# ── Email, last and optional ──────────────────────────────────────────────


@router.post("/contact-email")
@limiter.limit(lambda: settings.RATE_LIMIT_REGISTER)
def add_contact_email(request: Request, data: ContactEmailIn,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Add (or change) the email address of an account made with a mobile
    number, and send a code to confirm it. Confirming can wait."""
    from pydantic import EmailStr, TypeAdapter, ValidationError

    try:
        email = TypeAdapter(EmailStr).validate_python(data.email.strip()).lower()
    except ValidationError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid email address.")
    if not identity.is_placeholder(current_user.email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="This account already signs in with an email address.")
    clash = (db.query(User.id)
             .filter(User.id != current_user.id)
             .filter((func.lower(User.email) == email) | (func.lower(User.contact_email) == email))
             .first())
    if clash:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Another account already uses that email address.")
    if _recently_sent(current_user) and (current_user.contact_email or "").lower() == email:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="A code was just sent. Please wait a minute before asking again.")
    from app.utils import generate_otp

    code = generate_otp()
    current_user.contact_email = email
    current_user.contact_email_verified = False
    current_user.otp_code = hash_otp(code)
    current_user.otp_expires_at = _otp_expiry()
    current_user.otp_attempts = 0
    try:
        send_otp_email(email, code)
        sent = True
    except EmailDeliveryError:
        # Saved anyway — the learner can confirm it later from her profile.
        current_user.otp_code = None
        current_user.otp_expires_at = None
        sent = False
    audit.record_sync(
        audit.Action.OTP_SENT if sent else "auth.contact_email.saved",
        db=db,
        resource_type="account",
        resource_id=current_user.email,
        is_phi=False,
        detail={"principal": current_user.email, "stage": "contact_email", "sent": sent},
    )
    db.commit()
    return {"saved": True, "code_sent": sent}


@router.post("/contact-email/verify")
@limiter.limit(lambda: settings.RATE_LIMIT_OTP)
def verify_contact_email(request: Request, data: CodeOnly,
                         current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.contact_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Add an email address first.")
    _consume_otp(current_user, data.code.strip(), db)
    current_user.contact_email_verified = True
    audit.record_sync(
        audit.Action.OTP_VERIFIED,
        db=db,
        resource_type="account",
        resource_id=current_user.email,
        is_phi=False,
        detail={"principal": current_user.email, "stage": "contact_email"},
    )
    db.commit()
    from app.dependencies import invalidate_user_cache

    invalidate_user_cache(current_user.email)
    return {"verified": True}


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
