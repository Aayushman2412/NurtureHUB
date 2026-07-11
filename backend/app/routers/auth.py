from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from app.database import get_db
from app.models import User
from app.schemas import UserRegister, UserLogin, OTPVerify, ForgotPasswordRequest, Token, GoogleLoginRequest
from app.auth import (
    get_password_hash, verify_password, create_access_token, verify_google_token,
    hash_otp, verify_otp_code,
)
from app.utils import generate_otp, send_otp_email, EmailDeliveryError
from app.config import settings
from app.rate_limit import limiter

router = APIRouter(prefix="/api/auth", tags=["auth"])


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
@limiter.limit("5/hour")
def register(request: Request, user_data: UserRegister, db: Session = Depends(get_db)):
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email address already exists"
        )

    # Generate OTP (plaintext is emailed; only the hash is stored)
    otp = generate_otp()

    new_user = User(
        email=user_data.email,
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

    db.commit()
    db.refresh(new_user)

    access_token = create_access_token(data={"sub": new_user.email})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": False,
        "is_profile_complete": False
    }


@router.post("/login", response_model=Token)
@limiter.limit("10/minute")
def login(request: Request, credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user or not user.password_hash or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Profile is considered complete once a role/designation has been set.
    is_complete = user.role is not None

    access_token = create_access_token(data={"sub": user.email})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": user.is_verified,
        "is_profile_complete": is_complete
    }


@router.post("/verify-otp", response_model=Token)
@limiter.limit("10/minute")
def verify_otp(request: Request, data: OTPVerify, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    _consume_otp(user, data.code, db)
    user.is_verified = True
    db.commit()

    is_complete = user.role is not None
    access_token = create_access_token(data={"sub": user.email})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": True,
        "is_profile_complete": is_complete
    }


@router.post("/forgot-password")
@limiter.limit("5/hour")
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


@router.post("/reset-password")
@limiter.limit("10/minute")
def reset_password(request: Request, data: OTPVerify, new_password: str, db: Session = Depends(get_db)):
    if len(new_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Password must be at least 6 characters")

    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    _consume_otp(user, data.code, db)
    user.password_hash = get_password_hash(new_password)
    user.is_verified = True
    db.commit()

    return {"message": "Password reset successful. You can now login with your new password."}


@router.post("/google", response_model=Token)
@limiter.limit("10/minute")
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

    is_complete = user.role is not None
    access_token = create_access_token(data={"sub": user.email})

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": True,
        "is_profile_complete": is_complete
    }
