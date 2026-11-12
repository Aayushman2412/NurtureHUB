"""Checks on a growth measurement when it is saved (docs/visit-protocol-2026-11.md,
"Entry checks when a measurement is saved").

* Impossible values: WAZ < −6 or > +5, LAZ < −6 or > +6, WLZ < −5 or > +5.
* A likely typing error: the weight more than 1.5× or less than 0.67× the
  previous one, carried forward along the baby's own WHO curve (so six
  months of normal growth is not "a typing error").
* Weight loss since the previous check: ≥ 10 % refer today, 5–10 % revisit
  within 7 days. Under 3 weeks the newborn rule: more than 10 % below the
  birth weight.
* Length more than 1 cm shorter than before: measure again with two people.

The save is never blocked: the flags are recorded with the response, with
which of them the learner confirmed, for the supervisors' case page.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_growth_entry_checks.py -v
"""
from __future__ import annotations

import base64
import os
import tempfile
from datetime import date, timedelta

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import growth_entry_checks as C  # noqa: E402
from app import models  # noqa: E402
from app.database import Base  # noqa: E402
from app.who_growth import value_for_z  # noqa: E402
import app.models_live  # noqa: F401,E402
import app.models_security  # noqa: F401,E402

DOB = date(2026, 1, 1)
BEFORE = date(2026, 9, 1)                 # 243 days old
NOW = date(2026, 9, 11)                   # 10 days later
M = C.Measurement


def _codes(flags):
    return [f["code"] for f in flags]


def _check(weight=None, length=None, *, on=NOW, history=(M(BEFORE, 7.5, 68.0),), dob=DOB,
           birth_weight=3.0, sex="girls"):
    return C.check(M(on, weight, length), sex=sex, dob=dob, birth_weight=birth_weight, history=list(history))


# ── A likely typing error ─────────────────────────────────────────────────

def test_75_typed_for_7_5_is_a_typing_error():
    flags = _check(75.0)
    assert "typing_error" in _codes(flags)
    typo = next(f for f in flags if f["code"] == "typing_error")
    assert typo["field"] == "weight" and typo["action"] == "remeasure"
    assert typo["previous"] == {"on": BEFORE.isoformat(), "value": 7.5}
    assert "typing_error" in _codes(_check(0.75))


def test_a_jump_of_half_again_in_ten_days_is_a_typing_error():
    assert "typing_error" in _codes(_check(12.0))
    assert _codes(_check(7.7)) == []


def test_six_months_of_normal_growth_is_not_a_typing_error():
    """4.2 kg at one month and 7.3 kg at seven is 1.7× — but it is the baby's
    own curve, which is what the WHO tables scaled to the interval say."""
    born = date(2026, 1, 1)
    one_month = born + timedelta(days=30)
    seven = born + timedelta(days=210)
    w30 = round(value_for_z("wfa", "girls", 30, -0.3), 2)
    w210 = round(value_for_z("wfa", "girls", 210, -0.3), 2)
    assert w210 / w30 > 1.5
    assert _codes(_check(w210, on=seven, history=[M(one_month, w30, None)], dob=born)) == []


# ── Weight loss ────────────────────────────────────────────────────────────

def test_a_12_percent_loss_is_referred_today():
    flags = _check(6.6)
    assert _codes(flags) == ["weight_loss_refer"]
    loss = flags[0]
    assert loss["action"] == "refer_today" and loss["loss_pct"] == 12 and loss["field"] == "weight"


def test_a_loss_of_5_to_10_percent_is_revisited_within_7_days():
    flags = _check(6.975)                                   # 7 %
    assert _codes(flags) == ["weight_loss_revisit"]
    assert flags[0]["action"] == "revisit_7d" and flags[0]["revisit_within_days"] == 7


def test_the_loss_bands_include_their_lower_edge():
    assert _codes(_check(6.75)) == ["weight_loss_refer"]     # exactly 10 %
    assert _codes(_check(7.125)) == ["weight_loss_revisit"]  # exactly 5 %
    assert _codes(_check(7.2)) == []                         # 4 %


