"""Growth status, trend and priority (docs/visit-protocol-2026-11.md, section
"Growth status, priority and data checks").

* Grades: severe below −3 SD, moderate below −2, mild below −1.
* Trend: the weight-for-age z (WAZ) change since the last check at least 14
  days earlier — faltering < −0.67, slowed −0.66…−0.01, no change 0, improved
  +0.01…+0.67, catch-up > +0.67. Under 3 weeks the newborn rule (NICE NG75).
* Priority = (1 + Σ extra death risk, Olofin 2013) × trend multiplier, × 2
  when moderate or severe on all three; tiers at 9 / 3 / 1.5; severe wasting
  or severe underweight is always tier 1.

    cd backend && ./venv-win/Scripts/python.exe -m pytest tests/test_growth_priority.py -v
"""
from __future__ import annotations

import base64
import os
from datetime import date, timedelta

import pytest

os.environ.setdefault("APP_ENV", "development")
_TEST_KEY = base64.urlsafe_b64encode(b"0123456789abcdef0123456789abcdef").decode().rstrip("=")
os.environ.setdefault("PHI_ENCRYPTION_KEYS", f"v1:{_TEST_KEY}")
os.environ.setdefault("PHI_ENCRYPTION_ACTIVE_KEY", "v1")
os.environ.setdefault("PHI_INDEX_KEY", "test-index-key-not-for-production")
os.environ.setdefault("AUDIT_HMAC_KEY", "test-audit-key-not-for-production-0123456789")

from app import growth_priority as P  # noqa: E402
from app.who_growth import value_for_z, zscore_for_value  # noqa: E402

ALL = (P.WASTING, P.UNDERWEIGHT, P.STUNTING)


def _grades(**given):
    return {ind: given.get(ind, P.NORMAL) for ind in ALL}


# ── Grades ─────────────────────────────────────────────────────────────────

def test_grades_follow_the_analysts_cut_offs():
    assert [P.grade(z) for z in (-3.01, -3.0, -2.01, -2.0, -1.01, -1.0, 0.5)] == [
        "severe", "moderate", "moderate", "mild", "mild", "normal", "normal"]
    assert P.grade(None) is None


# ── Status score ───────────────────────────────────────────────────────────

def test_status_score_is_one_plus_the_extra_risk_of_each_indicator():
    assert P.status_score(_grades()) == pytest.approx(1.0)
    assert P.status_score(_grades(underweight="moderate")) == pytest.approx(2.63)
    assert P.status_score(_grades(wasting="severe", underweight="severe", stunting="severe")) == pytest.approx(24.51)
    # A measurement that could not be graded counts as normal, not as a risk.
    assert P.status_score({P.WASTING: None, P.UNDERWEIGHT: "mild", P.STUNTING: None}) == pytest.approx(1.52)


# ── The worked examples ────────────────────────────────────────────────────

def test_severe_on_all_three_is_tier_one():
    """24.51 × 2 for all three: ≈ 49 with no change, ≈ 98 when also faltering."""
    severe = _grades(wasting="severe", underweight="severe", stunting="severe")
    still = P.priority(severe, P.NO_CHANGE)
    assert still["score"] == pytest.approx(49.02) and still["tier"] == 1 and still["all_three"]
    falling = P.priority(severe, P.FALTERING)
    assert falling["score"] == pytest.approx(98.04) and falling["tier"] == 1


def test_moderate_underweight_with_no_change_is_counselled_at_the_next_visit():
    p = P.priority(_grades(underweight="moderate"), P.NO_CHANGE)
    assert p["score"] == pytest.approx(2.63) and p["tier"] == 3 and not p["safety_rule"]


def test_a_normal_baby_who_is_faltering_is_counselled():
    p = P.priority(_grades(), P.FALTERING)
    assert p["score"] == pytest.approx(2.0) and p["tier"] == 3


def test_severe_wasting_is_tier_one_even_in_catch_up():
    p = P.priority(_grades(wasting="severe"), P.CATCH_UP)
    assert p["score"] == pytest.approx(6.98, abs=0.01)     # tier 2 by the score alone
    assert p["tier"] == 1 and p["safety_rule"]
    assert P.priority(_grades(underweight="severe"), P.IMPROVED)["tier"] == 1


