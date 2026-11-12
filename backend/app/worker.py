"""`python -m app.worker` — the leased background jobs, without a web server.

In Kubernetes the serving pods run with RUN_BACKGROUND_TASKS=false and this
process runs the jobs instead (the chart's `worker` role), so scaling the web
tier never multiplies them and a slow detection sweep never shares a CPU with
field traffic. Two replicas are safe — the Redis leases pick one — and with
REDIS_URL unset there must be exactly one.
"""
from __future__ import annotations

import asyncio
import os
import signal
import tempfile
import time

from app import background, bootstrap
from app.config import settings
from app.security import audit as security_audit
from app.security.redaction import install_log_redaction
from app.ws_manager import manager

# The jobs log their errors and carry on, so this process never exits on its
# own — a stale heartbeat is what a wedged event loop looks like from outside.
# Written from the same loop as the jobs; the chart's liveness probe reads it.
HEARTBEAT_FILE = os.path.join(tempfile.gettempdir(), "eduposhan-worker.heartbeat")
HEARTBEAT_SECONDS = 20


def _beat() -> None:
    try:
        with open(HEARTBEAT_FILE, "w", encoding="ascii") as fh:
            fh.write(str(int(time.time())))
    except OSError as exc:
        print(f"[worker] heartbeat not written: {exc}")


async def _heartbeat() -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        _beat()


async def run(stop: asyncio.Event) -> None:
    """Run every leased job until `stop` is set, then unwind cleanly."""
    settings.validate_production()
    install_log_redaction()
    # The serving pods' rule: code newer than the schema must not run its jobs
    # against columns that do not exist yet.
    bootstrap.prepare_database()
    security_audit.start_writer()
    try:
        await manager.start()
        tasks = background.start_singleton_jobs()
        _beat()
        tasks.append(asyncio.create_task(_heartbeat(), name="worker_heartbeat"))
        print(f"[worker] running {len(tasks) - 1} leased job(s) as {manager.worker_id}")
        try:
            await stop.wait()
        finally:
            await background.stop_tasks(tasks)
            await manager.stop()
    finally:
        # Anything still queued goes to the spool and is re-ingested on the
        # next boot, exactly as in the web workers.
        security_audit.stop_writer()


async def _main() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError, ValueError):
            pass  # Windows has no loop signal handlers; Ctrl+C still interrupts
    await run(stop)


def main() -> None:
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
