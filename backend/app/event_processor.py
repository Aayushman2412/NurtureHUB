"""
Event processor for live test monitoring.

Processes incoming candidate events, updates LiveSession state,
persists ActivityEvents, and runs suspicious activity detection rules.
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session

from app.models_live import LiveSession, ActivityEvent, SuspiciousFlag
from app.models import Question


# ─────────────────────────────────────────
# Valid event types
# ─────────────────────────────────────────

VALID_EVENT_TYPES = {
    "QUESTION_VIEWED",
    "ANSWER_SELECTED",
    "ANSWER_CHANGED",
    "ANSWER_CLEARED",
    "ANSWER_MARKED_REVIEW",
    "TEST_SUBMITTED",
    "TEST_AUTO_SUBMITTED",
    "TAB_SWITCH",
    "FULLSCREEN_EXIT",
    "WINDOW_BLUR",
    "WINDOW_FOCUS",
    "HEARTBEAT",
    "COPY_PASTE_DETECTED",
}


def validate_event(event_data: dict) -> bool:
    """Validate incoming event structure."""
    required = {"type", "timestamp", "sequence"}
    if not required.issubset(event_data.keys()):
        return False
    if event_data.get("type") not in VALID_EVENT_TYPES:
        return False
    if not isinstance(event_data.get("sequence"), (int, float)):
        return False
    return True


def _normalize_dt_to_naive_utc(dt: datetime) -> datetime:
    """Normalize a datetime to timezone-naive UTC for type-safe arithmetic."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def process_event(
    db: Session,
    live_session: LiveSession,
    event_data: dict,
    question_map: Optional[Dict[int, Any]] = None,
) -> dict:
    """
    Process a single candidate event.

    1. Validates the event
    2. Checks for duplicate (sequence number)
    3. Updates LiveSession denormalized state
    4. Persists ActivityEvent
    5. Runs suspicious activity rules
    6. Returns the updated candidate state for admin broadcast

    Args:
        db: SQLAlchemy session
        live_session: The candidate's LiveSession record
        event_data: Parsed event from the WebSocket
        question_map: Optional dict of {question_id: correct_option_id} for answer
            validation. Plain scalars (not ORM objects) so it stays valid across
            the short-lived per-event sessions the WS handler uses.

    Returns:
        dict: Updated candidate state for admin broadcast
    """
    event_type = event_data["type"]
    sequence = int(event_data["sequence"])
    payload = event_data.get("payload", {})
    question_id = payload.get("question_id")

    # ── Idempotency check ──
    if sequence <= (live_session.last_sequence or 0):
        # Already processed this event, skip
        return _build_candidate_state(live_session)

    # ── Persist the event ──
    activity_event = ActivityEvent(
        session_id=live_session.id,
        event_type=event_type,
        sequence_number=sequence,
        question_id=question_id,
        payload=payload,
    )
    db.add(activity_event)

    # ── Update sequence ──
    live_session.last_sequence = sequence
    now = datetime.now(timezone.utc)
    live_session.updated_at = now

    # ── Process based on event type ──

    if event_type == "HEARTBEAT":
        live_session.last_heartbeat = now
        # Check for idle -> active transition
        if live_session.status == "idle":
            live_session.status = "active"

    elif event_type == "QUESTION_VIEWED":
        _handle_question_viewed(live_session, payload)

    elif event_type in ("ANSWER_SELECTED", "ANSWER_CHANGED"):
        _handle_answer_selected(db, live_session, payload, question_map)

    elif event_type == "ANSWER_CLEARED":
        _handle_answer_cleared(live_session, payload, question_map)

    elif event_type == "ANSWER_MARKED_REVIEW":
        pass  # No progress state change needed

    elif event_type in ("TEST_SUBMITTED", "TEST_AUTO_SUBMITTED"):
        live_session.status = "submitted" if event_type == "TEST_SUBMITTED" else "auto_submitted"

    elif event_type == "TAB_SWITCH":
        live_session.tab_switch_count = (live_session.tab_switch_count or 0) + 1

    elif event_type == "FULLSCREEN_EXIT":
        live_session.fullscreen_exit_count = (live_session.fullscreen_exit_count or 0) + 1

    elif event_type == "WINDOW_BLUR":
        live_session.window_blur_count = (live_session.window_blur_count or 0) + 1

    elif event_type == "WINDOW_FOCUS":
        # Transitioning from idle/blur back to active
        if live_session.status in ("idle", "disconnected"):
            live_session.status = "active"

    elif event_type == "COPY_PASTE_DETECTED":
        live_session.copy_paste_count = (live_session.copy_paste_count or 0) + 1

    # ── Update time tracking ──
    if live_session.test_started_at:
        started_at = _normalize_dt_to_naive_utc(live_session.test_started_at)
        now_naive = _normalize_dt_to_naive_utc(now)
        elapsed = (now_naive - started_at).total_seconds()
        live_session.time_spent_seconds = int(elapsed)

    # ── Run suspicious activity rules ──
    _run_detection_rules(db, live_session, event_type, payload)

    # ── Compute remaining time ──
    if live_session.test_started_at and live_session.remaining_seconds is not None:
        # remaining_seconds is set initially; we update based on elapsed time
        pass  # Computed on the fly in _build_candidate_state

    return _build_candidate_state(live_session)


