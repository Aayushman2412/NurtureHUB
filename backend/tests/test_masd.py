"""The MASD dashboard's numbers.

Managers decide who gets a supervisor's call and how a district is doing from
these figures, and the analysts compare them with their own report, so the
rules have to be the report's rules exactly:

  * a learner's ideal is 98 activities (66 for a Staff Nurse) over the two
    tranches, and the adoption target is six;
  * an adoption is ANC if the mother was taken on before the birth, otherwise
    PNC split at 150 days (5 months);
  * an interim report only charges learners for what was due by then;
  * the outcome analysis keeps F2F learners' cases minus Staff Nurses', and a
    case's exclusion reason is the FIRST failed data check, in the report's order;
  * the downloaded deck opens in PowerPoint — no fractional offsets, which
    PowerPoint rejects outright.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_masd.py -v
"""
from __future__ import annotations

import base64
import os
import re
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone
from io import BytesIO

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from app.masd import engine as E  # noqa: E402
from app.masd import insights as I  # noqa: E402
from app.masd import rules as R  # noqa: E402

AS_OF = date(2026, 9, 29)
TRAINING = date(2026, 6, 1)
TRANCHE2 = date(2026, 7, 13)


# ── Rules ──────────────────────────────────────────────────────────────────


def test_ideal_counts_match_the_report():
    assert sum(R.ideal_for_learner(False).values()) == 98
    assert sum(R.ideal_for_learner(True).values()) == 66
    assert sum(R.ideal_for_tranche(False, 1).values()) == 53
    assert sum(R.ideal_for_tranche(False, 2).values()) == 45
    assert sum(R.ideal_for_tranche(True, 1).values()) == sum(R.ideal_for_tranche(True, 2).values()) == 33
    assert R.adoption_target(2) == 6 and R.adoption_target(1) == 3
    # A Staff Nurse's PNC adoption expects hospital visits only.
    assert R.ideal_for_adoption(R.PNC_LT5, 1, True) == {"gm": 6, "bf": 5}
    # An ANC adoption expects mother-level checks only.
    assert set(R.ideal_for_adoption(R.ANC, 1, False)) == {"anc", "protein"}


@pytest.mark.parametrize("role,group", [
    ("Anganwadi Worker (AWW)", "AWW"), ("Lady Supervisor", "AWSup"), ("ASHA", "ASHA"),
    ("ASHA Facilitator", "ASHA Sup"), ("ANM", "ANM"), ("CHO (Community Health Officer)", "CHO"),
    ("Staff Nurse", "Nursing Staff"), ("Pharmacist", "Other"), (None, "Other"),
])
def test_role_groups(role, group):
    assert R.role_group(role) == group


def test_delivery_groups():
    assert R.delivery_place_group("District Hospital (DH)") == "Government"
    assert R.delivery_place_group("Private Hospital/Nursing Home") == "Private"
    assert R.delivery_place_group("Home") == "Home"
    assert R.delivery_method_group("Caesarean section") == "Caesarean section"


# ── Classification ─────────────────────────────────────────────────────────


def _m(mid=1, adopted=date(2026, 6, 10), lmp=None):
    return E.MotherIn(id=mid, learner_id=1, adoption_date=adopted, lmp=lmp)


def _c(cid=1, mid=1, dob=None, adopted=None, **kw):
    return E.ChildIn(id=cid, mother_id=mid, dob=dob, adoption_date=adopted, **kw)


@pytest.mark.parametrize("age,expected", [(0, R.PNC_LT5), (149, R.PNC_LT5), (150, R.PNC_GE5), (300, R.PNC_GE5)])
def test_pnc_split_at_150_days(age, expected):
    adopted = date(2026, 6, 10)
    child = _c(dob=date.fromordinal(adopted.toordinal() - age), adopted=adopted)
    assert E.classify(_m(adopted=adopted), [child])[0] == expected


def test_anc_when_mother_adopted_before_birth():
    assert E.classify(_m(lmp=date(2026, 3, 1)), [])[0] == R.ANC
    born_later = _c(dob=date(2026, 8, 1), adopted=date(2026, 8, 2))
    assert E.classify(_m(), [born_later])[0] == R.ANC
    assert E.classify(_m(lmp=None), [])[0] == R.UNKNOWN


