"""The launch review of 19 Oct 2026: the health worker's simple screens.

* The baby's status in words and colour — percentiles, a traffic light at
  −1 / −1.5 SD, and "see within 2 days" when the weight fell or stopped rising.
* What to do today: forms due or late per mother / baby, late since the form
  LAST fell due, from the same rules as the MASD dashboard.
* Care prompts after a growth check (worker + batch monitor), never twice;
  the scheduled reminders' windows.
* The batch monitor's "whom to call" counts.
* Admins see record IDs, not names (ADMIN_PATIENT_NAMES puts them back).
* Faltering lists the mildly underweight and compares with the visit before.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_launch_review_2026_10_19.py -v
"""
from __future__ import annotations

import base64
import os
import tempfile
from datetime import date, datetime, timedelta, timezone

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import care_alerts, faltering, fieldplan, models  # noqa: E402
from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402
from app.masd import engine as E  # noqa: E402
from app.routers import growth  # noqa: E402
from app.security import pseudonym  # noqa: E402
import app.models_live  # noqa: F401,E402
import app.models_security  # noqa: F401,E402

AS_OF = date(2026, 9, 29)


# ── The baby's status ──────────────────────────────────────────────────────

def _case(*visits, gender="Female"):
    return {"child": {"id": 1, "uid": "CR-1", "name": "Riya", "gender": gender},
            "visits": [{"date": d, "age_days": a, "weight": w, "length": ln} for d, a, w, ln in visits]}


def test_percentile_and_traffic_light():
    assert fieldplan.percentile(0) == 50
    assert fieldplan.percentile(-1) == 16 and fieldplan.percentile(1) == 84
    assert fieldplan.percentile(-5) == 1 and fieldplan.percentile(5) == 99
    assert [fieldplan.tone(z) for z in (0, -1, -1.2, -1.5, -1.6)] == ["green", "green", "yellow", "yellow", "red"]
    assert fieldplan.percentile(None) is None and fieldplan.tone(None) is None


def test_weight_down_since_the_last_visit_is_red_and_urgent():
    st = fieldplan.baby_status(_case(("2026-08-01", 60, 5.0, 57.0), ("2026-09-01", 91, 4.9, 58.5)))
    assert st["status"] == "red"
    assert st["reasons"][0] == "weight_fell"
    assert st["see_within_days"] == 2
    assert st["previous"]["weight"] == 5.0 and st["latest"]["weight"] == 4.9


def test_a_fall_on_the_chart_is_stagnation_even_with_a_gain():
    st = fieldplan.baby_status(_case(("2026-08-01", 60, 5.0, 57.0), ("2026-09-01", 91, 5.2, 59.5)))
    assert "not_gaining" in st["reasons"] and "weight_fell" not in st["reasons"]
    assert st["status"] in ("yellow", "red") and st["see_within_days"] == 2
    assert st["latest"]["wfa"]["pct"] < st["previous"]["wfa_pct"]


def test_a_baby_growing_along_the_curve_is_green():
    st = fieldplan.baby_status(_case(("2026-08-01", 60, 5.0, 57.0), ("2026-09-01", 91, 5.9, 60.0)))
    assert st["status"] == "green" and st["reasons"] == [] and st["see_within_days"] is None
    assert st["latest"]["wfl"]["grade"] == "normal"


def test_short_length_alone_shows_but_is_not_an_emergency():
    st = fieldplan.baby_status(_case(("2026-09-01", 91, 5.9, 52.0)))
    assert "low_lfa" in st["reasons"] and st["status"] == "red"
    assert st["see_within_days"] is None


def test_no_growth_check_yet():
    st = fieldplan.baby_status(_case())
    assert (st["status"], st["reasons"], st["latest"]) == ("none", ["no_growth_check"], None)


def test_a_visit_is_a_growth_check_and_the_feeding_form_for_the_age():
    assert fieldplan._baby_forms(30) == ["gm", "bf"]
    assert fieldplan._baby_forms(194) == ["gm", "bf"]
    assert fieldplan._baby_forms(195) == ["gm", "cf"]
    assert fieldplan._baby_forms(None) == ["gm", "bf"]


# ── What to do today (engine.field_plan) ───────────────────────────────────

