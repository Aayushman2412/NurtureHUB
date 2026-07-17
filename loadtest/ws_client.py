"""Candidate proctoring WebSocket client speaking the exact NurtureHUB protocol.

Protocol (backend/app/event_processor.py, frontend useTestEventEmitter.ts):
  client -> server: {"type": <TYPE>, "timestamp": ISO8601, "sequence": int, "payload": {...}}
  sequence must be strictly monotonically increasing per attempt or the
  server silently drops the event (event_processor.py:87).
  server -> client: ADMIN_WARNING | FORCE_SUBMIT.

Runs on gevent (locust monkey-patches sockets, so the blocking
websocket-client library cooperates).
"""
import json
import time
from datetime import datetime, timezone

import gevent
import websocket

from locust.env import Environment


class CandidateSocket:
    """One proctoring socket for one attempt. Reports open/send as locust requests."""

    def __init__(self, environment: Environment, ws_base: str, attempt_id: int, token: str):
        self.env = environment
        self.attempt_id = attempt_id
        self.url = f"{ws_base}/ws/candidate/{attempt_id}?token={token}"
        self.ws = None
        self.sequence = 0
        self.force_submit_requested = False
        self._listener = None
        self._heartbeat = None
        self.closed = False

    # -- lifecycle ----------------------------------------------------------
    def connect(self, heartbeat_interval: float | None = None) -> bool:
        start = time.perf_counter()
        try:
            self.ws = websocket.create_connection(self.url, timeout=30)
            self._fire("WS", "/ws/candidate [connect]", start, 0, None)
        except Exception as exc:  # noqa: BLE001 — report every failure kind
            self._fire("WS", "/ws/candidate [connect]", start, 0, exc)
            return False
        self._listener = gevent.spawn(self._listen)
        if heartbeat_interval:
            self._heartbeat = gevent.spawn(self._heartbeat_loop, heartbeat_interval)
        return True

    def close(self):
        self.closed = True
        for g in (self._heartbeat, self._listener):
            if g is not None:
                g.kill(block=False)
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:
                pass
            self.ws = None

    # -- protocol -------------------------------------------------------------
    def send_event(self, event_type: str, payload: dict | None = None) -> bool:
        if self.ws is None or self.closed:
            return False
        self.sequence += 1
        frame = json.dumps({
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sequence": self.sequence,
            "payload": payload or {},
        })
        start = time.perf_counter()
        try:
            self.ws.send(frame)
            self._fire("WS", f"/ws/candidate [{event_type}]", start, len(frame), None)
            return True
        except Exception as exc:  # noqa: BLE001
            self._fire("WS", f"/ws/candidate [{event_type}]", start, len(frame), exc)
            self.closed = True
            return False

    # -- internals -----------------------------------------------------------
    def _heartbeat_loop(self, interval: float):
        while not self.closed:
            gevent.sleep(interval)
            if not self.send_event("HEARTBEAT"):
                return

    def _listen(self):
        """Consume server pushes; honor FORCE_SUBMIT like the real client."""
        while not self.closed and self.ws is not None:
            try:
                raw = self.ws.recv()
            except Exception:
                return
            if not raw:
                return
            try:
                msg = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if msg.get("type") == "FORCE_SUBMIT":
                self.force_submit_requested = True

    def _fire(self, rtype: str, name: str, start: float, size: int, exc):
        self.env.events.request.fire(
            request_type=rtype,
            name=name,
            response_time=(time.perf_counter() - start) * 1000.0,
            response_length=size,
            exception=exc,
            context={},
        )
