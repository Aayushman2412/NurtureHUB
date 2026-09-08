"""Edge middleware: request identity, response hardening, and the audit of refusals.

Two middlewares, in this order (outermost first):

`SecurityHeadersMiddleware`
    Sets the response headers that constrain what a browser will do with our
    pages and, crucially for patient data, tells every cache not to keep API
    responses. Without `Cache-Control: no-store`, a mother's record can sit in a
    shared browser cache on a shared field device, or in an intermediate proxy —
    a disclosure with no attacker in it at all.

`RequestContextMiddleware`
    Assigns a request id, resolves the caller's real address through the trusted
    proxy chain, and publishes both to the `ContextVar` the audit layer reads. It
    also records the outcomes routers do not record for themselves: a refusal
    (401/403) on a patient-data path is exactly the event a later investigation
    wants, and no router remembers to log its own rejections.

Both are pure ASGI-level concerns and stay out of the routers.
"""
from __future__ import annotations

import time
from typing import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.config import settings
from app.security import audit
from app.security import context as ctx

# Paths whose responses carry, or can carry, personal data. Everything under
# /api is treated as sensitive by default; the exclusions are the endpoints that
# serve public reference data and benefit from caching.
_CACHEABLE_PREFIXES = ("/api/metadata", "/api/growth/standards", "/uploads", "/docs", "/openapi.json", "/redoc")

# Requests that are worth an audit row purely because they were refused.
_AUDITABLE_DENIAL_PREFIXES = (
    "/api/mothers", "/api/forms", "/api/growth", "/api/admin", "/api/users",
)


def _is_cacheable(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in _CACHEABLE_PREFIXES)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Response hardening.

    The Content-Security-Policy differs by path on purpose. API responses are
    JSON and get the most restrictive policy there is (`default-src 'none'`),
    which costs nothing and neutralises the classic "browse to an API URL and it
    renders as HTML" class of bug. The interactive API docs need a real policy
    because Swagger loads its own assets, and are only reachable at all when
    `ENABLE_API_DOCS` is on.
    """

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        path = request.url.path
        headers = response.headers

        headers["X-Content-Type-Options"] = "nosniff"
        headers["X-Frame-Options"] = "DENY"
        headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        headers["Cross-Origin-Opener-Policy"] = "same-origin"
        headers["Cross-Origin-Resource-Policy"] = "same-site"
        headers["Permissions-Policy"] = (
            "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), "
            "magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()"
        )
        headers["X-Permitted-Cross-Domain-Policies"] = "none"

        # HSTS only over TLS. Sending it on a plain-HTTP dev origin would pin
        # localhost to https in the developer's browser, which is a mess to undo.
        if settings.HSTS_ENABLED and (
            request.url.scheme == "https"
            or request.headers.get("x-forwarded-proto") == "https"
        ):
            headers["Strict-Transport-Security"] = (
                f"max-age={settings.HSTS_MAX_AGE}; includeSubDomains"
                + ("; preload" if settings.HSTS_PRELOAD else "")
            )

        if path.startswith("/docs") or path.startswith("/redoc") or path == "/openapi.json":
            headers["Content-Security-Policy"] = (
                "default-src 'self'; img-src 'self' data: https://fastapi.tiangolo.com; "
                "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
                "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
                "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
            )
        elif path.startswith("/uploads"):
            # Media is served inert: never executed, never framed.
            headers["Content-Security-Policy"] = (
                "default-src 'none'; img-src 'self' data:; media-src 'self'; sandbox"
            )
        else:
            headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"

        if not _is_cacheable(path):
            # The single most important header on this list for patient data.
            headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
            headers["Pragma"] = "no-cache"
            headers["Expires"] = "0"

        return response


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Publishes request identity for the audit layer and logs refusals."""

    async def dispatch(self, request, call_next):
        started = time.perf_counter()
        incoming_id = request.headers.get("x-request-id")
        request_id = (
            incoming_id[:64]
            if incoming_id and settings.TRUST_PROXY_HEADERS and incoming_id.isascii()
            else ctx.new_request_id()
        )
        token = ctx.set_context(
            ctx.SecurityContext(
                request_id=request_id,
                source_ip=ctx.client_ip(request),
                forwarded_for=(request.headers.get("x-forwarded-for") or "")[:255] or None,
                user_agent=(request.headers.get("user-agent") or "")[:512] or None,
                method=request.method,
                path=request.url.path,
            )
        )
        try:
            response = await call_next(request)
            duration_ms = int((time.perf_counter() - started) * 1000)
            # Stamped here rather than in the header middleware: that one runs
            # outside this, so by the time it sees the response the ContextVar
            # holding the id has already been reset. The id is what ties a user's
            # "it failed at 3pm" to the exact audit rows for that request.
            response.headers["X-Request-Id"] = request_id
            self._audit_outcome(request, response.status_code, duration_ms)
            return response
        except Exception:
            duration_ms = int((time.perf_counter() - started) * 1000)
            audit.record(
                "http.error",
                resource_type="endpoint",
                resource_id=request.url.path[:64],
                outcome="error",
                status_code=500,
                duration_ms=duration_ms,
                is_phi=False,
            )
            raise
        finally:
            ctx.reset_context(token)

    @staticmethod
    def _audit_outcome(request, status_code: int, duration_ms: int) -> None:
        path = request.url.path
        if status_code in (401, 403) and any(
            path.startswith(prefix) for prefix in _AUDITABLE_DENIAL_PREFIXES
        ):
            is_phi_path = not path.startswith("/api/admin/security")
            audit.record(
                audit.Action.PHI_DENIED if is_phi_path else "security.denied",
                resource_type="endpoint",
                resource_id=path[:64],
                outcome="denied",
                status_code=status_code,
                duration_ms=duration_ms,
                is_phi=False,
                record_count=0,
                detail={"reason": "unauthorised" if status_code == 401 else "forbidden"},
            )
        elif status_code == 429:
            audit.record(
                "security.rate_limited",
                resource_type="endpoint",
                resource_id=path[:64],
                outcome="denied",
                status_code=429,
                duration_ms=duration_ms,
                is_phi=False,
                record_count=0,
            )


def allowed_hosts() -> Iterable[str]:
    """Hosts the app will answer to, for Starlette's TrustedHostMiddleware.

    Host-header injection matters here because password-reset and OTP mails are
    built from the request host; an attacker who can set it can point a
    verification link at their own server.
    """
    configured = [h.strip() for h in (settings.ALLOWED_HOSTS or "").split(",") if h.strip()]
    return configured or ["*"]
