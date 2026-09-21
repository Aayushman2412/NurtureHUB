"""
WebSocket connection manager for live test monitoring.

Two pools of sockets live here:
  * candidate sockets — people writing a test, streaming events;
  * admin sockets     — people watching a test's live monitor.

Single worker vs. many
======================
A socket belongs to exactly one process. With one backend worker that is the
whole story, and this module behaves exactly as it always has.

With several workers (needed to carry thousands of candidates), a candidate on
worker A and an admin on worker B would never meet: A's update would be
delivered to A's admins only. So when REDIS_URL is set, every cross-socket
message goes through Redis pub/sub instead:

  * broadcast_to_admins  -> published; every worker relays it to ITS admins;
  * send_to_candidate    -> published; the worker holding that socket delivers;
  * a reconnect          -> published; whichever worker held the OLD socket
                            closes it, so a candidate is never live twice.

Unset REDIS_URL and all of that collapses back to in-process delivery.

Batching for admins
===================
At thousands of candidates, per-event delivery would push hundreds of messages
a second at every admin, each forcing a re-render of the whole grid — enough to
freeze the browser. Candidate-state messages are therefore coalesced per
(test, candidate) and flushed as one CANDIDATE_BATCH every
WS_ADMIN_BATCH_SECONDS; the latest state for each candidate wins. Everything
else (action confirmations, syncs) is sent immediately.

Reconnect ownership
===================
Each candidate connection gets a connection id. Only the connection that is
still the CURRENT one for its attempt may deregister it or mark the candidate
disconnected. Without that, a phone that drops and reconnects has its old
socket's cleanup run after the new one registered — wiping the new socket (so
warnings and force-submits stop reaching it) and flipping the card to
"disconnected" while the candidate is in fact writing.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from collections import defaultdict
from typing import Any, Dict, Optional, Set

from fastapi import WebSocket

from app.config import settings

# Candidate-state message types that are safe to coalesce: each carries the
# candidate's full current state, so a later one fully supersedes an earlier.
_COALESCE = {"CANDIDATE_UPDATE", "CANDIDATE_CONNECTED", "CANDIDATE_DISCONNECTED"}

_CH_ADMIN = "nh:ws:admin"       # {test_id, data}
_CH_CAND = "nh:ws:cand"         # {attempt_id, data}
_CH_EVICT = "nh:ws:evict"       # {attempt_id, conn_id, worker}
_KEY_CONN = "nh:ws:conn:{}"     # attempt_id -> current conn_id
_KEY_ADMINS = "nh:ws:admins:{}"  # test_id -> number of admins watching

# Compare-and-delete: remove the key only if it still holds OUR connection id.
# Returns 1 when we were the current connection (and it is now cleared).
_CAS_DELETE = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('del', KEYS[1])
  return 1
end
return 0
"""


