"""Per-request security context.

Audit calls happen deep inside routers and service functions that have no
business taking a `Request` parameter just so they can record an IP address, so
the middleware publishes the request's identity through a `ContextVar` that
`audit.record()` reads.

Why the context object is mutable
---------------------------------
This is the part that is easy to get wrong, and getting it wrong quietly
destroys the trail's value — it did here first time round, producing a log where
every patient-record access was attributed to "anonymous".

FastAPI runs each sync dependency and each sync route handler in the threadpool,
and `run_in_threadpool` gives every one of those calls its own *copy* of the
context. Rebinding the `ContextVar` inside `get_current_user` therefore mutates a
copy that is thrown away the moment that dependency returns; by the time the
route handler runs, the caller's identity is gone.

`contextvars.copy_context()` copies the variable-to-value mapping, not the value
itself. So a single mutable object, bound once by the middleware, is shared by
every copied context in the request — and `set_actor()` writing a field on that
object is visible everywhere, including the handler that logs the access. Each
request gets its own object, so nothing leaks between concurrent requests.

The tradeoff is that this object must never be shared beyond one request, which
is why `set_context` is called only by the middleware.
"""
from __future__ import annotations

import contextvars
import hashlib
import ipaddress
import uuid
from dataclasses import dataclass, field
from typing import Optional

from app.config import settings


@dataclass
class SecurityContext:
    """Mutable, one instance per request. See the module docstring."""

    request_id: str
    source_ip: Optional[str] = None
    forwarded_for: Optional[str] = None
    user_agent: Optional[str] = None
    method: Optional[str] = None
    path: Optional[str] = None
    actor_type: str = "anonymous"
    actor_id: Optional[int] = None
    actor_label: Optional[str] = None
    session_jti: Optional[str] = None
    device_hash: Optional[str] = None
    # Set by routers that want an explicit reason recorded against a PHI read
    # ("break-glass", "supervisory review"). Free text, redacted like any detail.
    access_reason: Optional[str] = None
    extra: dict = field(default_factory=dict)


def _empty() -> SecurityContext:
    """A fresh blank context.

    A function rather than a module-level singleton: the default is mutable, and
    a shared default could accumulate one request's actor and hand it to the
    next caller that runs outside a request (a background sweep, a script).
    """
    return SecurityContext(request_id="-")


_ctx: contextvars.ContextVar = contextvars.ContextVar("nh_security_context", default=None)


def new_request_id() -> str:
    return uuid.uuid4().hex


def get_context() -> SecurityContext:
    current = _ctx.get()
    if current is None:
        current = _empty()
        _ctx.set(current)
    return current


def set_context(ctx: SecurityContext):
    """Bind a new context for this request. Called only by the middleware."""
    return _ctx.set(ctx)


def reset_context(token) -> None:
    try:
        _ctx.reset(token)
    except ValueError:
        # Reset from a different context (e.g. a task that outlived the
        # request). Nothing to unwind.
        pass


def update_context(**changes) -> None:
    """Set fields on the *existing* context object, in place.

    In place, not rebinding — see the module docstring. Rebinding here is what
    loses the actor across FastAPI's threadpool boundary.
    """
    current = get_context()
    for key, value in changes.items():
        setattr(current, key, value)


def set_actor(actor_type: str, actor_label=None, actor_id=None, session_jti=None) -> None:
    """Record who the authenticated principal is, once auth has resolved it."""
    update_context(
        actor_type=actor_type,
        actor_label=actor_label,
        actor_id=actor_id,
        session_jti=session_jti,
    )


def client_ip(request) -> Optional[str]:
    """The caller's address, honouring a trusted proxy chain.

    Behind the production nginx every peer is 127.0.0.1, which would make every
    audit row say the same thing. `TRUST_PROXY_HEADERS` is the same switch the
    rate limiter uses — only turn it on where a proxy you control sets the
    header, because a client can otherwise forge it and mis-attribute its own
    actions in the audit trail.
    """
    if settings.TRUST_PROXY_HEADERS:
        forwarded = forwarded_client(request.headers)
        if forwarded:
            return forwarded[:64]
    peer = getattr(request, "client", None)
    return peer.host[:64] if peer and peer.host else None


def forwarded_client(headers) -> Optional[str]:
    """The client address a trusted proxy reported, or None to use the peer.

    Shared by the audit trail and the rate limiter so the two can never disagree
    about who a caller is. With CLIENT_IP_HEADER set (behind Cloudflare,
    "cf-connecting-ip") only that header counts: the edge overwrites it on every
    request, whereas it merely *appends* to an X-Forwarded-For the client sent,
    so the left-most hop there is the client's own claim. A request without the
    header did not come through the edge, so it gets no forwarded address at all
    rather than a fallback to the forgeable one.

    Whatever is reported must parse as an IP address. Anything else is a forgery
    or a misconfiguration, and accepting it would let a caller write free text
    into the audit trail's source address and mint a fresh rate-limit bucket per
    request. The edge header only protects anything if the origin accepts
    traffic from the edge alone (deploy/helm/eduposhan/README.md).
    """
    header = settings.CLIENT_IP_HEADER.strip().lower()
    if header:
        reported = headers.get(header) or ""
    else:
        reported = (headers.get("x-forwarded-for") or "").split(",")[0]
    try:
        return str(ipaddress.ip_address(reported.strip()))
    except ValueError:
        return None


def device_fingerprint(request) -> Optional[str]:
    """Coarse, stable-per-browser hash. Not an identifier — a change detector.

    Deliberately weak: user agent plus accept-language, nothing that could be
    used to re-identify a person across sites. It exists to notice that a live
    session started presenting a different browser, which is what session theft
    looks like.
    """
    ua = request.headers.get("user-agent") or ""
    lang = request.headers.get("accept-language") or ""
    if not ua and not lang:
        return None
    return hashlib.sha256(f"{ua}|{lang}".encode("utf-8")).hexdigest()[:32]