def test_field_plan_lists_late_and_coming_forms_per_mother():
    from test_masd import _project

    data = _project()
    plan = E.field_plan(data, AS_OF, 1, horizon_days=7)
    own = {m.id for m in data.mothers if m.learner_id == 1}
    assert plan and set(plan) <= own
    for items in plan.values():
        for i in items:
            due = date.fromisoformat(i["due_on"])
            if i["missing"]:
                assert due <= AS_OF and i["late_days"] == (AS_OF - due).days
            else:
                assert AS_OF < due <= AS_OF + timedelta(days=7) and i["late_days"] == 0
    assert E.field_plan(data, AS_OF, 3) == {}          # no mothers
    assert E.field_plan(data, AS_OF, 99) == {}         # no such learner


def test_doing_a_late_form_today_takes_it_off_the_list():
    from test_masd import _project

    data = _project()
    plan = E.field_plan(data, AS_OF, 1)
    mother, item = next((m, i) for m, items in plan.items() for i in items if i["missing"])
    child = next((c.id for c in data.children if c.mother_id == mother), None)
    form = {"gm": "growth_monitoring", "bf": "breastfeeding", "cf": "complementary_feeding",
            "anc": "antenatal", "protein": "mother_protein_intake"}[item["key"]]
    child_form = item["key"] in ("gm", "bf", "cf")
    data.activities.append(E.ActivityIn(form, 1, AS_OF, child_id=child if child_form else None,
                                        mother_id=None if child_form else mother))
    after = next((i for i in E.field_plan(data, AS_OF, 1).get(mother, []) if i["key"] == item["key"]), None)
    assert after is None or after["missing"] == item["missing"] - 1


def test_late_counts_from_the_last_due_date_not_the_first():
    """A visit missed in July cannot be made up — the worker is told about the
    one due now, not "114 days late"."""
    from test_masd import _project

    data = _project()
    for items in E.field_plan(data, AS_OF, 1).values():
        for i in items:
            if i["missing"] > 1:
                anchor_gap = (AS_OF - date(2026, 6, 10)).days
                assert i["late_days"] < anchor_gap


# ── A small database: a worker, her batch monitor, a baby losing weight ────

@pytest.fixture()
def world():
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()
    pd = models.ProgramDistrict(name="Demo", slug="demo")
    db.add(pd)
    db.flush()
    monitor = models.User(email="m@t.mock", full_name="Meena Monitor", is_verified=True, program_district_id=pd.id,
                          role="ASHA", is_batch_monitor=True)
    db.add(monitor)
    db.flush()
    worker = models.User(email="w@t.mock", full_name="Asha Worker", is_verified=True, program_district_id=pd.id,
                         role="ASHA", batch_monitor_id=monitor.id, phone="9876500001")
    db.add(worker)
    db.flush()
    db.add_all([models.FaceToFaceSelection(user_id=u.id, program_district_id=pd.id) for u in (worker, monitor)])
    mother = models.Mother(mother_uid="T-M1", registered_by_user_id=worker.id, mother_name="Pallavi",
                           adoption_date=date(2026, 6, 10))
    db.add(mother)
    db.flush()
    child = models.Child(child_uid="T-C1", mother_id=mother.id, child_name="Riya", dob=date(2026, 6, 5),
                         adoption_date=date(2026, 6, 10), gender="Female", birth_weight=3.0, birth_length=49.0)
    db.add(child)
    db.flush()
    for on, w, ln in ((date(2026, 6, 10), "3.1", "49.5"), (date(2026, 8, 10), "5.0", "57.0"),
                      (date(2026, 9, 20), "4.8", "58.0")):
        db.add(models.FormResponse(
            form_key="growth_monitoring", child_id=child.id, submitted_by_user_id=worker.id,
            assessment_date=on, status="submitted",
            answers_json=[{"nodeId": "baby_weight", "question": "Baby's weight (kg)", "questionType": "number", "value": w},
                          {"nodeId": "baby_length", "question": "Baby's length (cm)", "questionType": "number", "value": ln}],
            created_at=datetime(2026, 9, 20, tzinfo=timezone.utc),
        ))
    db.commit()
    yield {"db": db, "worker": worker, "monitor": monitor, "mother": mother, "child": child}
    db.close()
    engine.dispose()
    os.unlink(path)