# ── Length ─────────────────────────────────────────────────────────────────

def test_length_more_than_1_cm_shorter_is_measured_again_by_two_people():
    flags = _check(7.6, 66.5)
    assert _codes(flags) == ["length_shorter"]
    assert flags[0]["field"] == "length" and flags[0]["action"] == "remeasure_two_people"
    assert flags[0]["shorter_cm"] == pytest.approx(1.5)
    assert _codes(_check(7.6, 67.0)) == []                   # exactly 1 cm: not "more than"
    assert _codes(_check(7.6, 67.2)) == []


def test_length_compares_with_the_last_check_that_had_a_length():
    history = [M(BEFORE - timedelta(days=20), 7.2, 68.0), M(BEFORE, 7.5, None)]
    assert _codes(_check(7.6, 66.5, history=history)) == ["length_shorter"]


# ── Impossible values ──────────────────────────────────────────────────────

def test_impossible_z_scores_are_measured_again():
    tall = _check(5.5, 80.0, on=DOB + timedelta(days=60), history=())
    assert "impossible_lfa" in _codes(tall)
    thin = _check(1.2, 70.0, history=())
    assert "impossible_wfl" in _codes(thin) and "impossible_wfa" in _codes(thin)
    assert all(f["action"] == "remeasure" for f in thin)


def test_an_ordinary_first_check_has_no_flags():
    assert _check(7.5, 68.0, history=()) == []
    assert _check(None, None) == []


# ── The newborn rule ───────────────────────────────────────────────────────

def test_a_newborn_is_compared_with_the_birth_weight():
    born = date(2026, 9, 1)
    history = [M(born + timedelta(days=3), 3.0, None)]
    flags = _check(2.8, on=born + timedelta(days=7), history=history, dob=born, birth_weight=3.2)
    # 12.5 % below the birth weight; the 6.7 % loss since day 3 is the usual
    # newborn loss, not a "revisit".
    assert _codes(flags) == ["newborn_loss"]
    assert flags[0]["action"] == "refer_today" and flags[0]["birth_weight"] == 3.2 and flags[0]["loss_pct"] == 12
    assert _check(3.05, on=born + timedelta(days=7), history=history, dob=born, birth_weight=3.2) == []


# ── Recorded with the response ─────────────────────────────────────────────

GROWTH_SCHEMA = {"fields": [
    {"id": "measurement_date", "label": "Measurement date", "type": "date", "required": True},
    {"id": "baby_length", "label": "Baby's length (cm)", "type": "number", "required": False, "min": 30, "max": 120},
    {"id": "baby_weight", "label": "Baby's weight (kg)", "type": "number", "required": False, "min": 1, "max": 30},
]}


@pytest.fixture()
def world():
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()
    db.add(models.FormDefinition(form_key="growth_monitoring", title="Check Growth", builder_type="flat",
                                 schema_json=GROWTH_SCHEMA, version=1))
    worker = models.User(email="w@t.mock", full_name="Asha Worker", is_verified=True, role="ASHA")
    other = models.User(email="o@t.mock", full_name="Other Worker", is_verified=True, role="ASHA")
    db.add_all([worker, other])
    db.flush()
    mother = models.Mother(mother_uid="T-M1", registered_by_user_id=worker.id, mother_name="Pallavi",
                           adoption_date=DOB)
    db.add(mother)
    db.flush()
    child = models.Child(child_uid="T-C1", mother_id=mother.id, child_name="Riya", dob=DOB, adoption_date=DOB,
                         gender="Female", birth_weight=3.0)
    db.add(child)
    db.flush()
    db.add(models.FormResponse(
        form_key="growth_monitoring", child_id=child.id, submitted_by_user_id=worker.id,
        assessment_date=BEFORE, status="submitted",
        answers_json=[{"nodeId": "baby_weight", "question": "Baby's weight (kg)", "questionType": "number", "value": "7.5"},
                      {"nodeId": "baby_length", "question": "Baby's length (cm)", "questionType": "number", "value": "68.0"}]))
    db.commit()
    yield {"db": db, "worker": worker, "other": other, "child": child}
    db.close()
    engine.dispose()
    os.unlink(path)


