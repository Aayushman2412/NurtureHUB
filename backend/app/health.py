"""What the Kubernetes probes ask (deploy/helm/eduposhan).

* **Liveness** — `/healthz` in app/main.py: is this process wedged? It is
  answered on the event loop and checks nothing else, on purpose. If a
  database outage failed liveness, Kubernetes would restart every pod at once
  and turn a recoverable blip into a cold start of the whole fleet.
* **Readiness** — `/readyz`: should this pod receive traffic right now?
  `gather_probe` collects facts and `readiness_problems` decides. Keeping the
  two apart is what lets the decision be tested without a database.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import List, Optional, Tuple

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.config import settings
from app.security import audit as security_audit
from app.ws_manager import manager

# The audit writer's queue is bounded at this size (security/audit.py:_queue);
# past it, events go straight to the on-disk spool. Pinned by a test.
AUDIT_QUEUE_CAPACITY = 10000
# Shed this pod once its audit queue is this full, so the writer drains before spilling.
AUDIT_SHED_RATIO = 0.9
# Long enough for a loaded but healthy database, short enough that the probe
# (timeoutSeconds: 5 in the chart) still answers — with a reason.
DB_PING_TIMEOUT_SECONDS = 2.0
# libpq's own bound on reaching the server (whole seconds, 2 at least), so a
# blackholed database cannot hold the checking thread for minutes.
CONNECT_TIMEOUT_SECONDS = 2

_probe_engine = None
_inflight: Optional[asyncio.Future] = None


@dataclass(frozen=True)
class Probe:
    """Facts about this pod at one instant. No decisions."""

    database_error: Optional[str]  # None = it answered; "timeout"; or the error's class name
    database_ms: Optional[float]   # round trip of SELECT 1, when it answered
    redis_configured: bool
    redis_ok: bool                 # meaningful only when configured
    audit_queued: int              # events waiting for the audit writer
    audit_capacity: int            # beyond this they spill to the on-disk spool


def _engine():
    """A connection of the probe's own for every check, never the request pool's.

    Through the shared pool a saturated pod — every connection busy serving —
    would look exactly like a dead database, and readiness would push the
    busiest pods out of rotation and load their neighbours further. NullPool
    opens one short connection per check (cheap through PgBouncer).
    """
    global _probe_engine
    if _probe_engine is None:
        url = settings.DATABASE_URL
        connect_args = {} if url.startswith("sqlite") else {"connect_timeout": CONNECT_TIMEOUT_SECONDS}
        _probe_engine = create_engine(url, poolclass=NullPool, connect_args=connect_args)
    return _probe_engine


def _ping_database() -> float:
    started = time.perf_counter()
    with _engine().connect() as conn:
        conn.execute(text("SELECT 1"))
    return (time.perf_counter() - started) * 1000


async def _database_round_trip() -> Tuple[Optional[str], Optional[float]]:
    """(error, milliseconds) for SELECT 1, answered within DB_PING_TIMEOUT_SECONDS.

    Single-flight: a check still running from an earlier probe is waited on
    again rather than joined by another thread, so a hung database occupies at
    most one executor thread per process — the executor the attempt finalizer
    and care sweeper also run on.
    """
    global _inflight
    loop = asyncio.get_running_loop()
    if _inflight is None or _inflight.done() or _inflight.get_loop() is not loop:
        _inflight = asyncio.ensure_future(asyncio.to_thread(_ping_database))
    try:
        return None, await asyncio.wait_for(asyncio.shield(_inflight), DB_PING_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        return "timeout", None
    except Exception as exc:  # the class name is enough; a message can carry a hostname
        return type(exc).__name__, None


async def gather_probe() -> Probe:
    """Measure, never decide. Each check is bounded so the probe answers."""
    database_error, database_ms = await _database_round_trip()
    redis = await manager.redis_ping()
    return Probe(
        database_error=database_error,
        database_ms=database_ms,
        redis_configured=redis is not None,
        redis_ok=bool(redis),
        audit_queued=int(security_audit.stats().get("queued", 0)),
        audit_capacity=AUDIT_QUEUE_CAPACITY,
    )


def readiness_problems(probe: Probe) -> List[str]:
    """The reasons this pod should be taken out of rotation; [] means ready.

    Every pod answers this independently, and a fact that is true of a shared
    dependency is true for all of them at once — so a rule here can take out
    one pod or the whole fleet. The policy:

    * The database not answering takes the pod out. Every pod goes together,
      and that is wanted: without the database no request can succeed, and
      the gateway's immediate 503 beats requests hanging for the pool timeout.
    * Redis down does NOT. The app has a degraded mode for it (rate limits fall
      back to memory, leased jobs pause), so pulling the fleet would turn a
      partial outage into a full one.
    * A slow database is not a reason either: slowness is shared too, and
      taking pods out only piles their traffic onto the rest.
    * An audit backlog near capacity is local to this pod. Shedding its traffic
      lets the writer drain before events spill to the disk spool.

    Reasons name the failing part only, never a host: they are the 503 body.
    """
    problems: List[str] = []
    if probe.database_error is not None:
        problems.append(f"database: {probe.database_error}")
    if probe.audit_capacity and probe.audit_queued >= AUDIT_SHED_RATIO * probe.audit_capacity:
        problems.append("audit: writer backlog near capacity")
    return problems
