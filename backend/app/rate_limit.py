"""
Application-wide rate limiter (slowapi).

Keyed by client IP. Uses in-memory storage by default, which is correct for a
single-process deployment. For multiple workers/instances, set
RATE_LIMIT_STORAGE_URI to a shared backend (e.g. redis://host:6379).

Note: get_remote_address reads request.client.host. If you deploy behind a
reverse proxy, configure the proxy to set a trusted client IP (or swap in a
key function that reads X-Forwarded-For) so limits key on the real client.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings


def client_key(request):
    """Rate-limit bucket key.

    Behind a trusted reverse proxy every request's direct peer is the proxy, so
    keying on request.client.host puts ALL users in one bucket. When
    TRUST_PROXY_HEADERS is set, key on the left-most X-Forwarded-For hop (the
    real client) instead. Only trust the header when a proxy you control sets
    it — otherwise clients can spoof it to dodge limits.
    """
    if settings.TRUST_PROXY_HEADERS:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(
    key_func=client_key,
    storage_uri=settings.RATE_LIMIT_STORAGE_URI,
    enabled=settings.RATE_LIMIT_ENABLED,
)