def _submit(world, weight, confirmed=(), length="68.5"):
    from app.routers.forms import AnswerIn, ResponseCreate, create_response

    data = ResponseCreate(child_id=world["child"].id, assessment_date=NOW, status="submitted",
                          answers=[AnswerIn(nodeId="measurement_date", value=NOW.isoformat()),
                                   AnswerIn(nodeId="baby_length", value=length),
                                   AnswerIn(nodeId="baby_weight", value=weight)],
                          confirmed_checks=list(confirmed))
    return create_response(form_key="growth_monitoring", data=data, current_user=world["worker"], db=world["db"])


def test_a_flagged_weight_is_saved_with_its_flag(world):
    saved = _submit(world, "6.6")
    checks = saved["summary_json"]["entry_checks"]
    assert _codes(checks["flags"]) == ["weight_loss_refer"]
    assert checks["confirmed"] == [] and checks["all_confirmed"] is False


def test_a_confirmed_flag_is_recorded_as_confirmed(world):
    saved = _submit(world, "6.6", confirmed=["weight_loss_refer", "not_a_flag"])
    checks = saved["summary_json"]["entry_checks"]
    assert checks["confirmed"] == ["weight_loss_refer"] and checks["all_confirmed"] is True


def test_an_ordinary_check_carries_no_flags(world):
    saved = _submit(world, "7.7")
    assert "entry_checks" not in saved["summary_json"]


def test_editing_a_check_compares_with_the_one_before_not_itself(world):
    from app.routers.forms import AnswerIn, ResponseUpdate, update_response

    saved = _submit(world, "7.7")
    edited = update_response(
        response_id=saved["id"],
        data=ResponseUpdate(assessment_date=NOW, status="submitted",
                            answers=[AnswerIn(nodeId="measurement_date", value=NOW.isoformat()),
                                     AnswerIn(nodeId="baby_weight", value="6.6")]),
        current_user=world["worker"], db=world["db"])
    assert _codes(edited["summary_json"]["entry_checks"]["flags"]) == ["weight_loss_refer"]


def test_the_case_page_shows_the_flag_on_its_visit(world):
    from app.routers.growth import _case_detail

    _submit(world, "6.6", confirmed=["weight_loss_refer"])
    db, child = world["db"], world["child"]
    mother = db.get(models.Mother, child.mother_id)
    detail = _case_detail(db, child, mother, world["worker"], department=None)
    visit = next(v for v in detail["visits"] if v["date"] == NOW.isoformat())
    assert _codes(visit["checks"]["flags"]) == ["weight_loss_refer"] and visit["checks"]["all_confirmed"]
    assert next(v for v in detail["visits"] if v["date"] == BEFORE.isoformat())["checks"] is None


def test_the_runner_can_ask_before_saving(world):
    from app.routers.growth_status import MeasurementCheckIn, check_measurement

    got = check_measurement(child_id=world["child"].id,
                            data=MeasurementCheckIn(assessment_date=NOW, weight=75.0, length=68.5),
                            current_user=world["worker"], db=world["db"])
    assert "typing_error" in _codes(got["flags"])
    assert got["previous"]["weight"] == {"on": BEFORE.isoformat(), "value": 7.5}


def test_only_the_learners_own_baby_can_be_checked(world):
    from app.routers.growth_status import MeasurementCheckIn, check_measurement

    with pytest.raises(HTTPException) as exc:
        check_measurement(child_id=world["child"].id,
                          data=MeasurementCheckIn(assessment_date=NOW, weight=7.5),
                          current_user=world["other"], db=world["db"])
    assert exc.value.status_code == 404