# ── A small project ────────────────────────────────────────────────────────


def _project() -> E.MasdData:
    """One MT learner with six cases that each hit a different outcome path,
    a Staff Nurse, a learner who did nothing, and a learner outside F2F."""
    L = E.LearnerIn
    learners = [
        L(1, "Asha One", role="ASHA", block="North", f2f=True, trainer_role="master_trainer"),
        L(2, "Nurse Two", role="Staff Nurse", block="South", f2f=True),
        L(3, "Idle Three", role="Anganwadi Worker (AWW)", block="North", f2f=True),
        L(4, "Outside Four", role="ASHA", block="North", f2f=False),
    ]
    M, C, G, A = E.MotherIn, E.ChildIn, E.GrowthIn, E.ActivityIn
    d = date
    mothers = [
        M(1, 1, d(2026, 6, 10)),                         # included PNC<5M
        M(2, 1, d(2026, 6, 15), lmp=d(2026, 3, 1)),      # ANC, not born yet → no_child
        M(3, 1, d(2026, 7, 20)),                         # PNC≥5M, tranche 2 → only_adoption_visit
        M(4, 1, d(2026, 6, 20)),                         # baby adopted before the mother
        M(5, 1, d(2026, 6, 12)),                         # no sex → z_missing
        M(6, 1, d(2026, 6, 14)),                         # 0.85 kg girl → birth_weight_extreme
        M(7, 2, d(2026, 6, 5)),                          # nurse's case
        M(8, 4, d(2026, 6, 12)),                         # outside F2F
    ]
    children = [
        C(1, 1, d(2026, 6, 5), d(2026, 6, 10), "Female", 3.0, 49.0),
        C(3, 3, d(2026, 1, 1), d(2026, 7, 20), "Male", 3.2, 50.0),
        C(4, 4, d(2026, 6, 1), d(2026, 6, 15), "Male", 3.1, 49.5),
        C(5, 5, d(2026, 6, 1), d(2026, 6, 12), None, 3.0, 49.0),
        C(6, 6, d(2026, 6, 1), d(2026, 6, 14), "Female", 0.85, 45.0),
        C(7, 7, d(2026, 6, 5), d(2026, 6, 5), "Male", 3.3, 50.0),
        C(8, 8, d(2026, 6, 1), d(2026, 6, 12), "Female", 3.0, 49.0),
    ]
    growth = [
        G(1, d(2026, 6, 10), 3.1, 49.5), G(1, d(2026, 7, 10), 4.2, 54.0), G(1, d(2026, 9, 1), 5.6, 60.0),
        G(3, d(2026, 7, 20), 7.4, 66.0),
        G(4, d(2026, 6, 15), 3.6, 51.0), G(4, d(2026, 8, 1), 5.5, 58.0),
        G(5, d(2026, 6, 12), 3.4, 50.0), G(5, d(2026, 8, 1), 5.2, 57.0),
        G(6, d(2026, 6, 14), 1.1, 46.0), G(6, d(2026, 8, 1), 2.5, 52.0),
        G(7, d(2026, 6, 5), 3.3, 50.0), G(7, d(2026, 6, 6), 3.2, 50.0),
        G(8, d(2026, 6, 12), 3.5, 51.0), G(8, d(2026, 8, 12), 5.9, 58.0),
    ]
    acts = [A("growth_monitoring", 1, g.on, child_id=g.child_id) for g in growth if g.child_id in (1, 3, 4, 5, 6)]
    acts += [A("breastfeeding", 1, d(2026, 6, 10), child_id=1), A("breastfeeding", 1, d(2026, 7, 10), child_id=1)]
    acts += [A("antenatal", 1, d(2026, 6, 15) + timedelta(days=14 * k), mother_id=2) for k in range(3)]
    acts += [A("mother_protein_intake", 1, d(2026, 6, 16), mother_id=2)]
    acts += [A("growth_monitoring", 2, d(2026, 6, 5), child_id=7)] * 2 + [A("growth_monitoring", 2, d(2026, 6, 6), child_id=7)]
    acts += [A("breastfeeding", 2, d(2026, 6, 5), child_id=7)] * 2
    acts += [A("growth_monitoring", 4, g.on, child_id=8) for g in growth if g.child_id == 8]
    return E.MasdData(
        project={"id": 1, "slug": "demo", "name": "Demo", "level": "district"},
        learners=learners, mothers=mothers, children=children, activities=acts, growth=growth,
        training_date=TRAINING, tranche2_start=TRANCHE2,
        benchmarks=R.DEFAULT_BENCHMARKS["jalna"], calendar_saved=True,
    )


@pytest.fixture()
def report():
    return E.compute(_project(), AS_OF)


def _learner(r, lid):
    return next(x for x in r["learners"] if x["id"] == lid)


def test_targets_and_intensity(report):
    s = report["summary"]
    assert s["learners"] == 3, "only F2F learners count"
    one = _learner(report, 1)
    assert one["adoptions"] == {"anc": 1, "pnc_lt5": 4, "pnc_ge5": 1, "unknown": 0, "total": 6}
    assert one["fulfilment_pct"] == 100.0
    assert one["ideal"]["total"] == 98
    assert one["activities"]["total"] == 16   # 10 growth checks + 2 BF + 3 ANC + 1 protein
    nurse = _learner(report, 2)
    assert nurse["ideal"]["total"] == 66 and nurse["activities"]["total"] == 5
    assert nurse["subtype_pct"]["anc"] is None, "a nurse has no antenatal ideal — not 0%"
    assert _learner(report, 3)["nil_days"] is None
    assert report["calendar"]["tranches_in_force"] == 2 and not report["calendar"]["prorated"]


def test_attention_lists_the_idle_learner(report):
    idle = next(a for a in report["attention"] if a["id"] == 3)
    assert "no_activity" in idle["reasons"] and "few_adoptions" in idle["reasons"]
    assert report["attention"][0]["id"] == 3, "no activity at all sorts first"


def test_funnel_and_first_failed_check(report):
    o = report["outcomes"]
    steps = {s["key"]: s for s in o["funnel"]}
    assert (steps["start"]["learners_after"], steps["start"]["cases_after"]) == (3, 8)
    assert (steps["no_f2f"]["learners_removed"], steps["no_f2f"]["cases_removed"]) == (1, 1)
    assert (steps["nursing_staff"]["learners_after"], steps["nursing_staff"]["cases_after"]) == (1, 6)
    reasons = {x["key"]: x["total"] for x in o["exclusions"]["reasons"]}
    for key in ("no_child", "only_adoption_visit", "baby_before_mother", "z_missing", "birth_weight_extreme"):
        assert reasons[key] == 1, key
    assert o["exclusions"]["included"]["total"] == 1
    assert o["exclusions"]["inclusion_pct_mtfl"] == pytest.approx(16.7)
    assert o["prevalence"]["overall"]["n"] == 1
    fixes = o["data_fixes"]
    assert fixes and fixes[0]["cases"] == 3, "the three data-entry slips, not the follow-up gaps"


def test_interim_is_prorated_and_tranche_one_only():
    interim = E.compute(_project(), date(2026, 7, 1))
    cal = interim["calendar"]
    assert cal["tranches_in_force"] == 1 and cal["prorated"]
    one = _learner(interim, 1)
    assert one["target"] == 3
    assert 0 < one["ideal"]["total"] < 53, "only part of tranche 1 was due on 1 July"
    assert one["adoptions"]["total"] == 5, "the tranche-2 adoption on 20 July is not counted yet"


def test_comparison_and_findings(report):
    then = E.compute(_project(), date(2026, 7, 12))
    cmp = E.comparison(then, report)
    assert cmp["then"]["target_per_learner"] == 3 and cmp["now"]["target_per_learner"] == 6
    assert {b["key"] for b in cmp["blocks"]} == {"North", "South"}
    report["comparison"] = cmp
    findings = I.all_findings(report, cmp)
    assert all(f["text"] and f["tone"] in ("good", "watch", "info") for fs in findings.values() for f in fs)
    assert any("12 Jul 2026" in f["text"] for f in findings["progress"]), "dates read as dates, not ISO"