def _handle_question_viewed(live_session: LiveSession, payload: dict):
    """Update state when a candidate views a question."""
    question_id = payload.get("question_id")
    question_number = payload.get("question_number", 1)

    live_session.current_question = question_number
    live_session.question_switch_count = (live_session.question_switch_count or 0) + 1

    if live_session.status == "not_started":
        live_session.status = "active"

    # Update navigation pattern
    nav = live_session.navigation_pattern or []
    nav.append(question_id)
    # Keep last 500 entries to prevent unbounded growth
    live_session.navigation_pattern = nav[-500:]

    # Track viewed questions count
    answer_state = live_session.answer_state or {}
    if str(question_id) not in answer_state:
        answer_state[str(question_id)] = {"viewed": True, "selected_option_id": None, "is_correct": None, "time_ms": 0}
        live_session.answer_state = answer_state

    _recompute_question_counts(live_session)


def _handle_answer_selected(
    db: Session,
    live_session: LiveSession,
    payload: dict,
    question_map: Optional[Dict[int, Any]] = None,
):
    """Update state when a candidate selects/changes an answer."""
    question_id = payload.get("question_id")
    selected_option_id = payload.get("selected_option_id")
    time_on_question_ms = payload.get("time_on_question_ms", 0)

    answer_state = live_session.answer_state or {}
    q_key = str(question_id)

    # Check correctness if we have the question map. question_map is
    # {question_id: correct_option_id} — plain scalars, so it stays valid
    # across the short-lived per-event DB sessions the WS handler opens.
    is_correct = None
    if question_map and question_id in question_map:
        correct_option_id = question_map[question_id]
        if correct_option_id is not None:
            is_correct = (selected_option_id == correct_option_id)

    answer_state[q_key] = {
        "viewed": True,
        "selected_option_id": selected_option_id,
        "is_correct": is_correct,
        "time_ms": time_on_question_ms,
    }
    live_session.answer_state = answer_state

    live_session.status = "active"
    _recompute_question_counts(live_session)
    _recompute_time_stats(live_session)


def _handle_answer_cleared(
    live_session: LiveSession,
    payload: dict,
    question_map: Optional[Dict[int, Any]] = None,
):
    """Update state when a candidate clears an answer."""
    question_id = payload.get("question_id")
    answer_state = live_session.answer_state or {}
    q_key = str(question_id)

    if q_key in answer_state:
        answer_state[q_key]["selected_option_id"] = None
        answer_state[q_key]["is_correct"] = None
        live_session.answer_state = answer_state

    _recompute_question_counts(live_session)


def _recompute_question_counts(live_session: LiveSession):
    """Recompute all question count fields from answer_state."""
    answer_state = live_session.answer_state or {}
    total = live_session.total_questions or 0

    attempted = 0
    correct = 0
    wrong = 0
    viewed_only = 0

    for q_key, q_data in answer_state.items():
        if q_data.get("selected_option_id") is not None:
            attempted += 1
            if q_data.get("is_correct") is True:
                correct += 1
            elif q_data.get("is_correct") is False:
                wrong += 1
        elif q_data.get("viewed"):
            viewed_only += 1

    live_session.questions_attempted = attempted
    live_session.correct_answers = correct
    live_session.wrong_answers = wrong
    live_session.questions_viewed = viewed_only
    live_session.questions_unanswered = max(0, total - attempted)
    live_session.questions_skipped = viewed_only  # viewed but not answered
    live_session.accuracy_pct = round((correct / attempted * 100), 1) if attempted > 0 else 0.0


def _recompute_time_stats(live_session: LiveSession):
    """Recompute time-per-question statistics from answer_state."""
    answer_state = live_session.answer_state or {}
    times = []

    for q_data in answer_state.values():
        t = q_data.get("time_ms", 0)
        if t > 0:
            times.append(t)

    if times:
        live_session.avg_time_per_question_ms = int(sum(times) / len(times))
        live_session.fastest_question_ms = min(times)
        live_session.slowest_question_ms = max(times)


# ─────────────────────────────────────────
# Suspicious Activity Detection Rules
# ─────────────────────────────────────────

