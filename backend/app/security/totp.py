"""RFC 6238 TOTP, implemented on the standard library.

Authenticator apps (Google Authenticator, Aegis, FreeOTP, Authy) all speak the
same 30-second SHA-1 6-digit variant; there is nothing to configure and no
reason to take a dependency for ~40 lines of HMAC.

Two details that are easy to get wrong and matter here:

* **Drift.** Phone clocks are not exact. `verify()` accepts one step either
  side of now, which is the usual ±30s tolerance.
* **Replay.** A 6-digit code stays valid for its whole window, so a code
  observed over someone's shoulder (or in a phished session) can be reused
  seconds later. `verify()` returns the step it matched so the caller can store
  it and refuse any step less than or equal to the last accepted one.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP_SECONDS = 30
DIGITS = 6
DEFAULT_WINDOW = 1  # steps either side of now


def generate_secret(length: int = 20) -> str:
    """A base32 secret. 20 bytes is RFC 4226's recommendation for HMAC-SHA1."""
    return base64.b32encode(secrets.token_bytes(length)).decode("ascii").rstrip("=")


def _code_for_step(secret: str, step: int) -> str:
    padding = "=" * (-len(secret) % 8)
    key = base64.b32decode(secret.upper() + padding, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10 ** DIGITS)).zfill(DIGITS)


def current_step(at: float = None) -> int:
    return int((at if at is not None else time.time()) // STEP_SECONDS)


def code(secret: str, at: float = None) -> str:
    return _code_for_step(secret, current_step(at))


def verify(secret: str, submitted: str, last_step: int = None, window: int = DEFAULT_WINDOW):
    """Check a submitted code.

    Returns the matched step on success, or ``None``. Pass `last_step` (the step
    of the previous successful verification) to reject replays; a code from a
    step already used is refused even though it is still arithmetically valid.
    """
    if not secret or not submitted:
        return None
    cleaned = "".join(ch for ch in submitted if ch.isdigit())
    if len(cleaned) != DIGITS:
        return None
    now = current_step()
    for offset in range(-window, window + 1):
        step = now + offset
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(_code_for_step(secret, step), cleaned):
            return step
    return None


def provisioning_uri(secret: str, account: str, issuer: str = "NurtureHUB") -> str:
    """otpauth:// URI an authenticator app scans (or opens when tapped on mobile)."""
    label = quote(f"{issuer}:{account}", safe="")
    return (
        f"otpauth://totp/{label}?secret={secret}"
        f"&issuer={quote(issuer, safe='')}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"
    )


def format_secret(secret: str) -> str:
    """Grouped in fours, for someone typing it in by hand."""
    return " ".join(secret[i:i + 4] for i in range(0, len(secret), 4))
