from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from jose import JWTError, jwt
import bcrypt
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from app.config import settings

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8")
        )
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def hash_otp(otp: str) -> str:
    """Hash an OTP for storage. OTPs are never persisted in plaintext."""
    return get_password_hash(otp)

def verify_otp_code(otp: str, hashed_otp: str) -> bool:
    """Constant-time comparison of a submitted OTP against its stored hash."""
    return verify_password(otp, hashed_otp)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None

def verify_google_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify Google OAuth2 ID Token.
    Returns token payload containing email, name, sub (google_id) if valid, else None.
    """
    try:
        # In a real app we verify with the Google Client ID.
        # If GOOGLE_CLIENT_ID is not configured in settings, we do verification without checking client ID,
        # or we check using standard library requests.
        client_id = settings.GOOGLE_CLIENT_ID or None
        idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), client_id)
        
        # Or check issuer
        if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
            raise ValueError('Wrong issuer.')
            
        return {
            "email": idinfo.get("email"),
            "full_name": idinfo.get("name"),
            "google_id": idinfo.get("sub"),
            "avatar_initials": "".join([part[0].upper() for part in idinfo.get("name", "").split() if part][:2])
        }
    except Exception as e:
        print(f"Google ID token verification failed: {e}")
        # For development/demo purposes, if verification fails but settings allow or for specific mock tokens:
        # We can support a fallback for testing where we mock verify a fake token if needed,
        # but let's implement standard verification.
        return None
