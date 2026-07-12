"""
WebSocket routes for live test monitoring.

Two endpoints:
1. /ws/candidate/{attempt_id} — Candidate connects during test to stream events
2. /ws/admin/monitor/{test_id} — Admin subscribes to live candidate updates
"""

import json
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.orm import Session, joinedload

from app.database import SessionLocal
from app.auth import decode_access_token
from app.models import User, Test, TestAttempt, Question
from app.models_live import LiveSession, ActivityEvent, SuspiciousFlag, AdminAction
from app.ws_manager import manager
from app.event_processor import (
    validate_event, process_event, build_candidate_state_from_session
)

router = APIRouter(tags=["websocket"])


def get_db_session() -> Session:
    """Create a new DB session for WebSocket handlers (not request-scoped)."""
    db = SessionLocal()
    try:
        return db
    except Exception:
        db.close()
        raise


def authenticate_ws_token(token: str) -> dict | None:
    """Validate JWT token from WebSocket query parameter."""
    if not token:
        return None
    payload = decode_access_token(token)
    return payload


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

    # ── Validate attempt ──
    db = get_db_session()
    try:
        user = db.query(User).filter(User.email == user_email).first()
        if not user:
            await websocket.close(code=4004, reason="User not found")
            return

        attempt = db.query(TestAttempt).filter(
            TestAttempt.id == attempt_id,
            TestAttempt.user_id == user.id,
        ).first()

        if not attempt:
            await websocket.close(code=4004, reason="Attempt not found")
            return

        if attempt.submitted_at:
            await websocket.close(code=4005, reason="Attempt already submitted")
            return

        test = db.query(Test).filter(Test.id == attempt.test_id).first()
        if not test:
            await websocket.close(code=4004, reason="Test not found")
            return

        # ── Build question map for answer validation ──
        questions = db.query(Question).options(
            joinedload(Question.options)
        ).filter(Question.test_id == test.id).all()
        question_map = {q.id: q for q in questions}

        # ── Create or update LiveSession ──
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
                ip_address=websocket.client.host if websocket.client else None,
                user_agent=dict(websocket.headers).get("user-agent", ""),
            )
            db.add(live_session)
            db.commit()
            db.refresh(live_session)
        else:
            # Reconnection
            live_session.status = "active"
            live_session.connected_at = now
            live_session.last_heartbeat = now
            live_session.disconnected_at = None
            if websocket.client:
                live_session.ip_address = websocket.client.host
            db.commit()

        session_id = live_session.id

    except Exception as e:
        db.close()
        await websocket.close(code=4500, reason=f"Server error: {str(e)}")
        return

    # ── Accept connection ──
    await manager.connect_candidate(websocket, attempt_id)

    # ── Notify admins about new connection ──
    try:
        # Reload session with user relationship for state building
        live_session = db.query(LiveSession).options(
            joinedload(LiveSession.user)
        ).filter(LiveSession.id == session_id).first()

        state = build_candidate_state_from_session(live_session)
        await manager.broadcast_to_admins(test.id, {
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

            # Process the event
            try:
                # Reload session fresh for each event
                live_session = db.query(LiveSession).options(
                    joinedload(LiveSession.user)
                ).filter(LiveSession.id == session_id).first()

                if not live_session:
                    break

                updated_state = process_event(db, live_session, event_data, question_map)
                db.commit()

                # Update heartbeat in connection manager
                manager.update_heartbeat(attempt_id)

                # Broadcast to admins
                await manager.broadcast_to_admins(test.id, {
                    "type": "CANDIDATE_UPDATE",
                    "data": updated_state,
                })

            except Exception as e:
                db.rollback()
                print(f"[WS] Error processing event for attempt {attempt_id}: {e}")

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        # ── Handle disconnection ──
        await manager.disconnect_candidate(attempt_id)

        try:
            live_session = db.query(LiveSession).options(
                joinedload(LiveSession.user)
            ).filter(LiveSession.id == session_id).first()

            if live_session and live_session.status not in ("submitted", "auto_submitted"):
                live_session.status = "disconnected"
                live_session.disconnected_at = datetime.now(timezone.utc)
                db.commit()

                state = build_candidate_state_from_session(live_session)
                await manager.broadcast_to_admins(test.id, {
                    "type": "CANDIDATE_DISCONNECTED",
                    "data": state,
                })
        except Exception:
            pass
        finally:
            db.close()


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

    # ── Validate test exists ──
    db = get_db_session()
    try:
        test = db.query(Test).filter(Test.id == test_id).first()
        if not test:
            await websocket.close(code=4004, reason="Test not found")
            db.close()
            return
    except Exception:
        db.close()
        await websocket.close(code=4500, reason="Server error")
        return

    # ── Accept connection ──
    await manager.connect_admin(websocket, test_id, admin_email)

    # ── Send initial snapshot ──
    try:
        sessions = db.query(LiveSession).options(
            joinedload(LiveSession.user)
        ).filter(LiveSession.test_id == test_id).all()

        candidates = [build_candidate_state_from_session(s) for s in sessions]

        await websocket.send_json({
            "type": "SNAPSHOT",
            "data": {
                "candidates": candidates,
                "test_id": test_id,
                "test_title": test.title,
                "total_questions": test.total_questions,
                "duration_minutes": test.duration_minutes,
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
                live_session = db.query(LiveSession).options(
                    joinedload(LiveSession.user)
                ).filter(LiveSession.id == session_id).first()

                if not live_session:
                    await websocket.send_json({"type": "ERROR", "message": "Session not found"})
                    continue

                # Process admin action
                result = await _handle_admin_action(
                    db, live_session, action_type, action_data, admin_email
                )

                db.commit()

                # Broadcast updated state to all admins
                updated_state = build_candidate_state_from_session(live_session)
                await manager.broadcast_to_admins(test_id, {
                    "type": "CANDIDATE_UPDATE",
                    "data": updated_state,
                })

                # Also broadcast the admin action for audit sync
                await manager.broadcast_to_admins(test_id, {
                    "type": "ADMIN_ACTION_SYNC",
                    "data": {
                        "action_type": action_type,
                        "session_id": session_id,
                        "admin_email": admin_email,
                        "result": result,
                    }
                })

                # Send confirmation to the acting admin
                await websocket.send_json({
                    "type": "ACTION_CONFIRMED",
                    "data": result,
                })

            except Exception as e:
                db.rollback()
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
        db.close()


async def _handle_admin_action(
    db: Session,
    live_session: LiveSession,
    action_type: str,
    action_data: dict,
    admin_email: str,
) -> dict:
    """Process an admin action on a candidate session."""

    notes = action_data.get("notes", "")

    # Record the action
    admin_action = AdminAction(
        session_id=live_session.id,
        admin_email=admin_email,
        action_type=action_type.upper(),
        notes=notes,
    )
    db.add(admin_action)

    result = {"action": action_type, "session_id": live_session.id, "success": True}

    if action_type == "FLAG":
        live_session.is_flagged = True
        live_session.flag_reason = notes or "Flagged by admin"
        result["message"] = "Candidate flagged"

    elif action_type == "UNFLAG":
        live_session.is_flagged = False
        live_session.flag_reason = None
        result["message"] = "Flag removed"

    elif action_type == "SEND_WARNING":
        # Send warning to the candidate via their WebSocket
        attempt_id = live_session.attempt_id
        await manager.send_to_candidate(attempt_id, {
            "type": "ADMIN_WARNING",
            "message": notes or "You have been warned by the administrator.",
        })
        result["message"] = "Warning sent to candidate"

    elif action_type == "FORCE_SUBMIT":
        live_session.status = "auto_submitted"
        # Send force-submit command to candidate
        attempt_id = live_session.attempt_id
        await manager.send_to_candidate(attempt_id, {
            "type": "FORCE_SUBMIT",
            "message": "Your test has been submitted by the administrator.",
        })
        result["message"] = "Test force-submitted"

    elif action_type == "ADD_NOTE":
        result["message"] = "Note added"

    else:
        result["success"] = False
        result["message"] = f"Unknown action: {action_type}"

    return result
