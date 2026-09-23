"""The numbers behind Results → Insights.

Managers read these pages to decide who gets support and who is selected, so
the counts have to be exactly right:

  * the question-by-question page counts each learner's FIRST attempt — a
    retake after seeing the paper must not make a hard question look easy;
  * a blank answer is "left blank", not a wrong answer and not dropped;
  * the most common wrong answer is a wrong option, never the right one;
  * administrators and learners of other projects are not counted;
  * each learner's row carries their professional profile (for splitting by
    cadre, block …) and their first-attempt score.

The routes are called directly, as in test_login_surfaces.py.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_results_insights.py -v
"""
from __future__ import annotations

import base64
import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    Department, Designation, ProgramDistrict, Question, QuestionOption, Stage, User,
    Test as Paper, TestAnswer as PaperAnswer, TestAttempt as PaperAttempt,
)
from app.routers.admin import get_combined_results, get_results_questions  # noqa: E402
import app.models_live  # noqa: F401,E402
import app.models_security  # noqa: F401,E402

T0 = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)


@pytest.fixture()
def world():
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()

    pd = ProgramDistrict(name="Demo", slug="demo")
    other = ProgramDistrict(name="Other", slug="other")
    db.add_all([pd, other])
    db.flush()
    stage = Stage(program_district_id=pd.id, title="Test phase", stage_type="test", order_index=1)
    db.add(stage)
    db.flush()
    test = Paper(stage_id=stage.id, title="Formative", test_type="formative", duration_minutes=10,
                passing_score_pct=50, max_attempts=3, status="ended")
    db.add(test)
    db.flush()
    opts = {}
    for i in (1, 2):
        q = Question(test_id=test.id, text=f"Question {i}", marks=1, order_index=i)
        db.add(q)
        db.flush()
        a = QuestionOption(question_id=q.id, label="A", text="right", is_correct=True)
        b = QuestionOption(question_id=q.id, label="B", text="wrong one", is_correct=False)
        c = QuestionOption(question_id=q.id, label="C", text="wrong two", is_correct=False)
        db.add_all([a, b, c])
        db.flush()
        opts[i] = (q, a, b, c)

    health = Department(code="HFW", name="Health & Family Welfare")
    db.add(health)
    db.flush()
    asha = Designation(department_id=health.id, name="ASHA")
    db.add(asha)
    db.flush()

    def learner(email, project=pd, admin=False):
        u = User(email=email, full_name=email.split("@")[0], is_verified=True, is_admin=admin,
                 program_district_id=project.id, role="ASHA", designation_id=asha.id)
        db.add(u)
        db.flush()
        return u

    def attempt(user, number, picks, score, passed):
        att = PaperAttempt(test_id=test.id, user_id=user.id, attempt_number=number,
                          started_at=T0 + timedelta(hours=number), submitted_at=T0 + timedelta(hours=number, minutes=5),
                          score=score, is_passed=passed)
        db.add(att)
        db.flush()
        for i, pick in picks.items():
            q, a, b, c = opts[i]
            chosen = {"A": a, "B": b, "C": c}.get(pick)
            db.add(PaperAnswer(attempt_id=att.id, question_id=q.id,
                              selected_option_id=chosen.id if chosen else None,
                              is_correct=bool(chosen and chosen.is_correct)))
        return att

    # Ravi: first attempt Q1 right, Q2 wrong (B); retake gets both right.
    ravi = learner("ravi@t.mock")
    attempt(ravi, 1, {1: "A", 2: "B"}, 50.0, True)
    attempt(ravi, 2, {1: "A", 2: "A"}, 100.0, True)
    # Sita: Q1 wrong (B), Q2 left blank.
    sita = learner("sita@t.mock")
    attempt(sita, 1, {1: "B", 2: None}, 0.0, False)
    # Gita registered but never wrote.
    learner("gita@t.mock")
    # Neither of these may be counted.
    admin = learner("boss@t.mock", admin=True)
    attempt(admin, 1, {1: "C", 2: "C"}, 0.0, False)
    outsider = learner("far@t.mock", project=other)
    attempt(outsider, 1, {1: "C", 2: "C"}, 0.0, False)
    db.commit()
    yield db, test
    db.close()


def _questions(db):
    return get_results_questions(district="demo", db=db, admin_email="a@t")["tests"][0]


def test_questions_count_first_attempts_only(world):
    db, test = world
    out = _questions(db)
    assert out["test_id"] == test.id
    assert out["writers"] == 2, "Ravi and Sita wrote it; Gita did not; admin and outsider do not count"
    q1, q2 = out["questions"]
    assert q1["correct"] == 1, "Ravi right, Sita wrong"
    assert q2["correct"] == 0, "Ravi's retake got Q2 right, but his FIRST attempt did not"


def test_blank_answers_are_counted_as_blank(world):
    db, _ = world
    q1, q2 = _questions(db)["questions"]
    assert q1["unanswered"] == 0
    assert q2["unanswered"] == 1, "Sita left Q2 blank"


def test_most_common_wrong_answer_is_a_wrong_option(world):
    db, _ = world
    q1, q2 = _questions(db)["questions"]
    assert (q1["top_wrong_label"], q1["top_wrong_count"]) == ("B", 1), "Sita's B; the admin's and outsider's C are not counted"
    assert (q2["top_wrong_label"], q2["top_wrong_count"]) == ("B", 1)
    assert q1["correct_label"] == "A"


def test_results_rows_carry_profile_and_first_attempt(world):
    db, test = world
    data = get_combined_results(district="demo", db=db, admin_email="a@t")
    rows = {u["email"]: u for u in data["users"]}
    assert set(rows) == {"ravi@t.mock", "sita@t.mock", "gita@t.mock"}
    ravi = rows["ravi@t.mock"]["tests"][str(test.id)]
    assert ravi["first_score"] == 50.0 and ravi["best_score"] == 100.0
    assert ravi["passed_first_attempt"] is True and ravi["attempts_count"] == 2
    assert rows["sita@t.mock"]["tests"][str(test.id)]["passed_first_attempt"] is False
    assert rows["ravi@t.mock"]["profile"]["cadre"] == "ASHA"
    assert "phone" not in rows["ravi@t.mock"]["profile"], "contact details never travel with the insights"
    meta = next(t for t in data["tests"] if t["id"] == test.id)
    assert meta["passing_score_pct"] == 50
