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

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.RATE_LIMIT_STORAGE_URI,
)