class ConnectionManager:
    def __init__(self):
        # Local sockets.
        self.candidate_connections: Dict[int, WebSocket] = {}
        self._candidate_conn_ids: Dict[int, str] = {}      # attempt -> conn id of the local socket
        self.admin_connections: Dict[int, Set[WebSocket]] = defaultdict(set)
        self.admin_ws_info: Dict[WebSocket, tuple] = {}

        # Liveness of the candidates whose sockets THIS worker holds.
        self.heartbeat_tracker: Dict[int, float] = {}

        # Without Redis, "which connection is current" is tracked here.
        self._current_conn: Dict[int, str] = {}

        # Pending coalesced admin updates: test_id -> {session_id: message}
        self._pending: Dict[int, Dict[Any, dict]] = defaultdict(dict)

        self.worker_id = f"{os.getpid()}-{uuid.uuid4().hex[:6]}"
        self._redis = None
        self._tasks: list = []
        self._lock = asyncio.Lock()

    # ─────────────────────────────────────────
    # Lifecycle
    # ─────────────────────────────────────────

    @property
    def shared(self) -> bool:
        return self._redis is not None

    async def start(self):
        """Connect to Redis (if configured) and start the background loops."""
        if settings.REDIS_URL:
            import redis.asyncio as aioredis

            self._redis = aioredis.from_url(
                settings.REDIS_URL, decode_responses=True,
                health_check_interval=30, socket_keepalive=True,
            )
            await self._redis.ping()
            self._tasks.append(asyncio.create_task(self._subscriber()))
            print(f"[ws] live monitoring shared through Redis (worker {self.worker_id})")
        self._tasks.append(asyncio.create_task(self._flush_loop()))

    async def stop(self):
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks = []
        if self._redis is not None:
            try:
                await self._redis.aclose()
            except Exception:
                pass
            self._redis = None

    async def _publish(self, channel: str, payload: dict) -> bool:
        """Publish; False if Redis is unavailable so the caller can fall back."""
        if self._redis is None:
            return False
        try:
            await self._redis.publish(channel, json.dumps(payload, default=str))
            return True
        except Exception as exc:  # never let the bus take a candidate down
            print(f"[ws] redis publish failed ({channel}): {exc}")
            return False

    async def _subscriber(self):
        """Relay messages published by any worker to the sockets held here.

        Reconnects with backoff: a Redis blip must not end live monitoring for
        the rest of the test.
        """
        backoff = 1.0
        while True:
            pubsub = None
            try:
                pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
                await pubsub.subscribe(_CH_ADMIN, _CH_CAND, _CH_EVICT)
                backoff = 1.0
                async for msg in pubsub.listen():
                    if msg.get("type") != "message":
                        continue
                    try:
                        body = json.loads(msg["data"])
                    except (TypeError, ValueError):
                        continue
                    channel = msg.get("channel")
                    if channel == _CH_ADMIN:
                        self._deliver_admin(int(body["test_id"]), body["data"])
                    elif channel == _CH_CAND:
                        await self._deliver_candidate(int(body["attempt_id"]), body["data"])
                    elif channel == _CH_EVICT:
                        await self._evict_if_stale(int(body["attempt_id"]), body.get("conn_id"),
                                                   body.get("worker"))
            except asyncio.CancelledError:
                break
            except Exception as exc:
                print(f"[ws] redis subscriber error, retrying in {backoff:.0f}s: {exc}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
            finally:
                if pubsub is not None:
                    try:
                        await pubsub.aclose()
                    except Exception:
                        pass

    # ─────────────────────────────────────────
    # Candidates
    # ─────────────────────────────────────────

    async def connect_candidate(self, websocket: WebSocket, attempt_id: int) -> Optional[str]:
        """Accept a candidate socket and make it the CURRENT one for the attempt.

        Returns the connection id, or None if the client vanished before accept
        (a benign race under reconnect churn).
        """
        try:
            await websocket.accept()
        except Exception:
            return None
        conn_id = uuid.uuid4().hex
        old = None
        async with self._lock:
            if attempt_id in self.candidate_connections:
                old = self.candidate_connections[attempt_id]
            self.candidate_connections[attempt_id] = websocket
            self._candidate_conn_ids[attempt_id] = conn_id
            self.heartbeat_tracker[attempt_id] = time.time()
            self._current_conn[attempt_id] = conn_id
        if old is not None:
            try:
                await old.close(code=4001, reason="Replaced by new connection")
            except Exception:
                pass
        if self._redis is not None:
            try:
                await self._redis.set(_KEY_CONN.format(attempt_id), conn_id, ex=12 * 3600)
            except Exception as exc:
                print(f"[ws] redis set conn failed: {exc}")
            # A stale socket for this attempt on ANOTHER worker must go.
            await self._publish(_CH_EVICT, {"attempt_id": attempt_id, "conn_id": conn_id,
                                            "worker": self.worker_id})
        return conn_id

    async def disconnect_candidate(self, attempt_id: int, conn_id: Optional[str] = None) -> bool:
        """Deregister a candidate socket.

        Returns True only if `conn_id` was still the CURRENT connection for the
        attempt — i.e. the candidate really is gone, rather than reconnected
        somewhere else. Callers mark the card disconnected only in that case.
        """
        async with self._lock:
            if conn_id is None or self._candidate_conn_ids.get(attempt_id) == conn_id:
                self.candidate_connections.pop(attempt_id, None)
                self._candidate_conn_ids.pop(attempt_id, None)
                self.heartbeat_tracker.pop(attempt_id, None)
            if conn_id is None:
                self._current_conn.pop(attempt_id, None)
                return True
            local_current = self._current_conn.get(attempt_id) == conn_id
            if local_current:
                self._current_conn.pop(attempt_id, None)
        if self._redis is not None:
            try:
                return bool(await self._redis.eval(_CAS_DELETE, 1, _KEY_CONN.format(attempt_id), conn_id))
            except Exception as exc:
                print(f"[ws] redis CAS delete failed: {exc}")
                return local_current
        return local_current

    async def _evict_if_stale(self, attempt_id: int, conn_id: Optional[str], worker: Optional[str]):
        """Another worker now holds this candidate: close our old socket."""
        if worker == self.worker_id:
            return
        async with self._lock:
            ws = self.candidate_connections.get(attempt_id)
            if ws is None or self._candidate_conn_ids.get(attempt_id) == conn_id:
                return
            self.candidate_connections.pop(attempt_id, None)
            self._candidate_conn_ids.pop(attempt_id, None)
            self.heartbeat_tracker.pop(attempt_id, None)
        try:
            await ws.close(code=4001, reason="Replaced by new connection")
        except Exception:
            pass

    def update_heartbeat(self, attempt_id: int):
        self.heartbeat_tracker[attempt_id] = time.time()

    def is_candidate_connected(self, attempt_id: int) -> bool:
        """True if THIS worker holds a socket for the attempt."""
        return attempt_id in self.candidate_connections

    async def send_to_candidate(self, attempt_id: int, data: dict):
        """Push to a candidate (warning, force-submit) wherever their socket is."""
        if attempt_id in self.candidate_connections:
            await self._deliver_candidate(attempt_id, data)
            return
        if not await self._publish(_CH_CAND, {"attempt_id": attempt_id, "data": data}):
            await self._deliver_candidate(attempt_id, data)

    async def _deliver_candidate(self, attempt_id: int, data: dict):
        ws = self.candidate_connections.get(attempt_id)
        if ws is None:
            return
        try:
            await ws.send_json(data)
        except Exception:
            await self.disconnect_candidate(attempt_id, self._candidate_conn_ids.get(attempt_id))

    # ─────────────────────────────────────────
    # Admins
    # ─────────────────────────────────────────

    async def connect_admin(self, websocket: WebSocket, test_id: int, admin_email: str):
        await websocket.accept()
        async with self._lock:
            self.admin_connections[test_id].add(websocket)
            self.admin_ws_info[websocket] = (test_id, admin_email)
        if self._redis is not None:
            try:
                await self._redis.incr(_KEY_ADMINS.format(test_id))
            except Exception:
                pass

    async def disconnect_admin(self, websocket: WebSocket):
        async with self._lock:
            info = self.admin_ws_info.pop(websocket, None)
            if not info:
                return
            test_id, _ = info
            self.admin_connections[test_id].discard(websocket)
            if not self.admin_connections[test_id]:
                del self.admin_connections[test_id]
                self._pending.pop(test_id, None)
        if self._redis is not None:
            try:
                n = await self._redis.decr(_KEY_ADMINS.format(test_id))
                if n <= 0:
                    await self._redis.delete(_KEY_ADMINS.format(test_id))
            except Exception:
                pass

    async def broadcast_to_admins(self, test_id: int, data: dict):
        """Send to every admin watching the test, on every worker."""
        if not await self._publish(_CH_ADMIN, {"test_id": test_id, "data": data}):
            self._deliver_admin(test_id, data)

    def _deliver_admin(self, test_id: int, data: dict):
        """Queue for this worker's admins: candidate states are coalesced into
        the next batch; anything else is sent straight away."""
        if test_id not in self.admin_connections:
            return
        payload = data.get("data") if isinstance(data, dict) else None
        if data.get("type") in _COALESCE and isinstance(payload, dict) and "session_id" in payload:
            state = dict(payload)
            if data["type"] == "CANDIDATE_DISCONNECTED":
                state["status"] = "disconnected"
            self._pending[test_id][payload["session_id"]] = state
            return
        asyncio.create_task(self._send_admins(test_id, data))

    async def _send_admins(self, test_id: int, data: dict):
        dead = []
        for ws in list(self.admin_connections.get(test_id, set())):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect_admin(ws)

    async def _flush_loop(self):
        interval = max(0.2, float(settings.WS_ADMIN_BATCH_SECONDS))
        while True:
            try:
                await asyncio.sleep(interval)
                if not self._pending:
                    continue
                batches, self._pending = self._pending, defaultdict(dict)
                for test_id, states in batches.items():
                    if states and test_id in self.admin_connections:
                        await self._send_admins(test_id, {
                            "type": "CANDIDATE_BATCH",
                            "data": list(states.values()),
                        })
            except asyncio.CancelledError:
                break
            except Exception as exc:
                print(f"[ws] admin flush error: {exc}")

    async def get_admin_count(self, test_id: int) -> int:
        """Admins watching this test, across every worker."""
        if self._redis is not None:
            try:
                value = await self._redis.get(_KEY_ADMINS.format(test_id))
                return max(int(value or 0), len(self.admin_connections.get(test_id, set())))
            except Exception:
                pass
        return len(self.admin_connections.get(test_id, set()))

    # ─────────────────────────────────────────
    # Single-runner jobs
    # ─────────────────────────────────────────

    async def try_lead(self, name: str, ttl_seconds: int) -> bool:
        """True if this worker should run the job `name` this cycle.

        Some background jobs must run ONCE across the whole deployment, not once
        per worker — the security sweeper would otherwise raise every alert N
        times. With Redis, one worker holds a short lease it keeps renewing;
        without Redis there is only one worker, which always leads.
        """
        if self._redis is None:
            return True
        key = f"nh:lead:{name}"
        try:
            if await self._redis.set(key, self.worker_id, nx=True, ex=ttl_seconds):
                return True
            if await self._redis.get(key) == self.worker_id:
                await self._redis.expire(key, ttl_seconds)
                return True
            return False
        except Exception as exc:
            print(f"[ws] leader check failed for {name}: {exc}")
            return False

    # ─────────────────────────────────────────
    # Heartbeat monitoring / stats
    # ─────────────────────────────────────────

    def get_stale_candidates(self, timeout_seconds: int = 90) -> list:
        """Candidates on THIS worker with no heartbeat within the window."""
        now = time.time()
        return [a for a, last in self.heartbeat_tracker.items() if now - last > timeout_seconds]

    def get_stats(self) -> dict:
        return {
            "total_candidates": len(self.candidate_connections),
            "total_admin_monitors": sum(len(s) for s in self.admin_connections.values()),
            "tests_being_monitored": len(self.admin_connections),
            "shared_via_redis": self.shared,
            "worker": self.worker_id,
        }


# Global singleton instance (one per worker process)
manager = ConnectionManager()