def test_moderate_on_all_three_doubles():
    p = P.priority(_grades(wasting="moderate", underweight="moderate", stunting="moderate"), P.SLOWED)
    assert p["score"] == pytest.approx((1 + 2.38 + 1.63 + 1.28) * 1.5 * 2) and p["tier"] == 1
    # Mild on one of the three is not "all three".
    assert not P.priority(_grades(wasting="mild", underweight="moderate", stunting="moderate"), P.SLOWED)["all_three"]


def test_tier_boundaries_and_not_flagged():
    assert P.tier_for(9.0) == 1 and P.tier_for(8.99) == 2
    assert P.tier_for(3.0) == 2 and P.tier_for(2.99) == 3
    assert P.tier_for(1.5) == 3 and P.tier_for(1.49) is None
    assert P.priority(_grades(stunting="mild"), P.NO_CHANGE)["tier"] is None        # 1.46
    assert P.priority(_grades(), P.IMPROVED)["tier"] is None                         # 0.8


def test_the_trend_multipliers():
    assert {g: P.TREND_MULTIPLIER[g] for g in (P.FALTERING, P.SLOWED, P.NO_CHANGE, P.FIRST_CHECK, P.IMPROVED,
                                                P.CATCH_UP)} == {
        "faltering": 2.0, "slowed": 1.5, "no_change": 1.0, "first_check": 1.0, "improved": 0.8, "catch_up": 0.6}


def test_ordering_puts_tier_one_first_then_the_higher_score():
    rows = [P.priority(_grades(), P.FALTERING),                       # 2.0, tier 3
            P.priority(_grades(wasting="severe"), P.CATCH_UP),        # 6.98, tier 1 by the rule
            P.priority(_grades(underweight="moderate"), P.SLOWED),    # 3.95, tier 2
            P.priority(_grades(), P.IMPROVED)]                        # 0.8, not flagged
    ordered = sorted(rows, key=P.sort_key)
    assert [r["tier"] for r in ordered] == [1, 2, 3, None]


# ── The weight-for-age trend ───────────────────────────────────────────────

D0 = date(2026, 9, 1)


def test_trend_groups_by_the_waz_change():
    def group(change):
        return P.waz_trend([(D0, -1.0), (D0 + timedelta(days=20), round(-1.0 + change, 2))])["group"]

    assert group(-0.8) == "faltering"
    assert group(-0.67) == "slowed"           # faltering is strictly below −0.67
    assert group(-0.01) == "slowed"
    assert group(0.0) == "no_change"
    assert group(0.01) == "improved"
    assert group(0.67) == "improved"
    assert group(0.68) == "catch_up"


def test_trend_compares_with_the_last_check_at_least_14_days_earlier():
    checks = [(D0, -1.0), (D0 + timedelta(days=9), -1.9), (D0 + timedelta(days=19), -1.7)]
    t = P.waz_trend(checks)
    # The check 10 days before is too close; the one 19 days before counts.
    assert t["since"] == D0.isoformat() and t["change"] == pytest.approx(-0.7) and t["group"] == "faltering"


def test_no_trend_without_an_earlier_check_14_days_before():
    assert P.waz_trend([(D0, -1.0)])["group"] == "first_check"
    assert P.waz_trend([(D0, -1.0), (D0 + timedelta(days=13), -2.5)])["group"] == "first_check"
    assert P.waz_trend([])["group"] == "first_check"


# ── The newborn rule and the whole assessment ──────────────────────────────

def _case(*visits, gender="Female", birth_weight=None, dob=D0):
    return {"child": {"id": 1, "gender": gender, "birth_weight": birth_weight, "dob": dob.isoformat()},
            "visits": [{"date": (dob + timedelta(days=age)).isoformat(), "age_days": age, "weight": w, "length": ln}
                       for age, w, ln in visits]}


def test_a_newborn_more_than_10_percent_below_birth_weight_is_faltering():
    t = P.assess(_case((10, 2.6, None), birth_weight=3.0))["trend"]
    assert (t["group"], t["rule"]) == ("faltering", "newborn_loss")
    ok = P.assess(_case((10, 2.8, None), birth_weight=3.0))["trend"]
    assert (ok["group"], ok["rule"]) == ("newborn", "newborn")
    assert P.TREND_MULTIPLIER["newborn"] == 1.0


