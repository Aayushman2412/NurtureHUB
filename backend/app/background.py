"""The jobs that must run ONCE across a deployment, not once per process.

Each loop asks for a Redis lease (`manager.try_lead`) every cycle, so with many
processes exactly one does the work; without Redis there is only one process,
and it always leads. They run inside the web workers by default
(RUN_BACKGROUND_TASKS) and in the dedicated worker in Kubernetes
(`python -m app.worker`) — deploy/scale/ARCHITECTURE_300K.md §4.2.

The live-monitoring stale sweeper is deliberately NOT here: it reads the
heartbeats of the sockets its own process holds, so it has to run in every
process that holds sockets (app/main.py).
"""
from __future__ import annotations

import asyncio
from typing import Iterable, List

from app.attempt_finalizer import finalize_overdue_attempts
from app.config import settings
from app.database import SessionLocal
from app.security import anomaly
from app.security import audit as security_audit
from app.ws_manager import manager


async def security_sweeper() -> None:
    """Notarise the audit chains and run the detection rules on a timer.

    Two jobs on one loop, at different cadences:

    * **Anchoring.** A hash chain proves nothing was altered but cannot prove
      nothing was removed from its end. Periodically recording where each chain
      stood closes that gap (see security/audit.py:write_anchors).
    * **Detection.** The rules in security/anomaly.py look for the shapes misuse
      of a health record system takes. They run here rather than inline on the
      request path so a heavy query never slows down a field worker's device.

    Both statutory clocks that apply here start at *awareness*, which is what
    this loop is for. Set SECURITY_SWEEP_INTERVAL_SECONDS=0 to disable it.
    """
    interval = settings.SECURITY_SWEEP_INTERVAL_SECONDS
    if interval <= 0:
        print("[security] sweeper disabled (SECURITY_SWEEP_INTERVAL_SECONDS=0)")
        return
    last_anchor = 0.0
    while True:
        try:
            await asyncio.sleep(interval)
            # One runner across the deployment. With several workers each would
            # otherwise run the detections itself and raise every alert N times.
            # The lease outlives a cycle comfortably so a slow sweep keeps it.
            if not await manager.try_lead("security_sweeper", ttl_seconds=int(interval * 3) + 30):
                continue
            db = SessionLocal()
            try:
                anomaly.run_detections(db)
                now = asyncio.get_event_loop().time()
                if now - last_anchor >= settings.AUDIT_ANCHOR_INTERVAL_SECONDS:
                    security_audit.write_anchors(db)
                    last_anchor = now
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception as exc:  # never let the sweeper kill the loop
            print(f"[security_sweeper] error: {exc}")


async def attempt_finalizer() -> None:
    """Score attempts whose time ran out but whose browser never submitted.

    See app/attempt_finalizer.py for why this exists and why it is safe. Runs on
    ONE worker at a time; the scoring itself is off the event loop. Its admin
    updates go through Redis, so they reach monitors on every realtime pod.
    """
    while True:
        try:
            await asyncio.sleep(30)
            if not await manager.try_lead("attempt_finalizer", ttl_seconds=120):
                continue
            updates = await asyncio.to_thread(finalize_overdue_attempts)
            for test_id, state in updates:
                await manager.broadcast_to_admins(test_id, {"type": "CANDIDATE_UPDATE", "data": state})
        except asyncio.CancelledError:
            break
        except Exception as exc:  # never let the loop die
            print(f"[attempt_finalizer] error: {exc}")


async def care_sweeper() -> None:
    """Scheduled care reminders (app/care_alerts.py): every 15 minutes on one
    worker; does nothing unless CARE_REMINDERS_ENABLED and inside a window."""
    while True:
        try:
            await asyncio.sleep(900)
            if not settings.CARE_REMINDERS_ENABLED:
                continue
            if not await manager.try_lead("care_sweeper", ttl_seconds=1800):
                continue
            await asyncio.to_thread(_run_care_reminders)
        except asyncio.CancelledError:
            break
        except Exception as exc:  # never let the loop die
            print(f"[care_sweeper] error: {exc}")


def _run_care_reminders() -> None:
    from app.care_alerts import run_reminders

    db = SessionLocal()
    try:
        sent = run_reminders(db)
        if sent:
            print(f"[care_sweeper] sent {sent} reminder(s)")
    finally:
        db.close()


SINGLETON_JOBS = (security_sweeper, attempt_finalizer, care_sweeper)


def start_singleton_jobs() -> List[asyncio.Task]:
    """Start every leased job on the running loop."""
    return [asyncio.create_task(job(), name=job.__name__) for job in SINGLETON_JOBS]


async def stop_tasks(tasks: Iterable[asyncio.Task]) -> None:
    """Cancel the tasks and wait until each has finished unwinding."""
    tasks = list(tasks)
    for task in tasks:
        task.cancel()
    for task in tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass
