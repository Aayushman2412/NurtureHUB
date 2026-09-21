"""Live monitoring at scale: the behaviour that would fail quietly on the day.

  * connection ownership — a phone that drops and reconnects must stay live;
    the OLD socket's cleanup must not deregister the new one or mark the
    candidate disconnected;
  * batching — admins get the latest state per candidate, once per interval,
    not one message per event;
  * single-runner jobs — without Redis there is one worker, which always leads;
  * the overdue-attempt safety net — scores from the live answers, but only
    when it is safe to: past the grace period, with a live session, not
    superseded, and never twice.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_scale_live.py -v
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.ws_manager import ConnectionManager


# ── fakes ────────────────────────────────────────────────────────────────────

class FakeWS:
    def __init__(self, name="ws"):
        self.name = name
        self.sent = []
        self.closed = None

    async def accept(self):
        pass

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)

    async def send_json(self, data):
        self.sent.append(data)


def run(coro):
    return asyncio.run(coro)


# ── connection ownership ─────────────────────────────────────────────────────

def test_reconnect_keeps_the_new_socket_live():
    async def scenario():
        m = ConnectionManager()
        old, new = FakeWS("old"), FakeWS("new")
        c_old = await m.connect_candidate(old, 7)
        c_new = await m.connect_candidate(new, 7)
        assert old.closed and old.closed[0] == 4001, "the replaced socket is closed"

        # The OLD socket's cleanup runs after the reconnect — it must not win.
        assert await m.disconnect_candidate(7, c_old) is False
        assert m.candidate_connections[7] is new, "new socket must stay registered"
        assert m.is_candidate_connected(7)

        # The current socket's cleanup is the real departure.
        assert await m.disconnect_candidate(7, c_new) is True
        assert not m.is_candidate_connected(7)
    run(scenario())


def test_pushes_still_reach_a_reconnected_candidate():
    """Warn / force-submit after a reconnect must land on the NEW socket."""
    async def scenario():
        m = ConnectionManager()
        old, new = FakeWS("old"), FakeWS("new")
        c_old = await m.connect_candidate(old, 9)
        await m.connect_candidate(new, 9)
        await m.disconnect_candidate(9, c_old)          # stale cleanup
        await m.send_to_candidate(9, {"type": "FORCE_SUBMIT"})
        assert new.sent == [{"type": "FORCE_SUBMIT"}]
        assert old.sent == []
    run(scenario())


# ── batching ─────────────────────────────────────────────────────────────────

def test_admin_updates_are_coalesced_latest_wins():
    async def scenario():
        m = ConnectionManager()
        admin = FakeWS("admin")
        await m.connect_admin(admin, 5, "a@x")
        m._deliver_admin(5, {"type": "CANDIDATE_UPDATE", "data": {"session_id": 1, "v": 1}})
        m._deliver_admin(5, {"type": "CANDIDATE_UPDATE", "data": {"session_id": 1, "v": 2}})
        m._deliver_admin(5, {"type": "CANDIDATE_CONNECTED", "data": {"session_id": 2, "v": 1}})
        m._deliver_admin(5, {"type": "CANDIDATE_DISCONNECTED", "data": {"session_id": 3, "status": "active"}})
        pending = m._pending[5]
        assert set(pending) == {1, 2, 3}
        assert pending[1]["v"] == 2, "latest state for a candidate wins"
        assert pending[3]["status"] == "disconnected"
        assert admin.sent == [], "nothing sent per event"
    run(scenario())


def test_one_batch_is_flushed_per_interval(monkeypatch):
    monkeypatch.setattr(settings, "WS_ADMIN_BATCH_SECONDS", 0.2)

    async def scenario():
        m = ConnectionManager()
        admin = FakeWS("admin")
        await m.connect_admin(admin, 5, "a@x")
        for i in range(50):
            m._deliver_admin(5, {"type": "CANDIDATE_UPDATE", "data": {"session_id": i % 10, "v": i}})
        task = asyncio.create_task(m._flush_loop())
        await asyncio.sleep(0.35)
        task.cancel()
        batches = [x for x in admin.sent if x["type"] == "CANDIDATE_BATCH"]
        assert len(batches) == 1, "50 events became ONE message"
        assert len(batches[0]["data"]) == 10, "one entry per candidate"
    run(scenario())


def test_non_state_messages_are_not_delayed():
    async def scenario():
        m = ConnectionManager()
        admin = FakeWS("admin")
        await m.connect_admin(admin, 5, "a@x")
        m._deliver_admin(5, {"type": "ADMIN_ACTION_SYNC", "data": {"session_id": 1}})
        await asyncio.sleep(0.05)
        assert admin.sent and admin.sent[0]["type"] == "ADMIN_ACTION_SYNC"
        assert not m._pending.get(5)
    run(scenario())


def test_updates_for_unwatched_tests_are_dropped():
    """Nobody watching -> nothing accumulates (no unbounded growth)."""
    m = ConnectionManager()
    m._deliver_admin(99, {"type": "CANDIDATE_UPDATE", "data": {"session_id": 1}})
    assert 99 not in m._pending


def test_single_worker_always_leads():
    assert run(ConnectionManager().try_lead("anything", 30)) is True


# ── overdue-attempt safety net ───────────────────────────────────────────────

@pytest.fixture()
def db_factory():
    import app.models  # noqa: F401
    import app.models_live  # noqa: F401
    import app.models_security  # noqa: F401
    from app.database import Base

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def _paper(db):
    from app.models import Question, QuestionOption, Stage, Test

    stage = Stage(title="Test phase", stage_type="test", order_index=0)
    db.add(stage)
    db.flush()
    test = Test(stage_id=stage.id, title="Formative", duration_minutes=10,
                passing_score_pct=50, max_attempts=3, status="active")
    db.add(test)
    db.flush()
    correct = {}
    wrong = {}
    for i in range(2):
        q = Question(test_id=test.id, text=f"Q{i}", marks=1, order_index=i)
        db.add(q)
        db.flush()
        a = QuestionOption(question_id=q.id, label="A", text="right", is_correct=True)
        b = QuestionOption(question_id=q.id, label="B", text="wrong", is_correct=False)
        db.add_all([a, b])
        db.flush()
        correct[q.id], wrong[q.id] = a.id, b.id
    return test, correct, wrong


def _candidate(db, test, email, started, answers=None, live=True):
    from app.models import TestAttempt, User
    from app.models_live import LiveSession

    user = User(email=email, full_name=email.split("@")[0], is_verified=True)
    db.add(user)
    db.flush()
    attempt = TestAttempt(test_id=test.id, user_id=user.id, attempt_number=1, started_at=started)
    db.add(attempt)
    db.flush()
    if live:
        db.add(LiveSession(attempt_id=attempt.id, user_id=user.id, test_id=test.id,
                           status="active", answer_state=answers or {}, total_questions=2))
    db.commit()
    return user, attempt


@pytest.fixture()
def no_notifications(monkeypatch):
    calls = []
    monkeypatch.setattr("app.attempt_finalizer.finish_attempt_notifications",
                        lambda *a, **k: calls.append(k))
    return calls


def test_overdue_attempt_is_scored_from_live_answers(db_factory, no_notifications):
    from app.attempt_finalizer import finalize_overdue_attempts
    from app.models import TestAnswer, TestAttempt
    from app.models_live import LiveSession

    now = datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc)
    db = db_factory()
    test, correct, wrong = _paper(db)
    q1, q2 = sorted(correct)
    _, attempt = _candidate(db, test, "a@t.mock", now - timedelta(minutes=30), {
        str(q1): {"selected_option_id": correct[q1]},
        str(q2): {"selected_option_id": wrong[q2]},
    })

    updates = finalize_overdue_attempts(session_factory=db_factory, now=now)

    db = db_factory()
    a = db.get(TestAttempt, attempt.id)
    assert a.submitted_at is not None
    assert a.score == 50.0, "1 of 2 correct, same rule as a normal submit"
    assert db.query(TestAnswer).filter(TestAnswer.attempt_id == a.id).count() == 2
    ls = db.query(LiveSession).filter(LiveSession.attempt_id == a.id).first()
    assert ls.status == "auto_submitted"
    assert len(updates) == 1 and updates[0][0] == test.id
    assert no_notifications == [{"auto": True}]


def test_within_grace_is_left_for_the_browser(db_factory, no_notifications):
    from app.attempt_finalizer import finalize_overdue_attempts
    from app.models import TestAttempt

    now = datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc)
    db = db_factory()
    test, correct, _ = _paper(db)
    # 10-minute test that started 12 minutes ago: time is up, but grace (5 min)
    # has not passed — the browser may still be retrying.
    _, attempt = _candidate(db, test, "b@t.mock", now - timedelta(minutes=12))
    assert finalize_overdue_attempts(session_factory=db_factory, now=now) == []
    assert db_factory().get(TestAttempt, attempt.id).submitted_at is None


def test_attempt_that_never_started_writing_is_untouched(db_factory, no_notifications):
    from app.attempt_finalizer import finalize_overdue_attempts
    from app.models import TestAttempt

    now = datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc)
    db = db_factory()
    test, _, _ = _paper(db)
    _, attempt = _candidate(db, test, "c@t.mock", now - timedelta(hours=2), live=False)
    finalize_overdue_attempts(session_factory=db_factory, now=now)
    assert db_factory().get(TestAttempt, attempt.id).submitted_at is None, \
        "an abandoned attempt must not silently consume one of the candidate's attempts"


def test_superseded_attempt_is_untouched(db_factory, no_notifications):
    from app.attempt_finalizer import finalize_overdue_attempts
    from app.models import TestAttempt

    now = datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc)
    db = db_factory()
    test, _, _ = _paper(db)
    user, older = _candidate(db, test, "d@t.mock", now - timedelta(hours=2))
    newer = TestAttempt(test_id=test.id, user_id=user.id, attempt_number=2,
                        started_at=now - timedelta(minutes=1))
    db.add(newer)
    db.commit()
    finalize_overdue_attempts(session_factory=db_factory, now=now)
    assert db_factory().get(TestAttempt, older.id).submitted_at is None


def test_never_scores_an_attempt_twice(db_factory, no_notifications):
    from app.attempt_finalizer import finalize_overdue_attempts
    from app.models import TestAnswer

    now = datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc)
    db = db_factory()
    test, correct, _ = _paper(db)
    _, attempt = _candidate(db, test, "e@t.mock", now - timedelta(minutes=30))
    finalize_overdue_attempts(session_factory=db_factory, now=now)
    finalize_overdue_attempts(session_factory=db_factory, now=now + timedelta(minutes=1))
    rows = db_factory().query(TestAnswer).filter(TestAnswer.attempt_id == attempt.id).count()
    assert rows == 2, "answer rows written exactly once"
    assert len(no_notifications) == 1