def test_a_newborn_is_not_judged_by_the_waz_change():
    # Day 1 at the median, day 18 well below it but within 10 % of birth weight.
    born = value_for_z("wfa", "girls", 1, 0.0)
    t = P.assess(_case((1, born, None), (18, born * 0.95, None), birth_weight=born))["trend"]
    assert t["rule"] == "newborn" and t["group"] == "newborn"


def test_birth_weight_not_regained_by_three_weeks_is_faltering():
    t = P.assess(_case((25, 2.9, None), birth_weight=3.0))["trend"]
    assert (t["group"], t["rule"]) == ("faltering", "birth_weight_not_regained")


def test_assess_grades_the_latest_check_and_lists_the_groups():
    # A girl falling from the median at 3 months to about −2.5 SD at 4 months.
    w90 = value_for_z("wfa", "girls", 90, 0.0)
    w120 = value_for_z("wfa", "girls", 120, -2.5)
    a = P.assess(_case((90, round(w90, 2), 60.0), (120, round(w120, 2), 61.0)))
    waz = zscore_for_value("wfa", "girls", 120, round(w120, 2))
    lfa = zscore_for_value("lfa", "girls", 120, 61.0)
    assert a["z"]["wfa"] == waz and a["z"]["lfa"] == lfa
    assert a["grades"]["underweight"] == P.grade(waz) == "moderate"
    assert a["trend"]["group"] == "faltering" and a["trend"]["since"] == (D0 + timedelta(days=90)).isoformat()
    assert "underweight" in a["groups"] and "faltering" in a["groups"]
    assert ("stunted" in a["groups"]) == (lfa < -2)
    assert a["last_check"] == (D0 + timedelta(days=120)).isoformat()
    assert a["priority"]["tier"] in (1, 2)


def test_assess_needs_a_weighed_check():
    assert P.assess(_case()) is None
    assert P.assess(_case((30, None, 52.0))) is None


def test_growing_well_is_measured_and_in_no_group_and_not_flagged():
    w60 = value_for_z("wfa", "boys", 60, 0.2)
    w90 = value_for_z("wfa", "boys", 90, 0.4)          # rising a little: improved
    a = P.assess(_case((60, round(w60, 2), 58.5), (90, round(w90, 2), 61.5), gender="Male"))
    assert a["groups"] == [] and a["priority"]["tier"] is None and P.growing_well(a)


# ── Where the score is used ────────────────────────────────────────────────
#
# Three weighed babies and one not weighed yet, all the worker's own:
#   Dev    — severely underweight at a single check            → tier 1 (9.40)
#   Asha   — fell from the median to about −2.5 SD in 30 days → moderately
#            underweight and faltering, 2.63 × 2 = 5.26        → tier 2
#   Bina   — rising a little along the curve                   → growing well
#   Chandu — no growth check yet                               → not yet measured

AS_OF = date(2026, 11, 10)


@pytest.fixture()
def world():
    import tempfile

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app import models
    from app.database import Base
    import app.models_live  # noqa: F401
    import app.models_security  # noqa: F401

    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()
    worker = models.User(email="w@t.mock", full_name="Asha Worker", is_verified=True, role="ASHA")
    db.add(worker)
    db.flush()
    mother = models.Mother(mother_uid="T-M1", registered_by_user_id=worker.id, mother_name="Pallavi",
                           adoption_date=AS_OF - timedelta(days=200))
    db.add(mother)
    db.flush()
    kids = {}
    for name, gender, age_now in (("Dev", "Female", 110), ("Asha", "Female", 160), ("Bina", "Male", 100),
                                  ("Chandu", "Male", 40)):
        kid = models.Child(child_uid=f"T-{name}", mother_id=mother.id, child_name=name, gender=gender,
                           dob=AS_OF - timedelta(days=age_now), adoption_date=AS_OF - timedelta(days=age_now))
        db.add(kid)
        db.flush()
        kids[name] = kid

    def weigh(name, age, z):
        kid = kids[name]
        sex = "girls" if kid.gender == "Female" else "boys"
        w = round(value_for_z("wfa", sex, age, z), 2)
        db.add(models.FormResponse(
            form_key="growth_monitoring", child_id=kid.id, submitted_by_user_id=worker.id,
            assessment_date=kid.dob + timedelta(days=age), status="submitted",
            answers_json=[{"nodeId": "baby_weight", "question": "Baby's weight (kg)", "questionType": "number",
                           "value": str(w)}]))

    weigh("Dev", 105, -3.5)              # the latest check of all four
    weigh("Asha", 120, 0.0)
    weigh("Asha", 150, -2.5)
    weigh("Bina", 60, 0.2)
    weigh("Bina", 90, 0.4)
    db.commit()
    yield {"db": db, "worker": worker, "kids": kids}
    db.close()
    engine.dispose()
    os.unlink(path)