def test_today_puts_the_baby_first_and_asks_for_the_protein_form(world):
    db, worker, child, mother = world["db"], world["worker"], world["child"], world["mother"]
    view = fieldplan.today_view(db, worker, AS_OF)
    assert view["available"] and view["project"]["slug"] == "demo"
    assert [u["child_id"] for u in view["urgent"]] == [child.id]
    assert view["urgent"][0]["reasons"][0] == "weight_fell" and view["urgent"][0]["forms"] == ["gm", "bf"]
    assert view["finish"] == [{"mother_id": mother.id, "mother_name": "Pallavi", "missing": "protein", "then": []}]
    row = view["cases"][0]
    assert (row["mother_id"], row["status"], row["reason"]) == (mother.id, "red", "weight_fell")
    assert row["children"][0]["latest"]["wfa"]["pct"] is not None
    assert all(g["mother_id"] == mother.id for g in view["today"])

    db.add(models.FormResponse(form_key="mother_protein_intake", mother_id=mother.id, submitted_by_user_id=worker.id,
                               assessment_date=AS_OF, status="submitted", answers_json=[]))
    db.commit()
    assert fieldplan.today_view(db, worker, AS_OF)["finish"] == []


def test_today_only_shows_her_own_mothers(world):
    assert fieldplan.today_view(world["db"], world["monitor"], AS_OF)["cases"] == []


def test_a_growth_check_that_fell_prompts_the_worker_and_her_monitor_once(world):
    db, worker, child, monitor = world["db"], world["worker"], world["child"], world["monitor"]
    assert care_alerts.on_growth_check(db, child.id, worker) == 2
    notes = {n.user_id: n for n in db.query(models.Notification)}
    assert set(notes) == {worker.id, monitor.id}
    assert notes[worker.id].link == f"/babies/{child.id}" and "Riya" in notes[worker.id].title
    # The monitor is a fellow learner: the baby by record ID, never by name.
    assert "T-C1" in notes[monitor.id].message and "Riya" not in notes[monitor.id].message
    assert "Asha" in notes[monitor.id].message
    assert care_alerts.on_growth_check(db, child.id, worker) == 0, "the same prompt never goes twice"
    assert db.query(models.CareAlert).count() == 2


def test_a_healthy_check_sends_nothing(world):
    db, worker, child = world["db"], world["worker"], world["child"]
    db.add(models.FormResponse(
        form_key="growth_monitoring", child_id=child.id, submitted_by_user_id=worker.id,
        assessment_date=date(2026, 9, 28), status="submitted",
        answers_json=[{"nodeId": "baby_weight", "question": "Baby's weight (kg)", "questionType": "number", "value": "6.4"},
                      {"nodeId": "baby_length", "question": "Baby's length (cm)", "questionType": "number", "value": "61.0"}],
        created_at=datetime(2026, 9, 28, tzinfo=timezone.utc)))
    db.commit()
    assert care_alerts.on_growth_check(db, child.id, worker) == 0


def test_reminder_windows_and_the_escalation(world, monkeypatch):
    db, worker, monitor = world["db"], world["worker"], world["monitor"]
    monkeypatch.setattr(settings, "CARE_ESCALATE_AFTER_DAYS", 3)
    view = {"today": [{"mother_name": "Pallavi", "child_name": "Riya", "late_days": 5}]}
    ist = care_alerts.IST
    morning = datetime(2026, 9, 29, 8, 0, tzinfo=ist)
    assert care_alerts.remind_learner(db, worker, view, morning) == 1
    assert care_alerts.remind_learner(db, worker, view, morning) == 0
    assert care_alerts.remind_learner(db, worker, view, datetime(2026, 9, 29, 12, 0, tzinfo=ist)) == 1  # escalation
    assert care_alerts.remind_learner(db, worker, view, datetime(2026, 9, 29, 19, 0, tzinfo=ist)) == 1  # evening
    db.commit()
    esc = db.query(models.Notification).filter(models.Notification.user_id == monitor.id).one()
    assert "Kindly give Asha a call" in esc.message
    assert care_alerts.remind_learner(db, worker, {"today": []}, morning) == 0


def test_scheduled_reminders_are_off_unless_switched_on(world, monkeypatch):
    monkeypatch.setattr(settings, "CARE_REMINDERS_ENABLED", False)
    assert care_alerts.run_reminders(world["db"], datetime(2026, 9, 29, 3, 0, tzinfo=timezone.utc)) == 0