def _run_detection_rules(
    db: Session,
    live_session: LiveSession,
    event_type: str,
    payload: dict,
):
    """
    Run all suspicious activity detection rules after each event.
    Each rule can contribute to the overall risk_score and create SuspiciousFlag records.
    """
    new_flags: List[SuspiciousFlag] = []

    # Rule 1: Excessive tab switches (>5 total)
    if event_type == "TAB_SWITCH":
        count = live_session.tab_switch_count or 0
        if count == 5:
            new_flags.append(_create_flag(
                live_session, "EXCESSIVE_TAB_SWITCHES", "medium",
                f"Tab switched {count} times", 10
            ))
        elif count == 10:
            new_flags.append(_create_flag(
                live_session, "EXCESSIVE_TAB_SWITCHES", "high",
                f"Tab switched {count} times — repeated violations", 15
            ))

    # Rule 2: Fullscreen exit
    if event_type == "FULLSCREEN_EXIT":
        count = live_session.fullscreen_exit_count or 0
        severity = "medium" if count <= 2 else "high"
        new_flags.append(_create_flag(
            live_session, "FULLSCREEN_EXIT", severity,
            f"Exited fullscreen {count} time(s)", 8
        ))

    # Rule 3: Copy/paste detected
    if event_type == "COPY_PASTE_DETECTED":
        new_flags.append(_create_flag(
            live_session, "COPY_PASTE", "high",
            "Copy/paste activity detected during test", 20
        ))

    # Rule 4: Rapid answering (answer in < 2 seconds)
    if event_type in ("ANSWER_SELECTED", "ANSWER_CHANGED"):
        time_ms = payload.get("time_on_question_ms", 0)
        if 0 < time_ms < 2000:
            new_flags.append(_create_flag(
                live_session, "RAPID_ANSWERING", "medium",
                f"Answered question in {time_ms}ms (< 2s)", 5
            ))

    # Rule 5: Rapid navigation (many switches without answering)
    if event_type == "QUESTION_VIEWED":
        switch_count = live_session.question_switch_count or 0
        attempted = live_session.questions_attempted or 0
        if switch_count > 20 and attempted < 3:
            new_flags.append(_create_flag(
                live_session, "RAPID_NAVIGATION", "medium",
                f"{switch_count} question switches with only {attempted} answers", 10
            ))

    # Persist flags and update risk score
    for flag in new_flags:
        db.add(flag)
        live_session.risk_score = min(100, (live_session.risk_score or 0) + flag.risk_contribution)


def _create_flag(
    live_session: LiveSession,
    rule_name: str,
    severity: str,
    details: str,
    risk_contribution: int,
) -> SuspiciousFlag:
    """Create a SuspiciousFlag record."""
    return SuspiciousFlag(
        session_id=live_session.id,
        rule_name=rule_name,
        severity=severity,
        details=details,
        risk_contribution=risk_contribution,
    )


# ─────────────────────────────────────────
# State Builder (for admin broadcast)
# ─────────────────────────────────────────

def _build_candidate_state(live_session: LiveSession) -> dict:
    """
    Build a serializable candidate state dict for admin broadcast.
    This is what admins see for each candidate in the dashboard.
    """
    # Compute remaining time dynamically
    remaining = 0
    if live_session.test_started_at and live_session.remaining_seconds:
        started_at = _normalize_dt_to_naive_utc(live_session.test_started_at)
        now_naive = _normalize_dt_to_naive_utc(datetime.now(timezone.utc))
        elapsed = (now_naive - started_at).total_seconds()
        remaining = max(0, int(live_session.remaining_seconds - elapsed))

    return {
        "session_id": live_session.id,
        "attempt_id": live_session.attempt_id,
        "user_id": live_session.user_id,
        "test_id": live_session.test_id,
        "user_name": live_session.user.full_name if live_session.user else "Unknown",
        "user_email": live_session.user.email if live_session.user else "",
        "avatar_initials": live_session.user.avatar_initials if live_session.user else "",
        "status": live_session.status,
        "current_question": live_session.current_question or 1,
        "total_questions": live_session.total_questions or 0,
        "questions_attempted": live_session.questions_attempted or 0,
        "questions_unanswered": live_session.questions_unanswered or 0,
        "questions_viewed": live_session.questions_viewed or 0,
        "questions_skipped": live_session.questions_skipped or 0,
        "correct_answers": live_session.correct_answers or 0,
        "wrong_answers": live_session.wrong_answers or 0,
        "accuracy_pct": live_session.accuracy_pct or 0.0,
        "time_spent_seconds": live_session.time_spent_seconds or 0,
        "remaining_seconds": remaining,
        "avg_time_per_question_ms": live_session.avg_time_per_question_ms or 0,
        "fastest_question_ms": live_session.fastest_question_ms,
        "slowest_question_ms": live_session.slowest_question_ms,
        "tab_switch_count": live_session.tab_switch_count or 0,
        "fullscreen_exit_count": live_session.fullscreen_exit_count or 0,
        "copy_paste_count": live_session.copy_paste_count or 0,
        "idle_periods": live_session.idle_periods or 0,
        "risk_score": live_session.risk_score or 0,
        "is_flagged": live_session.is_flagged or False,
        "flag_reason": live_session.flag_reason,
        "connected_at": live_session.connected_at.isoformat() if live_session.connected_at else None,
        "last_heartbeat": live_session.last_heartbeat.isoformat() if live_session.last_heartbeat else None,
        "test_started_at": live_session.test_started_at.isoformat() if live_session.test_started_at else None,
    }


def build_candidate_state_from_session(live_session: LiveSession) -> dict:
    """Public wrapper for building candidate state (used by REST endpoints)."""
    return _build_candidate_state(live_session)
