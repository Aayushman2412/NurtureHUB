"""What the reviews of 6 and 7 Oct 2026 asked for, held to it.

  * three levels of expected activity: the ideal for the targets, the
    expected for the adoptions actually taken, and each case by its dates;
  * nil-activity days as median and interquartile range; "no adoptions" and
    "adoptions but no activity" never overlap;
  * uptake for the rest of the learners and Staff Nurses, adoption by
    adoption; a cumulative expected-vs-actual series that ends on the target
    and the ideal;
  * PNC cases with follow-up issues, the declared adoption type checked
    against the dates, exclusions per learner, mother education and delivery
    place × method;
  * training batches with start dates and trainers (phones sealed, kept out
    of the audit trail), assigned from an Excel, and every learner's support
    team;
  * the date contradictions the analysts drop dyads for cannot be entered.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_review_2026_10_06.py -v
"""
from __future__ import annotations

import base64
import json
import os
import tempfile
from datetime import date, timedelta
from io import BytesIO

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from fastapi import HTTPException  # noqa: E402
from openpyxl import Workbook  # noqa: E402

from app import entry_checks  # noqa: E402
from app.masd import engine as E  # noqa: E402
from app.masd import rules as R  # noqa: E402
from tests.test_masd import AS_OF, _learner, _project  # noqa: E402


@pytest.fixture()
def report():
    return E.compute(_project(), AS_OF)


# ── Expected activity, three levels ─────────────────────────────────────────


def test_level_two_reads_the_adoptions_actually_taken(report):
    one = _learner(report, 1)
    t = R.default_expected_forms()
    trs = R.tranches(E.target_steps(_project(), E.calendar(_project())), AS_OF, None)
    # Learner 1: 1 ANC, 4 PNC<5M, 1 PNC≥5M. Each type fills its tranche slots in
    # order (1 per tranche per type here); the extras count at the latest tranche.
    expect = 0
    for atype, n in ((R.ANC, 1), (R.PNC_LT5, 4), (R.PNC_GE5, 1)):
        slots = [tr for tr in trs for _ in range(R.learner_targets(tr["added"], False)[atype])]
        for j in range(n):
            tr = slots[j] if j < len(slots) else trs[-1]
            expect += sum(R.expected_at(t, R.row_type(atype, False), tr["fu_days"]).values())
    assert one["undertaken"]["expected"]["total"] == expect
    assert one["undertaken"]["actual"] == one["own"]["actual"]["total"]
    assert _learner(report, 3)["undertaken"]["expected"]["total"] == 0, "no adoptions, nothing expected at level 2"
    s = report["summary"]
    assert s["undertaken_expected"] == sum(r["undertaken"]["expected"]["total"] for r in report["learners"] if r["f2f"])


def test_nil_days_median_and_exclusive_boxes(report):
    s = report["summary"]
    nil = sorted(r["nil_days"] for r in report["learners"] if r["f2f"] and r["nil_days"] is not None)
    assert s["nil_days_median"] == E._quartiles(nil)["median"]
    assert E._quartiles([1, 2, 3, 4, 100]) == {"median": 3, "q1": 2, "q3": 4, "n": 5}, "the outlier does not move the middle"
    assert s["zero_adoptions"] + s["adopted_no_activity"] <= s["learners"]
    assert s["adopted_no_activity"] == sum(1 for r in report["learners"] if r["f2f"]
                                           and r["adoptions"]["total"] > 0 and r["activities"]["total"] == 0)


def test_per_activity_detail_by_type(report):
    pnc = _learner(report, 1)["by_type"][R.PNC_LT5]
    assert sum(pnc["expected_by"].values()) == pnc["expected"]
    assert sum(pnc["actual_by"].values()) == pnc["actual"]


# ── Uptake and the cumulative series ────────────────────────────────────────