def test_the_monitor_sees_whom_to_call(world):
    from app.routers.dashboard import my_team

    rows = my_team(current_user=world["monitor"], db=world["db"])["learners"]
    assert [r["id"] for r in rows] == [world["worker"].id]
    r = rows[0]
    assert r["urgent_babies"] == 1 and r["needs_call"] is True
    assert r["phone"] == "9876500001"
    assert {"late_visits", "due_today"} <= set(r)


# ── Admins see record IDs ──────────────────────────────────────────────────

def _admin_case():
    return {"child": {"id": 1, "uid": "CR-1", "name": "Riya"}, "mother": {"id": 2, "uid": "MR-2", "name": "Pallavi"},
            "visits": []}


def test_admin_views_carry_record_ids_not_names(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_PATIENT_NAMES", False)
    c = pseudonym.case(_admin_case())
    assert (c["child"]["name"], c["mother"]["name"]) == ("CR-1", "MR-2")
    d = pseudonym.case_detail({**_admin_case(), "mother": {"id": 2, "uid": "MR-2", "name": "Pallavi", "mobile": "98"},
                               "visits": [{"responses": [{"child_name": "Riya", "mother_name": None}]}],
                               "mother_forms": [{"child_name": None, "mother_name": "Pallavi"}]})
    assert "mobile" not in d["mother"] and d["mother"]["name"] == "MR-2"
    assert d["visits"][0]["responses"][0]["child_name"] == "CR-1"
    assert d["mother_forms"][0]["mother_name"] == "MR-2"
    row = pseudonym.falter_row({"mother": {"name": "Pallavi", "uid": "MR-2"}, "child": {"name": "Riya", "uid": "CR-1"}})
    assert (row["mother"]["name"], row["child"]["name"]) == ("MR-2", "CR-1")


def test_the_programme_can_show_names_again(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_PATIENT_NAMES", True)
    assert pseudonym.case(_admin_case()) == _admin_case()


# ── Faltering ──────────────────────────────────────────────────────────────

def _row(cats=None):
    names = growth.Z_CATEGORY_NAMES
    return {"categories": {m: {"lv": (cats or {}).get(m, names[m][0])} for m in names}}


def test_mild_underweight_is_listed():
    names = growth.Z_CATEGORY_NAMES
    flags, _change, _pct = faltering._flags(_row({"wfaz": names["wfaz"][1]}), _case(("2026-09-01", 91, 5.0, 60.0)))
    assert "mild" in flags


def test_faltering_compares_with_the_visit_before():
    flags, change, pct = faltering._flags(_row(), _case(("2026-08-01", 60, 5.0, 57.0), ("2026-09-01", 91, 5.2, 59.5)))
    assert "faltering" in flags and change == 200      # gained 200 g, but fell on the chart
    assert pct["now"] < pct["before"]


# ── A batch monitor to sign in as, for the demo ────────────────────────────

def test_demo_monitor_gets_a_password_and_undo_puts_it_back(world, monkeypatch):
    from scripts import demo_accounts

    db, monitor, worker = world["db"], world["monitor"], world["worker"]
    pd = db.get(models.ProgramDistrict, monitor.program_district_id)
    pd.slug = "chandrapur"
    for u in (monitor, worker):
        u.email = u.email.replace("@t.mock", "@nurturehub.mock")
    monitor.phone = "9876500002"
    monitor.password_hash = "old-hash"
    db.commit()

    assert demo_accounts.pick_monitor(db).id == monitor.id
    monkeypatch.setattr(demo_accounts.getpass, "getpass", lambda prompt="": "demo-pass-123")
    demo_accounts.prepare_monitor(db)
    db.refresh(monitor)
    assert monitor.password_hash != "old-hash"
    with pytest.raises(SystemExit):
        demo_accounts.prepare_monitor(db)          # once only, until undo
    demo_accounts.undo(db)
    db.refresh(monitor)
    assert monitor.password_hash == "old-hash"
    assert db.get(models.MasdRuleTable, demo_accounts.MONITOR_KEY) is None


def test_demo_monitor_refuses_without_a_synthetic_monitor(world):
    from scripts import demo_accounts

    db = world["db"]
    db.get(models.ProgramDistrict, world["monitor"].program_district_id).slug = "chandrapur"
    db.commit()
    assert demo_accounts.pick_monitor(db) is None      # @t.mock is not a synthetic account
    with pytest.raises(SystemExit):
        demo_accounts.prepare_monitor(db)
