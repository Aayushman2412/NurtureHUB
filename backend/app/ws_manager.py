"""
WebSocket connection manager for live test monitoring.

Manages two pools of WebSocket connections:
1. Candidate connections — test takers sending real-time events
2. Admin connections — admins subscribing to live monitoring feeds

Provides broadcast, heartbeat tracking, and graceful disconnect handling.
"""

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Dict, Set, Optional, Any
from fastapi import WebSocket
from collections import defaultdict


class ConnectionManager:
    """
    Singleton connection manager for all WebSocket connections.

    Architecture:
    - candidate_connections: {attempt_id: WebSocket}  — one connection per active attempt
    - admin_connections: {test_id: set(WebSocket)}   — multiple admins can monitor same test
    - heartbeat_tracker: {attempt_id: last_heartbeat_timestamp}
    """

    def __init__(self):
        # Candidate connections keyed by attempt_id
        self.candidate_connections: Dict[int, WebSocket] = {}

        # Admin connections keyed by test_id (multiple admins per test)
        self.admin_connections: Dict[int, Set[WebSocket]] = defaultdict(set)

        # Reverse lookup: WebSocket -> (test_id, admin_email) for admin cleanup
        self.admin_ws_info: Dict[WebSocket, tuple] = {}

        # Heartbeat tracking
        self.heartbeat_tracker: Dict[int, float] = {}

        # Lock for thread-safe modifications
        self._lock = asyncio.Lock()

    # ─────────────────────────────────────────
    # Candidate Connection Management
    # ─────────────────────────────────────────

    async def connect_candidate(self, websocket: WebSocket, attempt_id: int):
        """Accept and register a candidate WebSocket connection."""
        await websocket.accept()
        async with self._lock:
            # Close existing connection for same attempt (reconnect scenario)
            if attempt_id in self.candidate_connections:
                try:
                    old_ws = self.candidate_connections[attempt_id]
                    await old_ws.close(code=4001, reason="Replaced by new connection")
                except Exception:
                    pass
            self.candidate_connections[attempt_id] = websocket
            self.heartbeat_tracker[attempt_id] = time.time()

    async def disconnect_candidate(self, attempt_id: int):
        """Remove a candidate connection."""
        async with self._lock:
            self.candidate_connections.pop(attempt_id, None)
            self.heartbeat_tracker.pop(attempt_id, None)

    def update_heartbeat(self, attempt_id: int):
        """Update the last heartbeat timestamp for a candidate."""
        self.heartbeat_tracker[attempt_id] = time.time()

    def is_candidate_connected(self, attempt_id: int) -> bool:
        """Check if a candidate is currently connected."""
        return attempt_id in self.candidate_connections

    async def send_to_candidate(self, attempt_id: int, data: dict):
        """Send a message to a specific candidate (e.g., warnings)."""
        ws = self.candidate_connections.get(attempt_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                await self.disconnect_candidate(attempt_id)

    # ─────────────────────────────────────────
    # Admin Connection Management
    # ─────────────────────────────────────────

    async def connect_admin(self, websocket: WebSocket, test_id: int, admin_email: str):
        """Accept and register an admin WebSocket connection for a test."""
        await websocket.accept()
        async with self._lock:
            self.admin_connections[test_id].add(websocket)
            self.admin_ws_info[websocket] = (test_id, admin_email)

    async def disconnect_admin(self, websocket: WebSocket):
        """Remove an admin connection."""
        async with self._lock:
            info = self.admin_ws_info.pop(websocket, None)
            if info:
                test_id, _ = info
                self.admin_connections[test_id].discard(websocket)
                # Clean up empty sets
                if not self.admin_connections[test_id]:
                    del self.admin_connections[test_id]

    async def broadcast_to_admins(self, test_id: int, data: dict):
        """
        Broadcast an update to ALL admin connections monitoring a specific test.
        Failed sends result in disconnection of that admin socket.
        """
        dead_connections = []
        admin_sockets = list(self.admin_connections.get(test_id, set()))

        for ws in admin_sockets:
            try:
                await ws.send_json(data)
            except Exception:
                dead_connections.append(ws)

        # Clean up dead connections
        for ws in dead_connections:
            await self.disconnect_admin(ws)

    def get_admin_count(self, test_id: int) -> int:
        """Get the number of admins monitoring a test."""
        return len(self.admin_connections.get(test_id, set()))

    # ─────────────────────────────────────────
    # Heartbeat Monitoring
    # ─────────────────────────────────────────

    def get_stale_candidates(self, timeout_seconds: int = 90) -> list:
        """
        Find candidate connections that haven't sent a heartbeat
        within the timeout window. Returns list of attempt_ids.
        """
        now = time.time()
        stale = []
        for attempt_id, last_hb in self.heartbeat_tracker.items():
            if now - last_hb > timeout_seconds:
                stale.append(attempt_id)
        return stale

    # ─────────────────────────────────────────
    # Stats
    # ─────────────────────────────────────────

    def get_stats(self) -> dict:
        """Return current connection statistics."""
        return {
            "total_candidates": len(self.candidate_connections),
            "total_admin_monitors": sum(len(s) for s in self.admin_connections.values()),
            "tests_being_monitored": len(self.admin_connections),
        }


# Global singleton instance
manager = ConnectionManager()