def test_uptake_by_group_and_adoption_by_adoption(report):
    first = report["uptake"][0]
    g = first["groups"]
    assert g["all"]["learners"] == g["rol"]["learners"] + g["sn"]["learners"]
    assert g["sn"]["learners"] == 1, "the Staff Nurse on their own"
    nth = g["rol"]["nth"]
    assert [n["n"] for n in nth] == list(range(1, len(nth) + 1))
    assert nth[0]["done"] == g["rol"]["started"], "the first adoption is when a learner started"


def test_cumulative_steps_up_when_a_tranche_opens(report):
    """Review of 12 Oct 2026: a tranche's whole ask is due the day its buffer
    ends — a vertical rise, not a ramp — and its forms then fall due day by
    day on the LAP schedule."""
    days = report["cumulative"]["days"]
    assert days[-1]["date"] == AS_OF.isoformat()
    assert days[-1]["expected_adoptions"] == report["summary"]["target"], "every tranche long since taken by now"
    assert days[-1]["expected_activities"] >= report["summary"]["ideal"], "day by day, never rounded down to 15"
    for a, b in zip(days, days[1:]):
        assert b["expected_adoptions"] >= a["expected_adoptions"] and b["adoptions"] >= a["adoptions"]
        assert b["expected_activities"] >= a["expected_activities"]
    clocks = {m["clock_from"] for m in report["cumulative"]["tranches"] if m["clock_from"]}
    jumps = [(a, b) for a, b in zip(days, days[1:]) if b["expected_adoptions"] > a["expected_adoptions"]]
    assert jumps and all(b["date"] in clocks for _, b in jumps), "the expected line only rises on a tranche's clock day"


def test_expected_on_day_follows_the_lap_schedule():
    t = R.default_expected_forms()
    assert R.expected_on_day(t, R.PNC_LT5, 0) == {"gm": 1, "bf": 1}, "the adoption visit"
    assert R.expected_on_day(t, R.PNC_LT5, 3) == {"gm": 4, "bf": 2}
    assert R.expected_on_day(t, R.PNC_LT5, 15) == R.expected_at(t, R.PNC_LT5, 15), "meets the table at each step"
    assert R.expected_on_day(t, R.NURSE, 200) == {"gm": 6, "bf": 5}, "a Staff Nurse's flat row caps it"
    assert R.expected_on_day(t, R.PNC_GE5, 14)["cf"] == 0 and R.expected_on_day(t, R.PNC_GE5, 15)["cf"] == 1


def test_cumulative_narrows_to_learners_and_kind():
    data = _project()
    r = E.compute(data, AS_OF)
    cal = E.calendar(data)
    steps = E.target_steps(data, cal)
    ads = E.adoptions_of(data, steps, AS_OF)
    acts = [a for a in data.activities if a.on <= AS_OF]
    args = (data, r["learners"], ads, acts, steps, cal, data.expected_forms, AS_OF)
    nurse = E.cumulative(*args, kind="sn")
    assert nurse["days"][-1]["adoptions"] == 1, "the Staff Nurse's one case"
    only_one = E.cumulative(*args, learner_ids=[1], per_case=True)
    end = only_one["days"][-1]
    assert end["adoptions"] == 6 and end["expected_cases"] == _learner(r, 1)["own"]["expected"]["total"]
    anc = E.cumulative(*args, learner_ids=[1], kind="anc")
    assert anc["days"][-1]["adoptions"] == 1 and anc["days"][-1]["activities"] == 4


def test_levels_example_reads_the_project_table(report):
    ex = report["levels_example"]
    assert ex["level1"] == sum(tr["community"]["total"] for tr in report["calendar"]["tranches"])
    assert ex["level2"] == sum(c["level2"] for c in ex["cases"]) and ex["level3"] > 0
    assert {c["type"] for c in ex["cases"]} <= set(R.ADOPTION_TYPES)


# ── Flags ───────────────────────────────────────────────────────────────────


def test_pnc_cases_with_follow_up_issues(report):
    pnc = report["flags"]["pnc"]
    assert pnc, "the demo's babies are behind the LAP schedule"
    for item in pnc:
        assert item["visits_missed"] >= R.FLAG_PNC_MISSED or item["days_since_visit"] >= R.FLAG_PNC_SILENT_DAYS
        assert item["visits_missed"] == max(0, item["visits_due"] - item["visits_done"])
        assert item["type"] in R.ADOPTION_TYPES
    assert report["flags"]["pnc_summary"]["flagged"] == len(pnc)


