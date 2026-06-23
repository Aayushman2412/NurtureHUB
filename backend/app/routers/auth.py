from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from app.database import get_db
from app.models import User
from app.schemas import UserRegister, UserLogin, OTPVerify, ForgotPasswordRequest, Token, GoogleLoginRequest
from app.auth import get_password_hash, verify_password, create_access_token, verify_google_token
from app.utils import generate_otp, send_otp_email

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/register", response_model=Token)
def register(user_data: UserRegister, db: Session = Depends(get_db)):
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == user_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email address already exists"
        )
        
    # Generate OTP
    otp = generate_otp()
    otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    
    # Create new user
    new_user = User(
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        is_verified=False,
        otp_code=otp,
        otp_expires_at=otp_expiry,
        avatar_initials="".join([part[0].upper() for part in user_data.full_name.split() if part][:2])
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Send OTP
    send_otp_email(new_user.email, otp)
    
    # Generate temporary access token
    access_token = create_access_token(data={"sub": new_user.email})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": False,
        "is_profile_complete": False
    }

@router.post("/login", response_model=Token)
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user or not user.password_hash or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    # Check if profile is complete (e.g. they completed the 3-step registration form)
    # Profile is complete if role or department is set
    is_complete = user.role is not None
    
    access_token = create_access_token(data={"sub": user.email})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "is_verified": user.is_verified,
        "is_profile_complete": is_complete
    }

@router.post("/verify-otp", response_model=Token)
def verify_otp(data: OTPVerify, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
        
    if not user.otp_code or user.otp_code != data.code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code"
        )
        
    if user.otp_expires_at and user.otp_expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired"
        )
        
    # Mark verified
    user.is_verified = True
    user.otp_code = None
    user.otp_expires_at = None
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
def forgot_password(data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        # Avoid user enumeration (don't error, just act as if it succeeded)
        return {"message": "If the email is registered, a password reset code has been sent."}
        
    otp = generate_otp()
    user.otp_code = otp
    user.otp_expires_at = datetime.utcnow() + timedelta(minutes=10)
    db.commit()
    
    send_otp_email(user.email, otp)
    
    return {"message": "A password reset code has been sent."}

@router.post("/reset-password")
def reset_password(data: OTPVerify, new_password: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
        
    if not user.otp_code or user.otp_code != data.code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code"
        )
        
    if user.otp_expires_at and user.otp_expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired"
        )
        
    user.password_hash = get_password_hash(new_password)
    user.otp_code = None
    user.otp_expires_at = None
    user.is_verified = True
    db.commit()
    
    return {"message": "Password reset successful. You can now login with your new password."}

@router.post("/google", response_model=Token)
def google_auth(request: GoogleLoginRequest, db: Session = Depends(get_db)):
    """
    Authenticate user via Google ID Token.
    If the user does not exist, create them and mark as verified.
    """
    payload = verify_google_token(request.id_token)
    if not payload:
        # For development / testing, let's allow a fallback mock google auth
        # if the token matches a test string. This allows us to test Google Auth
        # easily in the UI even without setting up a real Client ID in localhost.
        if request.id_token.startswith("mock_google_token_"):
            email = request.id_token.replace("mock_google_token_", "") + "@gmail.com"
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
