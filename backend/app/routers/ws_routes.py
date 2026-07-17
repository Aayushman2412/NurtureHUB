"""
WebSocket routes for live test monitoring.

Two endpoints:
1. /ws/candidate/{attempt_id} — Candidate connects during test to stream events
2. /ws/admin/monitor/{test_id} — Admin subscribes to live candidate updates
"""

import json
import time
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import session_scope
from app.auth import decode_access_token
from app.models import User, Test, TestAttempt, Question
from app.models_live import LiveSession, ActivityEvent, SuspiciousFlag, AdminAction
from app.ws_manager import manager
from app.event_processor import (
    validate_event, process_event, build_candidate_state_from_session
)

router = APIRouter(tags=["websocket"])

# Monotonic timestamp of the last DB-persisted heartbeat per live session, so
# heartbeats persist at most once per WS_HEARTBEAT_PERSIST_SECONDS instead of on
# every 30s beat. Liveness itself is tracked in-memory by the manager (used by
# the stale sweeper), so throttling the DB write is invisible to detection.
_hb_persisted: dict[int, float] = {}


def authenticate_ws_token(token: str) -> dict | None:
    """Validate JWT token from WebSocket query parameter."""
    if not token:
        return None
    payload = decode_access_token(token)
    return payload


# ─────────────────────────────────────────
# Sync DB helpers (run in the threadpool)
#
# WebSocket handlers are `async def`, so FastAPI does NOT offload them to the
# threadpool the way it does sync REST handlers. Calling the blocking sync
# SQLAlchemy Session directly on the event loop freezes the single loop that
# owns every socket — under a connect storm (many candidates starting an exam
# at once) heartbeats back up and connections time out. These helpers do all
# the blocking DB work so the async handlers can `await run_in_threadpool(...)`
# them and keep the loop free.
# ─────────────────────────────────────────

class _WSClose(Exception):
    """Signals the handler should close the socket with a given code/reason."""
    def __init__(self, code: int, reason: str):
        self.code = code
        self.reason = reason


def _candidate_connect_setup(user_email, attempt_id, client_host, user_agent) -> dict:
    """Validate the attempt and upsert the LiveSession. Returns primitives only."""
    with session_scope() as db:
        user = db.query(User).filter(User.email == user_email).first()
        if not user:
            raise _WSClose(4004, "User not found")

        attempt = db.query(TestAttempt).filter(
            TestAttempt.id == attempt_id,
            TestAttempt.user_id == user.id,
        ).first()
        if not attempt:
            raise _WSClose(4004, "Attempt not found")
        if attempt.submitted_at:
            raise _WSClose(4005, "Attempt already submitted")

        test = db.query(Test).filter(Test.id == attempt.test_id).first()
        if not test:
            raise _WSClose(4004, "Test not found")

        questions = db.query(Question).options(
            joinedload(Question.options)
        ).filter(Question.test_id == test.id).all()
        # Plain {qid: correct_option_id} — survives across the per-event sessions.
        question_map = {
            q.id: next((o.id for o in q.options if o.is_correct), None)
            for q in questions
        }

        live_session = db.query(LiveSession).filter(
            LiveSession.attempt_id == attempt_id
        ).first()
        now = datetime.now(timezone.utc)
        if not live_session:
            live_session = LiveSession(
                attempt_id=attempt_id,
                user_id=user.id,
                test_id=test.id,
                status="active",
                connected_at=now,
                last_heartbeat=now,
                test_started_at=attempt.started_at,
                total_questions=len(questions),
                remaining_seconds=test.duration_minutes * 60,
                ip_address=client_host,
                user_agent=user_agent,
            )
            db.add(live_session)
            db.flush()
        else:
            live_session.status = "active"
            live_session.connected_at = now
            live_session.last_heartbeat = now
            live_session.disconnected_at = None
            if client_host:
                live_session.ip_address = client_host
        return {
            "session_id": live_session.id,
            "test_id": test.id,
            "question_map": question_map,
        }


def _candidate_state_for(session_id: int) -> dict | None:
    with session_scope() as db:
        ls = db.query(LiveSession).options(
            joinedload(LiveSession.user)
        ).filter(LiveSession.id == session_id).first()
        return build_candidate_state_from_session(ls) if ls else None


def _candidate_process_event(session_id: int, event_data: dict, question_map: dict):
    """Process one event; returns (found, updated_state)."""
    with session_scope() as db:
        ls = db.query(LiveSession).options(
            joinedload(LiveSession.user)
        ).filter(LiveSession.id == session_id).first()
        if not ls:
            return False, None
        return True, process_event(db, ls, event_data, question_map)


def _candidate_mark_disconnected(session_id: int) -> dict | None:
    with session_scope() as db:
        ls = db.query(LiveSession).options(
            joinedload(LiveSession.user)
        ).filter(LiveSession.id == session_id).first()
        if ls and ls.status not in ("submitted", "auto_submitted"):
            ls.status = "disconnected"
            ls.disconnected_at = datetime.now(timezone.utc)
            return build_candidate_state_from_session(ls)
        return None