def test_declared_type_mismatch_is_flagged_for_learner_and_monitor():
    data = _project()
    data.mothers[0].declared_type = R.ANC        # mother 1 is PNC <5M by the dates
    data.mothers[1].declared_type = R.ANC        # mother 2 is ANC: agrees
    r = E.compute(data, AS_OF)
    mism = r["flags"]["type_mismatch"]
    assert [(m["mother_id"], m["declared"], m["computed"]) for m in mism] == [(1, R.ANC, R.PNC_LT5)]
    assert _learner(r, 1)["declared_mismatch"] == 1


# ── Outcomes ────────────────────────────────────────────────────────────────


def test_exclusions_per_learner_add_up(report):
    o = report["outcomes"]
    per = o["by_learner"]
    assert sum(v["eligible"] for v in per.values()) == o["exclusions"]["total"]["total"]
    assert sum(v["included"] for v in per.values()) == o["exclusions"]["included"]["total"]
    for key, *_ in R.EXCLUSION_REASONS:
        total = next(x["total"] for x in o["exclusions"]["reasons"] if x["key"] == key)
        assert sum(v["reasons"].get(key, 0) for v in per.values()) == total


def test_mother_profile_has_education_and_place_by_method():
    data = _project()
    for m in data.mothers:
        m.education = "Graduate"
    o = E.compute(data, AS_OF)["outcomes"]["demographics"]
    assert list(o)[:3] == ["n", "mother_age", "education"]
    assert o["education"][0]["label"] == "Graduate"
    assert sum(o["place_by_method"]["counts"].values()) == o["n"]


def test_then_vs_now_carries_counts_and_median():
    data = _project()
    then = E.compute(data, date(2026, 8, 15))
    now = E.compute(data, AS_OF)
    c = E.comparison(then, now)
    for key in ("activities", "ideal", "undertaken_expected", "nil_days_median", "nil_days_q1", "nil_days_q3"):
        assert key in c["now"]


# ── Batches, trainers and the support team (database) ───────────────────────


@pytest.fixture()
def world():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.models_live  # noqa: F401
    import app.models_security  # noqa: F401
    from app import models
    from app.database import Base

    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()
    pd = models.ProgramDistrict(name="Demo", slug="demo")
    db.add(pd)
    db.flush()
    a = models.User(email="a@t.mock", full_name="Asha A", is_verified=True, program_district_id=pd.id, role="ASHA")
    b = models.User(email="b@t.mock", full_name="Asha B", is_verified=True, program_district_id=pd.id, role="ASHA",
                    phone="9876543210", is_batch_monitor=True)
    c = models.User(email="c@t.mock", full_name="Not Trained", is_verified=True, program_district_id=pd.id, role="ASHA")
    db.add_all([a, b, c])
    db.flush()
    a.batch_monitor_id = b.id
    db.add_all([models.FaceToFaceSelection(user_id=a.id, program_district_id=pd.id),
                models.FaceToFaceSelection(user_id=b.id, program_district_id=pd.id)])
    db.commit()
    yield db, pd, a, b, c
    db.close()