def test_deck_and_workbook_build(report):
    from pptx import Presentation

    from app.masd.pptx_export import build_deck
    from app.masd.xlsx_export import build_workbook

    report["comparison"] = E.comparison(E.compute(_project(), date(2026, 7, 12)), report)
    report["insights"] = I.all_findings(report, report["comparison"])
    deck = build_deck(report).read()
    assert len(Presentation(BytesIO(deck)).slides) >= 30
    with zipfile.ZipFile(BytesIO(deck)) as z:
        for name in z.namelist():
            if name.startswith("ppt/slides/slide") and name.endswith(".xml"):
                xml = z.read(name).decode("utf-8")
                assert not re.search(r'<a:(off|ext) [^>]*="\d+\.\d', xml), f"fractional EMU in {name}"
    from openpyxl import load_workbook
    wb = load_workbook(build_workbook(report))
    assert {"MASD learners", "By block", "By cadre", "Malnutrition", "Needs attention"} <= set(wb.sheetnames)


# ── Routes ─────────────────────────────────────────────────────────────────


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
    trained = models.User(email="t@t.mock", full_name="Trained", is_verified=True, program_district_id=pd.id, role="ASHA")
    other = models.User(email="o@t.mock", full_name="Other", is_verified=True, program_district_id=pd.id, role="ASHA")
    db.add_all([trained, other])
    db.flush()
    db.add(models.FaceToFaceSelection(user_id=trained.id, program_district_id=pd.id))
    mother = models.Mother(mother_uid="T-M1", registered_by_user_id=trained.id, mother_name="M",
                           adoption_date=date(2026, 6, 10))
    db.add(mother)
    db.flush()
    child = models.Child(child_uid="T-C1", mother_id=mother.id, child_name="C", dob=date(2026, 6, 5),
                         adoption_date=date(2026, 6, 10), gender="Female", birth_weight=3.0, birth_length=49.0)
    db.add(child)
    db.flush()
    for on, w, ln in ((date(2026, 6, 10), "3.1", "49.5"), (date(2026, 8, 10), "5.0", "57.0")):
        db.add(models.FormResponse(
            form_key="growth_monitoring", child_id=child.id, submitted_by_user_id=trained.id,
            assessment_date=on, status="submitted",
            answers_json=[{"nodeId": "baby_weight", "question": "Baby's weight (kg)", "questionType": "number", "value": w},
                          {"nodeId": "baby_length", "question": "Baby's length (cm)", "questionType": "number", "value": ln}],
            created_at=datetime(2026, 8, 10, tzinfo=timezone.utc),
        ))
    db.commit()
    yield db, trained, other
    db.close()


def test_report_route_reads_the_database(world):
    from app.routers.masd import masd_projects, masd_report_json

    db, trained, _ = world
    projects = {p["slug"]: p for p in masd_projects(db=db)}
    assert projects["demo"]["f2f_learners"] == 1
    r = masd_report_json(project="demo", as_of=AS_OF, compare=None, db=db)
    assert r["summary"]["learners"] == 1 and r["summary"]["adoptions"] == 1
    assert r["summary"]["subtype_actual"]["gm"] == 2
    assert r["outcomes"]["exclusions"]["included"]["total"] == 1, "two measured visits with dates that agree"
    assert r["insights"]["overview"]


def test_trainer_role_only_for_f2f_learners(world):
    from fastapi import HTTPException

    from app.routers.masd import TrainerRoleIn, put_trainer_role

    db, trained, other = world
    with pytest.raises(HTTPException) as refused:
        put_trainer_role(other.id, TrainerRoleIn(trainer_role="facilitator"), admin_email="a@t", db=db)
    assert refused.value.status_code == 404
    out = put_trainer_role(trained.id, TrainerRoleIn(trainer_role="facilitator"), admin_email="a@t", db=db)
    assert out["trainer_role"] == "facilitator"


def test_settings_reject_tranche_before_training():
    from pydantic import ValidationError

    from app.routers.masd import SettingsIn

    with pytest.raises(ValidationError):
        SettingsIn(training_date=date(2026, 7, 1), tranche2_start=date(2026, 6, 1))
    with pytest.raises(ValidationError):
        SettingsIn(benchmarks={"label": "x", "age_bands": {"lt6": {"stunting": 140}}})
