"""
Safety net: score attempts whose time ran out but whose browser never submitted.

At a few thousand candidates the dangerous moment is the end of the test. Every
timer expires within seconds of every other, every browser submits at once,
and some of those submissions will fail — a busy server answering 503, a phone
losing signal at the last second, a tab closed during the error toast. The
browser retries, but a candidate whose device never comes back would otherwise
be recorded as "not attempted", with nothing to show for the whole test.

Their answers are not lost, though. Every selection was streamed to the live
monitor as it happened (and queued on the device while offline, then flushed),
so the live session's answer_state holds the paper as the candidate left it.
This job scores THAT, using exactly the same rule as a normal submit.

Deliberately conservative:
  * it waits FINALIZE_GRACE_SECONDS past the deadline, which is longer than the
    browser's own retry window — a device that is merely slow always wins;
  * only attempts that actually began writing (have a live session) are
    touched; an attempt opened and abandoned is left exactly as before, so it
    cannot quietly consume one of the candidate's permitted attempts;
  * an attempt superseded by a newer one for the same person and test is left
    alone;
  * the claim on each attempt is the same atomic "submitted_at IS NULL" update
    the submit endpoint uses, so a late browser submit and this job can never
    both score one attempt.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Tuple

from sqlalchemy import update

from app.database import SessionLocal
from app.event_processor import build_candidate_state_from_session
from app.models import Test, TestAttempt, User
from app.models_live import LiveSession
from app.routers.tests import finish_attempt_notifications, score_attempt

# Longer than the browser's retry window (~150s), so a device that is merely
# slow to reach the server always gets to submit its own copy first.
FINALIZE_GRACE_SECONDS = 300


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def finalize_overdue_attempts(grace_seconds: int = FINALIZE_GRACE_SECONDS,
                              limit: int = 1000,
                              session_factory=SessionLocal,
                              now: datetime | None = None) -> List[Tuple[int, dict]]:
    """Score every overdue, unsubmitted attempt that has live answers.

    Returns (test_id, candidate_state) pairs so the caller can update any admin
    watching the live monitor. `session_factory` and `now` exist so tests can
    drive it against a throwaway database at a chosen moment.
    """
    now = now or datetime.now(timezone.utc)
    updates: List[Tuple[int, dict]] = []
    db = session_factory()
    try:
        rows = (
            db.query(TestAttempt.id)
            .join(Test, Test.id == TestAttempt.test_id)
            .join(LiveSession, LiveSession.attempt_id == TestAttempt.id)
            .filter(
                TestAttempt.submitted_at.is_(None),
                TestAttempt.started_at.isnot(None),
                # Cheap prefilter; the exact per-test deadline is checked below.
                TestAttempt.started_at < now - timedelta(seconds=grace_seconds),
                Test.duration_minutes > 0,
            )
            .order_by(TestAttempt.id)
            .limit(limit)
            .all()
        )
        for (attempt_id,) in rows:
            try:
                attempt = db.query(TestAttempt).filter(TestAttempt.id == attempt_id).first()
                test = db.query(Test).filter(Test.id == attempt.test_id).first()
                deadline = (_as_utc(attempt.started_at)
                            + timedelta(minutes=test.duration_minutes, seconds=grace_seconds))
                if deadline > now:
                    continue
                superseded = db.query(TestAttempt.id).filter(
                    TestAttempt.user_id == attempt.user_id,
                    TestAttempt.test_id == attempt.test_id,
                    TestAttempt.id > attempt.id,
                ).first()
                if superseded:
                    continue

                claimed = db.execute(
                    update(TestAttempt)
                    .where(TestAttempt.id == attempt.id, TestAttempt.submitted_at.is_(None))
                    .values(submitted_at=now)
                ).rowcount
                if not claimed:
                    db.rollback()
                    continue

                live = db.query(LiveSession).filter(LiveSession.attempt_id == attempt.id).first()
                answers = {}
                for qid, entry in ((live.answer_state or {}) if live else {}).items():
                    if isinstance(entry, dict) and entry.get("selected_option_id"):
                        answers[int(qid)] = (entry["selected_option_id"], False)

                result = score_attempt(db, attempt, test, answers,
                                       time_used_seconds=test.duration_minutes * 60)
                if live is not None:
                    live.status = "auto_submitted"
                user = db.query(User).filter(User.id == attempt.user_id).first()
                if user is not None:
                    finish_attempt_notifications(db, user, test, attempt, result, auto=True)
                db.commit()
                print(f"[finalizer] scored overdue attempt {attempt.id} (test {test.id}) "
                      f"from live answers: {result['score']:.1f}% "
                      f"({len(answers)}/{result['total_questions']} answered)")
                if live is not None:
                    updates.append((test.id, build_candidate_state_from_session(live)))
            except Exception as exc:  # one bad attempt must not stop the rest
                db.rollback()
                print(f"[finalizer] could not finalize attempt {attempt_id}: {exc}")
    finally:
        db.close()
    return updates