def test_batches_keep_start_dates_and_trainers_but_not_in_the_audit(world):
    from sqlalchemy import text

    from app.models_security import AuditEvent
    from app.routers.masd import SettingsIn, get_settings, put_settings

    db, pd, *_ = world
    put_settings(SettingsIn(batches=[{
        "name": "Batch 1", "start_date": "2026-06-08", "end_date": "2026-06-11",
        "trainers": [{"name": "Dr Rao", "phone": "+91 98765 43210", "role": "Trainer"},
                     {"name": "Ms Iyer", "phone": None, "role": "Assistant trainer"}],
    }]), project="demo", admin_email="admin@t", db=db)
    out = get_settings(project="demo", db=db)["batches"][0]
    assert out["start_date"] == "2026-06-08"
    assert out["trainers"][0] == {"name": "Dr Rao", "phone": "9876543210", "role": "Trainer"}
    raw = db.execute(text("SELECT trainers FROM masd_training_batches")).scalar()
    assert "9876543210" not in raw and "Dr Rao" not in raw, "trainers' phones are sealed at rest"
    trail = json.dumps([e.detail for e in db.query(AuditEvent).all()], default=str)
    assert "Dr Rao" in trail and "9876543210" not in trail, "the trail names the trainers, never their phones"
    with pytest.raises(ValueError):
        SettingsIn(batches=[{"name": "B", "start_date": "2026-06-12", "end_date": "2026-06-11"}])
    with pytest.raises(ValueError):
        SettingsIn(batches=[{"name": "B", "end_date": "2026-06-11", "trainers": [{"name": "X", "phone": "123"}]}])