def test_my_babies_growth_counts_each_group_over_the_weighed_babies(world):
    from app.growth_groups import my_babies

    view = my_babies(world["db"], world["worker"], AS_OF)
    assert (view["measured"], view["not_measured"], view["growing_well"]) == (3, 1, 1)
    assert view["counts"] == {"underweight": 2, "faltering": 1, "stunted": 0, "wasted": 0}
    assert [b["child_name"] for b in view["babies"]] == ["Dev", "Asha", "Bina"]
    dev, asha = view["babies"][0], view["babies"][1]
    assert dev["priority"]["tier"] == 1 and dev["grades"]["underweight"] == "severe"
    assert asha["groups"] == ["underweight", "faltering"] and asha["priority"]["tier"] == 2
    assert asha["trend"]["group"] == "faltering" and asha["trend"]["since"]
    assert asha["forms"] == ["gm", "bf"]                     # the visit "Start visit" opens
    assert [b["child_name"] for b in view["unmeasured"]] == ["Chandu"]


def test_my_babies_growth_is_the_learners_own(world):
    from app import models
    from app.routers.growth_status import my_babies_growth

    assert my_babies_growth(current_user=world["worker"], db=world["db"])["measured"] == 3
    stranger = models.User(email="s@t.mock", full_name="Someone Else", is_verified=True, role="ASHA")
    world["db"].add(stranger)
    world["db"].commit()
    empty = my_babies_growth(current_user=stranger, db=world["db"])
    assert (empty["measured"], empty["not_measured"], empty["babies"]) == (0, 0, [])


def test_the_worker_sees_the_most_urgent_baby_first(world):
    from app import fieldplan

    urgent = fieldplan.today_view(world["db"], world["worker"], AS_OF)["urgent"]
    # Asha's check is the older one, so the old order (by date) put her first.
    assert [u["child_name"] for u in urgent] == ["Dev", "Asha"]
    assert [u["priority"]["tier"] for u in urgent] == [1, 2]


def test_faltering_cases_are_tiered_ordered_and_filtered(world):
    from app import faltering
    from app.routers.growth import admin_faltering_cases

    rows = faltering.build(world["db"], None)["rows"]
    assert [r["child"]["name"] for r in rows] == ["Dev", "Asha"]
    assert [faltering.tier_key(r["priority"]) for r in rows] == ["1", "2"]
    assert "faltering" in rows[1]["flags"] and rows[1]["trend"]["group"] == "faltering"
    assert [r["child"]["name"] for r in faltering.apply_filters(rows, tiers=["2"])] == ["Asha"]

    page = admin_faltering_cases(district="", conditions="", monitor="", batch="", block="", cadre="",
                                 department="", learner_id=None, tier="1", admin={}, db=world["db"])
    assert [r["case_id"] for r in page["rows"]] == [world["kids"]["Dev"].id]
    assert page["tier_counts"] == {"1": 1, "2": 1, "3": 0, "none": 0}


def test_the_spreadsheet_has_the_priority_in_words(world):
    from openpyxl import load_workbook

    from app import faltering

    rows = faltering.build(world["db"], None)["rows"]
    book = load_workbook(faltering.xlsx(rows, project="Demo", conditions=faltering.CONDITION_KEYS))
    sheet = book["All faltering cases"]
    assert [sheet.cell(row=4, column=c).value for c in (1, 2, 3, 4)] == [
        "Why listed", "Priority", "Priority score", "Weight-for-age trend"]
    assert [sheet.cell(row=r, column=2).value for r in (5, 6)] == ["Refer today", "Act this week"]
    assert sheet.cell(row=6, column=4).value == "Faltering"
