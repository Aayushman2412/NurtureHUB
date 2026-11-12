"""The November 2026 visit protocol in the database and the worker app:
which projects run it, Today and the baby's plan from app/visit_plan.py,
counselling and drop-out, and the legacy protocol left exactly as it was.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_visit_plan.py -v
"""
from __future__ import annotations

import base64
import importlib.util
import os
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models, projects  # noqa: E402
from app import visit_protocol as VP  # noqa: E402
from app.database import Base  # noqa: E402
import app.models_live  # noqa: F401,E402
import app.models_security  # noqa: F401,E402

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


@pytest.fixture()
def db():
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()
    engine.dispose()
    os.unlink(path)


# ── Which projects run the new protocol ────────────────────────────────────

def _migration(name: str):
    path = next(VERSIONS.glob(f"{name}_*.py"))
    spec = importlib.util.spec_from_file_location(f"migration_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_chandrapur_moves_to_the_new_protocol_and_no_other_project(db):
    db.add_all([
        models.ProgramDistrict(name="Jalna", slug="jalna"),
        models.ProgramDistrict(name="Chandrapur", slug="chandrapur"),
        models.ProgramDistrict(name="Ujjain", slug="ujjain"),
    ])
    db.commit()
    m = _migration("e3a9c4b7d218")
    with db.bind.begin() as conn:
        assert m.set_protocol(conn, *m.NEW) == 1
    db.expire_all()
    rows = {p.slug: (p.visit_protocol, p.pnc_split_days) for p in db.query(models.ProgramDistrict)}
    assert rows == {"chandrapur": ("lap_2026_11", 180), "jalna": ("lap_2025", 150), "ujjain": ("lap_2025", 150)}
    with db.bind.begin() as conn:                                    # the downgrade
        assert m.set_protocol(conn, *m.LEGACY) == 1
    db.expire_all()
    assert db.query(models.ProgramDistrict).filter_by(slug="chandrapur").one().visit_protocol == "lap_2025"


def test_chandrapur_is_found_by_name_and_absent_is_a_no_op(db):
    m = _migration("e3a9c4b7d218")
    with db.bind.begin() as conn:
        assert m.set_protocol(conn, *m.NEW) == 0                    # no such project yet
    db.add(models.ProgramDistrict(name="CHANDRAPUR", slug="chandrapur-district"))
    db.commit()
    with db.bind.begin() as conn:
        assert m.set_protocol(conn, *m.NEW) == 1
    db.expire_all()
    assert db.query(models.ProgramDistrict).one().pnc_split_days == 180


def test_existing_rows_default_to_the_legacy_protocol(db):
    db.add(models.ProgramDistrict(name="Old", slug="old"))
    db.commit()
    p = db.query(models.ProgramDistrict).one()
    assert (p.visit_protocol, p.pnc_split_days) == (VP.LAP_2025, VP.LEGACY_SPLIT_DAYS)


def test_new_projects_default_to_the_new_protocol():
    from app.routers.admin import _new_project_visit_settings

    assert _new_project_visit_settings(None, None, None) == {"visit_protocol": VP.LAP_2026_11, "pnc_split_days": 180}
    state = models.ProgramDistrict(name="State", slug="state", visit_protocol=VP.LAP_2025, pnc_split_days=150)
    assert _new_project_visit_settings(state, None, None) == {"visit_protocol": VP.LAP_2025, "pnc_split_days": 150}
    assert _new_project_visit_settings(None, VP.LAP_2025, 150) == {"visit_protocol": VP.LAP_2025, "pnc_split_days": 150}


def test_an_unknown_protocol_is_refused():
    from fastapi import HTTPException
    from app.routers.admin import _new_project_visit_settings

    with pytest.raises(HTTPException):
        _new_project_visit_settings(None, "lap_1999", None)


def test_a_district_following_its_state_follows_the_states_protocol(db):
    state = models.ProgramDistrict(name="Meghalaya", slug="meghalaya", level="state",
                                   visit_protocol=VP.LAP_2026_11, pnc_split_days=180)
    db.add(state)
    db.flush()
    follows = models.ProgramDistrict(name="Khasi", slug="khasi", parent_id=state.id, inherits_content=True)
    own = models.ProgramDistrict(name="Garo", slug="garo", parent_id=state.id, inherits_content=False)
    db.add_all([follows, own])
    db.commit()
    assert projects.visit_settings(follows) == (VP.LAP_2026_11, 180)
    assert projects.visit_settings(own) == (VP.LAP_2025, 150)
    assert projects.visit_settings_payload(follows)["inherited_from"] == "Meghalaya"
    assert projects.visit_settings(None)[0] == VP.LAP_2025


# ── A worker on the new protocol ───────────────────────────────────────────

TODAY = date.today()


def _cg(child_id, worker_id, on, weight, breastfed="yes"):
    return models.FormResponse(
        form_key="growth_monitoring", child_id=child_id, submitted_by_user_id=worker_id, assessment_date=on,
        status="submitted", created_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
        answers_json=[{"nodeId": "baby_weight", "question": "Baby's weight (kg)", "questionType": "number",
                       "value": str(weight)},
                      {"nodeId": "breastfed_24h", "question": "Was the child breastfed during the past 24 hours?",
                       "questionType": "radio", "value": None, "selected": [{"optionId": breastfed}]}])


def _bf(child_id, worker_id, on, green=("bf_hunger",), red=("bf_prep_wash",)):
    answers = ([{"nodeId": q, "selected": [{"optionId": f"{q}_g", "verdict": "green"}]} for q in green]
               + [{"nodeId": q, "selected": [{"optionId": f"{q}_r", "verdict": "red"}]} for q in red])
    return models.FormResponse(form_key="breastfeeding", child_id=child_id, submitted_by_user_id=worker_id,
                               assessment_date=on, status="submitted", answers_json=answers,
                               summary_json={"green": len(green), "red": len(red), "neutral": 0})


def _mother_form(key, mother_id, worker_id, on, total=20.0, hq=5.0):
    return models.FormResponse(form_key=key, mother_id=mother_id, submitted_by_user_id=worker_id,
                               assessment_date=on, status="submitted", answers_json=[],
                               summary_json={"protein": {"total24": total, "hq24": hq}} if key != "antenatal" else {})


@pytest.fixture()
def world(db):
    pd = models.ProgramDistrict(name="Chandrapur", slug="chandrapur", visit_protocol=VP.LAP_2026_11, pnc_split_days=180)
    db.add(pd)
    db.flush()
    monitor = models.User(email="m@t.mock", full_name="Meena Monitor", is_verified=True, program_district_id=pd.id,
                          role="ASHA", is_batch_monitor=True)
    db.add(monitor)
    db.flush()
    worker = models.User(email="w@t.mock", full_name="Asha Worker", is_verified=True, program_district_id=pd.id,
                         role="ASHA", batch_monitor_id=monitor.id)
    db.add(worker)
    db.flush()
    db.add(models.FaceToFaceSelection(user_id=worker.id, program_district_id=pd.id))
    # A baby adopted yesterday at 10 days old, her day-0 forms done.
    pnc = models.Mother(mother_uid="T-M1", registered_by_user_id=worker.id, mother_name="Pallavi",
                        adoption_date=TODAY - timedelta(days=1))
    # A pregnancy adopted 15 days ago at 33 weeks: today's check is at 35 weeks.
    anc = models.Mother(mother_uid="T-M2", registered_by_user_id=worker.id, mother_name="Sunita",
                        adoption_date=TODAY - timedelta(days=15), lmp=TODAY - timedelta(days=250))
    db.add_all([pnc, anc])
    db.flush()
    child = models.Child(child_uid="T-C1", mother_id=pnc.id, child_name="Riya", dob=TODAY - timedelta(days=11),
                         adoption_date=TODAY - timedelta(days=1), gender="Female", birth_weight=3.2)
    db.add(child)
    db.flush()
    day0 = TODAY - timedelta(days=1)
    db.add_all([_cg(child.id, worker.id, day0, 3.5), _bf(child.id, worker.id, day0),
                _mother_form("mother_protein_intake", pnc.id, worker.id, day0),
                _mother_form("antenatal", anc.id, worker.id, TODAY - timedelta(days=15)),
                _mother_form("mother_protein_intake", anc.id, worker.id, TODAY - timedelta(days=15))])
    db.commit()
    return {"db": db, "pd": pd, "worker": worker, "monitor": monitor, "pnc": pnc, "anc": anc, "child": child}


def test_today_follows_the_new_protocol(world):
    from app import fieldplan

    db, worker, child, anc = world["db"], world["worker"], world["child"], world["anc"]
    view = fieldplan.today_view(db, worker)
    assert view["protocol"] == VP.LAP_2026_11
    groups = {(g["mother_id"], g["child_id"]): g for g in view["today"]}
    baby = groups[(child.mother_id, child.id)]
    assert [f["key"] for f in baby["forms"]] == ["gm", "bf"] and baby["due_on"] == TODAY.isoformat()
    pregnancy = groups[(anc.id, None)]
    assert [f["key"] for f in pregnancy["forms"]] == ["anc", "protein"] and pregnancy["ask_delivery"] is True
    assert view["finish"] == []
    week = {(g["mother_id"], g["child_id"]) for day in view["week"] for g in day["items"]}
    assert (child.mother_id, child.id) in week                         # days 2, 3, 5, 7 are this week


def test_a_visit_begun_today_is_carried_on(world):
    from app import fieldplan

    db, worker, child = world["db"], world["worker"], world["child"]
    db.add(_cg(child.id, worker.id, TODAY, 3.6))
    db.commit()
    view = fieldplan.today_view(db, worker)
    assert [(u["child_id"], u["done"], u["pending"]) for u in view["unfinished"]] == [(child.id, ["gm"], ["bf"])]


def test_the_baby_plan_hides_points_that_dropped_out(world):
    from app.routers.visits import child_visit_plan

    db, worker, child = world["db"], world["worker"], world["child"]
    db.add_all([_cg(child.id, worker.id, TODAY, 3.6), _bf(child.id, worker.id, TODAY)])
    db.commit()
    plan = child_visit_plan(child.id, current_user=worker, db=db)
    assert plan["protocol"] == VP.LAP_2026_11 and plan["bucket"] == "pnc_lt"
    assert plan["bf"]["hidden_questions"] == ["bf_hunger"]        # green in both back-to-back forms
    assert plan["next"]["due_on"] == (TODAY + timedelta(days=1)).isoformat()


def test_counselling_then_drop_out_leaves_today(world):
    from fastapi import HTTPException
    from app import care_alerts, fieldplan
    from app.routers.visits import child_visit_plan, confirm_drop_out, record_counselling

    db, worker, child, pnc = world["db"], world["worker"], world["child"], world["pnc"]
    db.add(_cg(child.id, worker.id, TODAY, 3.6, breastfed="no"))
    db.commit()
    assert child_visit_plan(child.id, current_user=worker, db=db)["feeding"]["state"] == "counsel"
    assert care_alerts.on_feeding_check(db, child.id, worker) == 1
    assert care_alerts.on_feeding_check(db, child.id, worker) == 0, "once per stop"
    with pytest.raises(HTTPException) as refused:
        confirm_drop_out(child.id, current_user=worker, db=db)
    assert refused.value.status_code == 409
    after = record_counselling(child.id, current_user=worker, db=db)
    assert after["feeding"]["state"] == "counselled" and child.bf_counselled_on == TODAY

    # Two visits after the counselling, still not breastfeeding.
    child.bf_counselled_on = TODAY - timedelta(days=6)
    db.query(models.FormResponse).filter(models.FormResponse.child_id == child.id,
                                         models.FormResponse.form_key == "growth_monitoring").delete()
    db.add_all([_cg(child.id, worker.id, TODAY - timedelta(days=6), 3.5, breastfed="no"),
                _cg(child.id, worker.id, TODAY - timedelta(days=3), 3.5, breastfed="no"),
                _cg(child.id, worker.id, TODAY, 3.5, breastfed="no")])
    db.commit()
    plan = confirm_drop_out(child.id, current_user=worker, db=db)
    assert plan["dropout"] == {"on": TODAY.isoformat(), "reason": "not_breastfeeding", "by": "Asha Worker"}
    db.refresh(pnc)
    assert pnc.dropped_out_by_user_id == worker.id
    view = fieldplan.today_view(db, worker)
    assert all(g["mother_id"] != pnc.id for g in view["today"])
    assert all(g["mother_id"] != pnc.id for day in view["week"] for g in day["items"])
    row = next(c for c in view["cases"] if c["mother_id"] == pnc.id)
    assert (row["reason"], row["next"]) == ("dropped_out", None)


def test_a_postnatal_mother_without_her_baby_is_not_planned_as_a_pregnancy(world):
    from app import fieldplan

    db, worker = world["db"], world["worker"]
    m = models.Mother(mother_uid="T-M3", registered_by_user_id=worker.id, mother_name="Kavita",
                      adoption_date=TODAY, declared_adoption_type="pnc_lt5")
    db.add(m)
    db.commit()
    view = fieldplan.today_view(db, worker)
    assert all(g["mother_id"] != m.id for g in view["today"])
    assert {"mother_id": m.id, "mother_name": "Kavita", "missing": "baby", "then": ["protein"]} in view["finish"]


def test_another_learners_baby_is_refused_with_404(world):
    from fastapi import HTTPException
    from app.routers.visits import child_visit_plan

    with pytest.raises(HTTPException) as refused:
        child_visit_plan(world["child"].id, current_user=world["monitor"], db=world["db"])
    assert refused.value.status_code == 404


def test_the_monitor_counts_visits_by_the_new_protocol(world):
    from app.routers.dashboard import my_team

    rows = my_team(current_user=world["monitor"], db=world["db"])["learners"]
    assert [(r["id"], r["due_today"], r["late_visits"]) for r in rows] == [(world["worker"].id, 2, 0)]


def test_a_legacy_project_keeps_its_today(world):
    from app import fieldplan
    from app.routers.visits import child_visit_plan

    db, pd = world["db"], world["pd"]
    pd.visit_protocol, pd.pnc_split_days = VP.LAP_2025, 150
    db.commit()
    view = fieldplan.today_view(db, world["worker"])
    assert view["protocol"] == VP.LAP_2025
    assert all("ask_delivery" not in g for g in view["today"])
    assert child_visit_plan(world["child"].id, current_user=world["worker"], db=db) == {
        "protocol": VP.LAP_2025, "pnc_split_days": 150}