# ─────────────────────────────────────────
# Candidate WebSocket
# ─────────────────────────────────────────

@router.websocket("/ws/candidate/{attempt_id}")
async def candidate_ws(websocket: WebSocket, attempt_id: int, token: str = Query("")):
    """
    WebSocket endpoint for test-taking candidates.

    The candidate connects when starting a test and streams events
    (question views, answer selections, tab switches, etc.) in real-time.

    Authentication via JWT token in query parameter.
    """
    # ── Authenticate ──
    payload = authenticate_ws_token(token)
    if not payload:
        await websocket.close(code=4003, reason="Invalid or missing token")
        return

    user_email = payload.get("sub")
    client_host = websocket.client.host if websocket.client else None
    user_agent = dict(websocket.headers).get("user-agent", "")

    # ── Validate + upsert LiveSession off the event loop (threadpool) ──
    # The DB work is synchronous and would otherwise block the single loop that
    # owns every socket; run_in_threadpool keeps the loop free during a
    # many-candidates-at-once connect storm.
    try:
        ctx = await run_in_threadpool(
            _candidate_connect_setup, user_email, attempt_id, client_host, user_agent
        )
    except _WSClose as c:
        await websocket.close(code=c.code, reason=c.reason)
        return
    except Exception as e:
        await websocket.close(code=4500, reason=f"Server error: {str(e)}")
        return

    session_id = ctx["session_id"]
    test_id = ctx["test_id"]
    question_map = ctx["question_map"]

    # ── Accept connection ──
    if not await manager.connect_candidate(websocket, attempt_id):
        # Client disconnected before we accepted; mark the just-created live
        # session disconnected and bail without noise.
        _hb_persisted.pop(session_id, None)
        try:
            await run_in_threadpool(_candidate_mark_disconnected, session_id)
        except Exception:
            pass
        return

    # ── Notify admins about new connection ──
    try:
        state = await run_in_threadpool(_candidate_state_for, session_id)
        if state is not None:
            await manager.broadcast_to_admins(test_id, {
                "type": "CANDIDATE_CONNECTED",
                "data": state,
            })
    except Exception:
        pass

    # ── Event loop ──
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                event_data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if not validate_event(event_data):
                continue

            # Heartbeats: always refresh in-memory liveness (cheap, keeps the
            # stale sweeper honest), but only touch the DB / broadcast to admins
            # at the throttled interval — a socket sitting idle no longer spends
            # a DB transaction every 30s.
            if event_data.get("type") == "HEARTBEAT":
                manager.update_heartbeat(attempt_id)
                now = time.monotonic()
                interval = settings.WS_HEARTBEAT_PERSIST_SECONDS
                if now - _hb_persisted.get(session_id, 0.0) < interval:
                    continue
                _hb_persisted[session_id] = now

            try:
                found, updated_state = await run_in_threadpool(
                    _candidate_process_event, session_id, event_data, question_map
                )
                if not found:
                    break
                manager.update_heartbeat(attempt_id)
                await manager.broadcast_to_admins(test_id, {
                    "type": "CANDIDATE_UPDATE",
                    "data": updated_state,
                })
            except Exception as e:
                print(f"[WS] Error processing event for attempt {attempt_id}: {e}")

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        # ── Handle disconnection ──
        await manager.disconnect_candidate(attempt_id)
        _hb_persisted.pop(session_id, None)
        try:
            state = await run_in_threadpool(_candidate_mark_disconnected, session_id)
            if state is not None:
                await manager.broadcast_to_admins(test_id, {
                    "type": "CANDIDATE_DISCONNECTED",
                    "data": state,
                })
        except Exception:
            pass


# ─────────────────────────────────────────
# Admin Monitor WebSocket
# ─────────────────────────────────────────

