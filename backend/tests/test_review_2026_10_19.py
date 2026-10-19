"""19 Oct 2026: the selection pipeline as the learner's dashboard tells it.

* in_progress → awaiting (all done, not announced) → not_selected (all done,
  announced, not on the list); selected whenever she is on the list.
* Adoptions opens only on selection — having mothers is not enough.
* An admin announces the selection per project (and can take it back); the
  finished-but-not-selected learners are told when it is announced.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_review_2026_10_19.py -v
"""
from __future__ import annotations

import base64
import os
import tempfile
from datetime import datetime, timezone

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models  # noqa: E402
from app.database import Base  # noqa: E402
from app.flow import selection_state  # noqa: E402
import app.models_live  # noqa: F401,E402
import app.models_security  # noqa: F401,E402


@pytest.fixture()
def db():
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()
    os.unlink(path)


@pytest.fixture()
def world(db):
    project = models.ProgramDistrict(name="Demo", slug="demo")
    db.add(project)
    db.flush()
    videos = models.Stage(program_district_id=project.id, title="Phase 1", order_index=0)
    exam = models.Stage(program_district_id=project.id, title="Phase 2", order_index=1, stage_type="test")
    db.add_all([videos, exam])
    db.flush()
    tutorial = models.Tutorial(stage_id=videos.id, title="Video", order_index=0)
    test = models.Test(stage_id=exam.id, title="Screening", test_type="screening", passing_score_pct=70,
                       total_questions=1, duration_minutes=10, max_attempts=3, status="ended")
    db.add_all([tutorial, test])
    learner = models.User(email="l@example.org", full_name="Asha", password_hash="x", is_verified=True,
                          role="AWW", program_district_id=project.id)
    db.add(learner)
    db.commit()
    return {"project": project, "tutorial": tutorial, "test": test, "learner": learner}


def _finish(db, w):
    db.add(models.UserTutorialProgress(user_id=w["learner"].id, tutorial_id=w["tutorial"].id, is_completed=True))
    db.add(models.TestAttempt(user_id=w["learner"].id, test_id=w["test"].id, attempt_number=1, score=40.0,
                              submitted_at=datetime.now(timezone.utc)))
    db.commit()


def test_the_four_states(db, world):
    learner = world["learner"]
    assert selection_state(db, learner) == "in_progress"
    _finish(db, world)
    assert selection_state(db, learner) == "awaiting"
    world["project"].selection_announced_at = datetime.now(timezone.utc)
    db.commit()
    assert selection_state(db, learner) == "not_selected"
    db.add(models.FaceToFaceSelection(user_id=learner.id, program_district_id=world["project"].id))
    db.commit()
    assert selection_state(db, learner) == "selected"


def test_a_state_projects_announcement_reaches_its_districts(db, world):
    state = models.ProgramDistrict(name="State", slug="state", level="state",
                                   selection_announced_at=datetime.now(timezone.utc))
    db.add(state)
    db.flush()
    world["project"].parent_id = state.id
    db.commit()
    _finish(db, world)
    assert selection_state(db, world["learner"]) == "not_selected"


def test_adoptions_open_only_on_selection(db, world):
    from app.routers.dashboard import get_dashboard_data

    learner = world["learner"]
    db.add(models.Mother(mother_uid="MR-T1", mother_name="M", registered_by_user_id=learner.id))   # mothers alone don't open it
    db.commit()
    data = get_dashboard_data(current_user=learner, db=db)
    assert (data.selection_state, data.adoptions_open) == ("in_progress", False)
    db.add(models.FaceToFaceSelection(user_id=learner.id, program_district_id=world["project"].id))
    db.commit()
    data = get_dashboard_data(current_user=learner, db=db)
    assert (data.selection_state, data.adoptions_open, data.awaiting_results) == ("selected", True, False)


def test_admin_announces_and_takes_it_back(db, world):
    from app.routers import admin

    _finish(db, world)
    got = admin.get_selection_announcement(district="demo", db=db, admin_email="a@x")
    assert got == {"announced_at": None, "finished_not_selected": 1}

    out = admin.set_selection_announcement(admin.SelectionAnnouncementRequest(announce=True), district="demo",
                                           db=db, admin_email="a@x")
    assert out["notified"] == 1 and out["announced_at"]
    note = db.query(models.Notification).filter_by(user_id=world["learner"].id).one()
    assert note.title == admin.NOT_SELECTED_NOTIFICATION_TITLE
    assert selection_state(db, world["learner"]) == "not_selected"

    out = admin.set_selection_announcement(admin.SelectionAnnouncementRequest(announce=False), district="demo",
                                           db=db, admin_email="a@x")
    assert out["announced_at"] is None
    assert selection_state(db, world["learner"]) == "awaiting"
