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


def test_adoptions_and_growth_monitor_open_only_on_selection(db, world):
    from app.schemas import UserOut

    learner = world["learner"]
    _finish(db, world)                                   # finished, waiting
    assert UserOut.model_validate(learner).adoptions_open is False
    db.add(models.FaceToFaceSelection(user_id=learner.id, program_district_id=world["project"].id))
    db.commit()
    assert UserOut.model_validate(learner).adoptions_open is True


# ── The 19 Oct 2026 meeting: what the learner and the admin see ─────────────

def _paper(db, w):
    """One question with a right and a wrong option, and an attempt that got
    it right."""
    q = models.Question(test_id=w["test"].id, text="What is MUAC?", topic="Malnutrition", order_index=0)
    db.add(q)
    db.flush()
    right = models.QuestionOption(question_id=q.id, label="A", text="Arm circumference", is_correct=True)
    wrong = models.QuestionOption(question_id=q.id, label="B", text="Weight", is_correct=False)
    db.add_all([right, wrong])
    attempt = models.TestAttempt(user_id=w["learner"].id, test_id=w["test"].id, attempt_number=1, score=100.0,
                                 is_passed=True, started_at=datetime(2026, 10, 1, 4, 30, tzinfo=timezone.utc),
                                 submitted_at=datetime(2026, 10, 1, 4, 41, tzinfo=timezone.utc))
    db.add(attempt)
    db.flush()
    db.add(models.TestAnswer(attempt_id=attempt.id, question_id=q.id, selected_option_id=right.id, is_correct=True))
    db.commit()
    return attempt


def test_answers_stay_hidden_until_the_admin_releases_them(db, world):
    from app.routers.results import get_detailed_result

    attempt = _paper(db, world)
    world["test"].answers_released = False
    db.commit()
    held = get_detailed_result(attempt_id=attempt.id, current_user=world["learner"], db=db)
    assert held.answers_released is False
    (a,) = held.answers
    # The topic and whether it was right survive (the topic-wise score needs
    # them); the question, the options and the right answer do not.
    assert (a.topic, a.is_correct) == ("Malnutrition", True)
    assert (a.question_text, a.options, a.correct_option_id, a.selected_option_id) == ("", [], 0, None)

    world["test"].answers_released = True
    db.commit()
    shown = get_detailed_result(attempt_id=attempt.id, current_user=world["learner"], db=db)
    assert shown.answers_released is True
    assert shown.answers[0].question_text == "What is MUAC?" and len(shown.answers[0].options) == 2


def test_timeline_has_the_score_when_taken_and_the_phase_dates(db, world):
    from datetime import date
    from app.routers import admin
    from app.routers.tutorials import get_stages

    _paper(db, world)
    stage = db.query(models.Stage).filter_by(title="Phase 1").one()
    admin.update_stage(stage.id, {"starts_on": "2026-11-01", "finish_by": "2026-11-20"}, district="demo",
                       db=db, admin_email="a@x")
    with pytest.raises(Exception) as bad:
        admin.update_stage(stage.id, {"starts_on": "2026-11-21"}, district="demo", db=db, admin_email="a@x")
    assert getattr(bad.value, "status_code", None) == 400
    db.rollback()

    stages = get_stages(current_user=world["learner"], db=db)
    videos = next(s for s in stages if s.title == "Phase 1")
    assert (videos.starts_on, videos.finish_by) == (date(2026, 11, 1), date(2026, 11, 20))
    info = next(s for s in stages if s.test).test
    assert (info.score, info.correct, info.total_questions) == (100.0, 1, 1)
    assert info.attempt_started_at.minute == 30 and info.attempt_submitted_at.minute == 41


def test_adoption_type_on_the_learners_list(db, world):
    from datetime import date, timedelta
    from app.routers.mothers import _adoption_type

    learner = world["learner"]
    today = date.today()
    anc = models.Mother(mother_uid="MR-A", mother_name="A", registered_by_user_id=learner.id,
                        adoption_date=today - timedelta(days=40), lmp=today - timedelta(days=200))
    pnc = models.Mother(mother_uid="MR-B", mother_name="B", registered_by_user_id=learner.id,
                        adoption_date=today - timedelta(days=10))
    old = models.Mother(mother_uid="MR-C", mother_name="C", registered_by_user_id=learner.id,
                        adoption_date=today - timedelta(days=10))
    db.add_all([anc, pnc, old])
    db.flush()
    db.add_all([
        models.Child(child_uid="CR-A", child_name="a", mother_id=anc.id, dob=today - timedelta(days=5)),
        models.Child(child_uid="CR-B", child_name="b", mother_id=pnc.id, dob=today - timedelta(days=70)),
        models.Child(child_uid="CR-C", child_name="c", mother_id=old.id, dob=today - timedelta(days=200)),
    ])
    db.commit()
    assert [_adoption_type(m) for m in (anc, pnc, old)] == ["anc", "pnc_lt5", "pnc_ge5"]


def test_admin_sees_a_learners_recent_activity(db, world):
    from datetime import date
    from app.routers.growth import admin_learner_activity

    learner = world["learner"]
    mother = models.Mother(mother_uid="MR-X", mother_name="Pallavi", registered_by_user_id=learner.id)
    db.add(mother)
    db.flush()
    child = models.Child(child_uid="CR-X", child_name="Baby of Pallavi", mother_id=mother.id)
    db.add(child)
    db.flush()
    db.add(models.FormResponse(form_key="breastfeeding", child_id=child.id, submitted_by_user_id=learner.id,
                               assessment_date=date(2026, 10, 18), status="submitted", answers_json=[]))
    db.add(models.FormResponse(form_key="breastfeeding", child_id=child.id, submitted_by_user_id=learner.id,
                               assessment_date=date(2026, 10, 18), status="draft", answers_json=[]))
    db.commit()
    out = admin_learner_activity(user_id=learner.id, limit=60, admin={"email": "a@x"}, db=db)
    kinds = [e["kind"] for e in out["events"]]
    assert sorted(kinds) == ["adoption", "form"]                 # the draft is not activity
    form = next(e for e in out["events"] if e["kind"] == "form")
    # Admins see the record ID, not the name (launch review of 19 Oct 2026).
    assert form["form_key"] == "breastfeeding" and form["mother"]["name"] == "MR-X"
    assert form["child"]["uid"] == "CR-X" and form["assessment_date"] == "2026-10-18"
    assert out["last_active"]


def test_faltering_cases_filter_by_department():
    from app import faltering

    def row(cid, dept):
        return {"case_id": cid, "flags": ["faltering"], "monitor": None, "batch": None,
                "learner": {"id": cid, "name": "L", "cadre": "AWW", "block": "B", "mobile": None, "department": dept}}

    rows = [row(1, "WCD"), row(2, "HFW"), row(3, None)]
    assert [r["case_id"] for r in faltering.apply_filters(rows, department="HFW")] == [2]
    assert [r["case_id"] for r in faltering.apply_filters(rows)] == [1, 2, 3]