@router.websocket("/ws/admin/monitor/{test_id}")
async def admin_monitor_ws(websocket: WebSocket, test_id: int, token: str = Query("")):
    """
    WebSocket endpoint for admin live monitoring.

    On connection, sends a SNAPSHOT of all active LiveSessions for the test.
    Then receives incremental CANDIDATE_UPDATE messages as events arrive.
    Admin can also send actions (flag, warn, force-submit) via this socket.
    """
    # ── Authenticate admin ──
    payload = authenticate_ws_token(token)
    if not payload:
        await websocket.close(code=4003, reason="Invalid or missing token")
        return

    is_admin = payload.get("is_admin", False)
    admin_email = payload.get("sub", "")

    if not is_admin:
        await websocket.close(code=4003, reason="Admin access required")
        return

    # ── Validate test + build the initial snapshot off the event loop ──
    try:
        snapshot = await run_in_threadpool(_admin_snapshot, test_id)
    except _WSClose as c:
        await websocket.close(code=c.code, reason=c.reason)
        return
    except Exception:
        await websocket.close(code=4500, reason="Server error")
        return
    test_title = snapshot["test_title"]
    test_total_questions = snapshot["total_questions"]
    test_duration_minutes = snapshot["duration_minutes"]
    candidates = snapshot["candidates"]

    # ── Accept connection ──
    await manager.connect_admin(websocket, test_id, admin_email)

    # ── Send initial snapshot ──
    try:
        await websocket.send_json({
            "type": "SNAPSHOT",
            "data": {
                "candidates": candidates,
                "test_id": test_id,
                "test_title": test_title,
                "total_questions": test_total_questions,
                "duration_minutes": test_duration_minutes,
                "admin_count": manager.get_admin_count(test_id),
            }
        })
    except Exception as e:
        print(f"[WS Admin] Error sending snapshot: {e}")

    # ── Listen for admin actions ──
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                action_data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action_type = action_data.get("action")
            session_id = action_data.get("session_id")

            if not action_type or not session_id:
                continue

            try:
                # DB write off the loop; returns the updated state + which
                # candidate push (if any) the loop should then perform.
                outcome = await run_in_threadpool(
                    _admin_apply_action, session_id, action_type, action_data, admin_email
                )
                if outcome is None:
                    await websocket.send_json({"type": "ERROR", "message": "Session not found"})
                    continue

                push = outcome.get("candidate_push")
                if push:
                    await manager.send_to_candidate(outcome["attempt_id"], push)

                await manager.broadcast_to_admins(test_id, {
                    "type": "CANDIDATE_UPDATE",
                    "data": outcome["updated_state"],
                })
                await manager.broadcast_to_admins(test_id, {
                    "type": "ADMIN_ACTION_SYNC",
                    "data": {
                        "action_type": action_type,
                        "session_id": session_id,
                        "admin_email": admin_email,
                        "result": outcome["result"],
                    }
                })
                await websocket.send_json({
                    "type": "ACTION_CONFIRMED",
                    "data": outcome["result"],
                })

            except Exception as e:
                print(f"[WS Admin] Error processing action: {e}")
                await websocket.send_json({
                    "type": "ERROR",
                    "message": f"Failed to process action: {str(e)}"
                })

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await manager.disconnect_admin(websocket)


def _admin_snapshot(test_id: int) -> dict:
    """Load a test + all its live sessions for the initial admin SNAPSHOT."""
    with session_scope() as db:
        test = db.query(Test).filter(Test.id == test_id).first()
        if not test:
            raise _WSClose(4004, "Test not found")
        sessions = db.query(LiveSession).options(
            joinedload(LiveSession.user)
        ).filter(LiveSession.test_id == test_id).all()
        return {
            "test_title": test.title,
            "total_questions": test.total_questions,
            "duration_minutes": test.duration_minutes,
            "candidates": [build_candidate_state_from_session(s) for s in sessions],
        }


def _admin_apply_action(session_id, action_type, action_data, admin_email) -> dict | None:
    """Apply an admin action to a candidate session (DB write).

    Returns primitives so the async caller can perform the actual candidate
    push (ADMIN_WARNING / FORCE_SUBMIT) and admin broadcasts on the event loop.
    """
    notes = action_data.get("notes", "")
    with session_scope() as db:
        live_session = db.query(LiveSession).options(
            joinedload(LiveSession.user)
        ).filter(LiveSession.id == session_id).first()
        if not live_session:
            return None

        db.add(AdminAction(
            session_id=live_session.id,
            admin_email=admin_email,
            action_type=action_type.upper(),
            notes=notes,
        ))
        result = {"action": action_type, "session_id": live_session.id, "success": True}
        candidate_push = None

        if action_type == "FLAG":
            live_session.is_flagged = True
            live_session.flag_reason = notes or "Flagged by admin"
            result["message"] = "Candidate flagged"
        elif action_type == "UNFLAG":
            live_session.is_flagged = False
            live_session.flag_reason = None
            result["message"] = "Flag removed"
        elif action_type == "SEND_WARNING":
            candidate_push = {
                "type": "ADMIN_WARNING",
                "message": notes or "You have been warned by the administrator.",
            }
            result["message"] = "Warning sent to candidate"
        elif action_type == "FORCE_SUBMIT":
            live_session.status = "auto_submitted"
            candidate_push = {
                "type": "FORCE_SUBMIT",
                "message": "Your test has been submitted by the administrator.",
            }
            result["message"] = "Test force-submitted"
        elif action_type == "ADD_NOTE":
            result["message"] = "Note added"
        else:
            result["success"] = False
            result["message"] = f"Unknown action: {action_type}"

        return {
            "result": result,
            "updated_state": build_candidate_state_from_session(live_session),
            "candidate_push": candidate_push,
            "attempt_id": live_session.attempt_id,
        }