def _xlsx(rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


class _Upload:
    def __init__(self, buf):
        self._buf = buf

    async def read(self):
        return self._buf.getvalue()


def test_batches_assigned_from_an_excel_after_a_check(world):
    import asyncio

    from app import models
    from app.routers.masd import SettingsIn, batch_assign_upload, put_settings

    db, pd, a, b, c = world
    put_settings(SettingsIn(batches=[{"name": "Batch 1", "end_date": "2026-06-11"},
                                     {"name": "Batch 2", "end_date": "2026-06-18"}]),
                 project="demo", admin_email="admin@t", db=db)
    rows = [["User ID", "Name", "Batch"], [a.id, "Asha A", 2], [b.id, "Asha Bee", "Batch 1"],
            [c.id, "Not Trained", 1], [9999, "Nobody", 1], [a.id, "Asha A", 1]]
    run = lambda apply: asyncio.run(batch_assign_upload(  # noqa: E731
        project="demo", apply=apply, file=_Upload(_xlsx(rows)), admin_email="admin@t", db=db))
    check = run(False)
    assert [r["status"] for r in check["rows"]] == ["assign", "assign", "error", "error", "error"]
    assert "Name differs" in check["rows"][1]["message"]
    assert "not selected for face-to-face" in check["rows"][2]["message"]
    assert "earlier row" in check["rows"][4]["message"]
    assert db.query(models.FaceToFaceSelection).filter_by(user_id=a.id).first().batch_id is None, "a check changes nothing"
    done = run(True)
    assert done["summary"]["assigned"] == 2
    sel = {s.user_id: s.batch.name for s in db.query(models.FaceToFaceSelection).all() if s.batch}
    assert sel == {a.id: "Batch 2", b.id: "Batch 1"}
    again = run(False)
    assert [r["status"] for r in again["rows"][:2]] == ["unchanged", "unchanged"]


def test_support_team_shows_monitor_and_trainers(world):
    from app import models
    from app.routers.masd import SettingsIn, put_settings
    from app.routers.users import my_support_team

    db, pd, a, b, c = world
    put_settings(SettingsIn(batches=[{"name": "Batch 1", "end_date": "2026-06-11",
                                      "trainers": [{"name": "Dr Rao", "phone": "9876500000", "role": "Trainer"}]}]),
                 project="demo", admin_email="admin@t", db=db)
    batch = db.query(models.MasdTrainingBatch).first()
    for s in db.query(models.FaceToFaceSelection).all():
        s.batch_id = batch.id
    db.commit()
    mine = my_support_team(current_user=a, db=db)
    assert mine["monitor"]["name"] == "Asha B" and mine["monitor"]["phone"] == "9876543210"
    assert mine["trainers"] == [{"name": "Dr Rao", "phone": "9876500000", "role": "Trainer"}]
    theirs = my_support_team(current_user=b, db=db)
    assert theirs["is_monitor"] and [p["name"] for p in theirs["watching"]] == ["Asha A"]
    assert my_support_team(current_user=c, db=db)["batch"] is None


# ── Entries that must not happen in NurtureHUB ──────────────────────────────


def test_dates_that_contradict_each_other_are_refused(world):
    from app import models

    db, pd, a, *_ = world
    mother = models.Mother(mother_uid="M1", registered_by_user_id=a.id, mother_name="M", adoption_date=date(2026, 6, 10))
    db.add(mother)
    db.flush()
    with pytest.raises(HTTPException) as e:
        entry_checks.child_adoption(mother, date(2026, 6, 9))
    assert e.value.status_code == 400 and "before the mother" in e.value.detail
    entry_checks.child_adoption(mother, date(2026, 6, 10))

    child = models.Child(child_uid="C1", mother_id=mother.id, child_name="C", dob=date(2026, 6, 1),
                         adoption_date=date(2026, 6, 12), birth_weight=3.0)
    db.add(child)
    db.flush()
    db.add(models.FormResponse(form_key="growth_monitoring", child_id=child.id, submitted_by_user_id=a.id,
                               assessment_date=date(2026, 6, 12), status="submitted", answers_json=[]))
    db.flush()
    with pytest.raises(HTTPException) as e:
        entry_checks.mother_adoption(db, mother, date(2026, 6, 13))
    assert "baby" in e.value.detail
    child.adoption_date = date(2026, 6, 20)
    db.flush()
    with pytest.raises(HTTPException) as e:
        entry_checks.mother_adoption(db, mother, date(2026, 6, 13))
    assert "visit recorded on 12 Jun 2026" in e.value.detail
    entry_checks.mother_adoption(db, mother, date(2026, 6, 11))

    child.mother = mother
    with pytest.raises(HTTPException) as e:
        entry_checks.assessment_date(date(2026, 6, 19), child=child)
    assert "before the baby was adopted" in e.value.detail
    with pytest.raises(HTTPException):
        entry_checks.assessment_date(date(2026, 6, 9), mother=mother)
    entry_checks.assessment_date(date(2026, 6, 20), child=child)


def test_first_weighing_must_agree_with_the_birth_weight(world):
    from app import models

    child = models.Child(child_uid="C", child_name="C", dob=date(2026, 6, 1), birth_weight=3.0)
    weigh = lambda v: [{"nodeId": "baby_weight", "question": "Baby's weight (kg)", "questionType": "number", "value": v}]  # noqa: E731
    with pytest.raises(HTTPException) as e:
        entry_checks.birth_weight(child, date(2026, 6, 3), weigh("3.6"))
    assert "differs from the birth weight" in e.value.detail
    entry_checks.birth_weight(child, date(2026, 6, 3), weigh("2.8"))
    entry_checks.birth_weight(child, date(2026, 6, 1) + timedelta(days=R.BIRTH_VISIT_WINDOW_DAYS + 1), weigh("3.6"))


def test_pnc_mother_registers_without_a_recent_lmp():
    from app.schemas import MotherCreate

    today = date.today()
    base = {"mother_name": "Test Mother", "adoption_date": today.isoformat()}
    MotherCreate(**base, declared_adoption_type="pnc_lt5", lmp=(today - timedelta(days=330)).isoformat())
    MotherCreate(**base, declared_adoption_type="pnc_ge5")
    with pytest.raises(ValueError):
        MotherCreate(**base, declared_adoption_type="anc", lmp=(today - timedelta(days=330)).isoformat())
    with pytest.raises(ValueError):
        MotherCreate(**base, declared_adoption_type="twins")


def test_cumulative_route_answers_for_filtered_learners(world):
    """The chart's own endpoint (review of 12 Oct 2026): any learner subset,
    any kind, aggregate counts only."""
    from app.routers.masd import CumulativeIn, masd_cumulative

    db, pd, a, b, c = world
    out = masd_cumulative(CumulativeIn(learner_ids=[a.id], kind="pnc_lt5"), project="demo", db=db)
    assert out["learners"] == 1 and out["kind"] == "pnc_lt5" and isinstance(out["days"], list)
    with pytest.raises(ValueError):
        CumulativeIn(kind="twins")
