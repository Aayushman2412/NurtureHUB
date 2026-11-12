"""
Application-wide rate limiting (slowapi).

Two key functions, because the right axis differs by endpoint — and getting
this wrong is not a theoretical problem here.

`client_key` (source address)
    For endpoints reached before sign-in. These are **flood ceilings, not
    brute-force controls.** Whole ICDS block offices sit behind a single NAT
    address, and Indian mobile networks put thousands of subscribers behind one
    CGNAT address, so everyone signing in for a scheduled test shares one
    bucket. A tight per-address limit on `/api/auth/login` therefore does not
    stop an attacker (who has many addresses) while it does stop a district
    (which has one). Brute force is handled per ACCOUNT by the lockout table in
    `app/security/lockout.py`, which is immune to how many people share an
    address.

`principal_key` (signed-in account)
    For endpoints reached after sign-in. Because a shared office address is
    many principals, these can be set genuinely tight without touching a
    legitimate cohort — while a single stolen token cannot be used to pull the
    whole database at machine speed. Applied to the export routes above all,
    since an export is the moment data leaves this system's custody.

Storage is in-memory by default, which is per-process: with N uvicorn workers
the effective ceiling is N times the configured value and it resets on restart.
That is fine for the ceilings above; set `RATE_LIMIT_STORAGE_URI=redis://…`
when running multiple workers if you need them to be exact.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings
from app.security.context import forwarded_client


def client_key(request):
    """Rate-limit bucket key: the caller's source address.

    Behind a trusted reverse proxy every request's direct peer is the proxy, so
    keying on request.client.host puts ALL users in one bucket. When
    TRUST_PROXY_HEADERS is set, key on the address the proxy reported instead
    (`security/context.py:forwarded_client`, shared with the audit trail): the
    CLIENT_IP_HEADER the edge overwrites (Cloudflare: cf-connecting-ip) when
    one is configured, else the left-most X-Forwarded-For hop — and only if it
    parses as an IP. Only trust these where a proxy you control sets them —
    otherwise clients can spoof them to dodge limits. The bundled host nginx
    config sets `X-Forwarded-For $remote_addr`, which replaces anything the
    client sent rather than appending to it.
    """
    if settings.TRUST_PROXY_HEADERS:
        forwarded = forwarded_client(request.headers)
        if forwarded:
            return forwarded
    return get_remote_address(request)


def principal_key(request):
    """Rate-limit bucket key: the signed-in account, falling back to the address.

    Reads the bearer token's subject claim. The signature is verified (so the
    key cannot be forged by editing the token) but nothing is looked up in the
    database — this runs before the endpoint on every request, and a per-request
    query here would cost more than the limit saves.

    Falling back to the address matters: an unauthenticated caller must not land
    in a shared "anonymous" bucket where one of them could exhaust the limit for
    everyone else.
    """
    auth = request.headers.get("authorization") or ""
    if auth[:7].lower() == "bearer ":
        # Imported here rather than at module scope: app.auth pulls in the
        # Google OAuth client, and this module is imported very early in boot.
        from app.auth import decode_access_token

        payload = decode_access_token(auth[7:].strip())
        if payload and payload.get("sub"):
            return f"user:{payload['sub']}"
    return f"ip:{client_key(request)}"


def build_limiter(storage_uri: str) -> Limiter:
    """The application limiter over `storage_uri`.

    `in_memory_fallback_enabled`: when shared storage (Redis) is unreachable,
    slowapi counts in this process instead and probes Redis again with backoff.
    Without it every limited route — sign-in, OTP, exports — answers 500 for as
    long as Redis is down, which turns a cache outage into a sign-in outage. The
    fallback ceilings are per process (N pods = N x the limit), which is what
    the memory:// default already is and is fine for flood ceilings.
    """
    return Limiter(
        key_func=client_key,
        storage_uri=storage_uri,
        enabled=settings.RATE_LIMIT_ENABLED,
        in_memory_fallback_enabled=True,
    )


limiter = build_limiter(settings.RATE_LIMIT_STORAGE_URI)
