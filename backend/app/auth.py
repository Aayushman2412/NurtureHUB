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

# What a phone keyboard or a paste from WhatsApp can do to a password the
# person typed correctly: a trailing space after a word suggestion, a
# non-breaking space, a zero-width joiner, a full-width character from an
# Indic keyboard. None of it is visible in a password field.
_INVISIBLE = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff"), None)


def _typed_variants(plain: str) -> list:
    import unicodedata

    v = unicodedata.normalize("NFKC", plain or "").translate(_INVISIBLE).replace("\u00a0", " ").strip()
    return [v] if v and v != plain else []


def match_password(plain_password: str, hashed_password: Optional[str]) -> Optional[str]:
    """The plaintext that matches the hash — exactly as typed, else as typed
    without invisible characters and surrounding spaces — or None.

    The exact form is always tried first, so a password that really does
    contain such a character still works; the cleaned form costs a second
    bcrypt only when cleaning changed something. Callers re-hash with the
    returned value, never the raw input."""
    if not hashed_password:
        return None
    if verify_password(plain_password, hashed_password):
        return plain_password
    for candidate in _typed_variants(plain_password):
        if verify_password(candidate, hashed_password):
            return candidate
    return None


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def hash_rounds(hashed_password: str):
    """The work factor baked into an existing hash, or None if unreadable.

    A bcrypt hash looks like `$2b$12$<salt+digest>`; the third field is the
    cost.
    """
    try:
        return int(hashed_password.split("$")[2])
    except (AttributeError, IndexError, ValueError):
        return None


def needs_rehash(hashed_password: str) -> bool:
    """True when a stored hash was made with a different work factor.

    Changing BCRYPT_ROUNDS only affects new hashes, so without this a
    deployment that lowers the factor to speed up a test start would keep
    paying the old cost forever for everyone who already has an account — and
    one that RAISES it would leave existing accounts on the weaker setting.
    """
    current = hash_rounds(hashed_password)
    return current is not None and current != settings.BCRYPT_ROUNDS

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
