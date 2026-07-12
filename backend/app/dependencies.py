from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import get_db
from app.auth import decode_access_token
from app.models import User

# Standard OAuth2 scheme for JWT token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    if not token:
        raise credentials_exception
        
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception
        
    email: str = payload.get("sub")
    if email is None:
        raise credentials_exception
        
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
        
    # Note: this dependency allows unverified users through so they can complete
    # the onboarding flow (fetch /users/me, verify OTP, build profile).
    # Content routes should depend on get_verified_user instead.
    return user


def get_verified_user(current_user: User = Depends(get_current_user)) -> User:
    """Require an authenticated AND OTP-verified account. Use on content routes."""
    if not current_user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not verified. Please verify your email to continue.",
        )
    return current_user


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
