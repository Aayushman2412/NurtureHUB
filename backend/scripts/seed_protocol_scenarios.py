"""Scenario cases for checking the November 2026 visit protocol by hand (LOCAL ONLY).

The product owner: "i want to verify each and everything so how do i do it".
This builds one learner whose every mother and baby is a named test of one
rule of docs/visit-protocol-2026-11.md, with dates counted back from today so
the cases are always current, then asks the app itself (Today, the baby's
plan, "My babies' growth", the measurement checks) what it shows for each and
prints that next to what the spec says it should show.

    cd backend
    ./venv-win/Scripts/python.exe -m scripts.seed_protocol_scenarios --create   # (re)build, then verify
    ./venv-win/Scripts/python.exe -m scripts.seed_protocol_scenarios --verify   # verify only
    ./venv-win/Scripts/python.exe -m scripts.seed_protocol_scenarios --remove   # delete all of it

Sign in as scenario.lap@nurturehub.mock with the mock learners' password
(scripts/seed_mock_learners.py) to see the same cases in the app.

What it creates, and nothing else: that learner (Chandrapur, profile complete,
verified, face-to-face selected so Adoptions are open), and mothers and babies
registered by her whose names start with "Test " and whose IDs start with
"SCN-", with their forms. --create first removes the previous scenario rows
(so running it twice never duplicates, and the dates move to today); the
care prompts and notifications of the account go with them. --remove also
deletes the account, and with it anything registered under it by hand.

Every form goes through the API's own code: the learner's project's form
version, the same snapshot and validation (routers/forms), the hard entry
checks (app/entry_checks.py), the measurement checks recorded on a growth
check (app/growth_entry_checks.py) and, after a baby's last check, the care
prompts a submission sends (app/care_alerts.py). Weights and lengths are read
off the WHO tables (app/who_growth.py); nothing the app derives is written by
hand. Like the other seeders it records no consent and writes no audit rows:
these are synthetic people.

Refuses to run unless DATABASE_URL points at this machine.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from random import Random
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union
from urllib.parse import urlparse

from app.config import settings

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _refuse_unless_local() -> None:
    host = urlparse(settings.DATABASE_URL).hostname
    if host not in LOCAL_HOSTS:
        sys.exit(f"Refusing: DATABASE_URL points at '{host}', not this machine. This script is for local checks only.")


_refuse_unless_local()

import app.models_live  # noqa: E402,F401  (registers every table)
from app import fieldplan, growth_entry_checks, growth_groups, models, visit_plan  # noqa: E402
from app import entry_checks  # noqa: E402
from app import visit_protocol as VP  # noqa: E402
from app.care_alerts import on_feeding_check, on_growth_check  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.routers.forms import (  # noqa: E402
    AnswerIn, _check_cf_gate, _resolve_for_user, _snapshot_answers, _snapshot_flat_answers, _with_entry_checks,
)
from app.seed_growth_demo import _flat_answers, _flow_answers  # noqa: E402
from app.who_growth import value_for_z  # noqa: E402

EMAIL = "scenario.lap@nurturehub.mock"
MOCK_PASSWORD = "password123"          # the mock learners' shared local password (scripts/seed_mock_learners.py)
PROJECT = "chandrapur"
UID_PREFIX = "SCN-"
NAME_PREFIX = "Test "
SEEDED_BY = "seed_protocol_scenarios"
GM, BF, CF, AF, PF = "gm", "bf", "cf", "anc", "protein"
FORM_KEY = {GM: "growth_monitoring", BF: "breastfeeding", CF: "complementary_feeding",
            AF: "antenatal", PF: "mother_protein_intake"}
WORD = {GM: "CG", BF: "BF", CF: "CF", AF: "AF", PF: "PF"}

# ── What a scenario is ─────────────────────────────────────────────────────

Track = Union[float, Tuple[Tuple[int, float], ...]]   # a z-score, or (visit day, z) points joined by lines


@dataclass(frozen=True)
class Visit:
    day: int                          # days after the adoption visit (day 0)
    forms: Tuple[str, ...]
    bf: Any = "alternate"             # "alternate" | "all_green" | frozenset of green question numbers
    pf: str = "usual"                 # "usual" | "met" | "below"
    breastfed: bool = True            # the growth check's "breastfed in the past 24 hours"


@dataclass(frozen=True)
class Baby:
    gender: str
    age_at_adoption: int              # days
    laz: Track = 0.0                  # length-for-age z
    waz: Track = 0.0                  # weight-for-age z (ignored when wlz is set)
    wlz: Optional[float] = None       # weight read from weight-for-length instead
    birth_z: float = -0.3
    weights: Tuple[Tuple[int, float], ...] = ()   # exact weights on given visit days
    counselled_day: Optional[int] = None          # "counselled her to restart breastfeeding" on this visit day


@dataclass(frozen=True)
class Scenario:
    name: str                         # the mother's name; the baby is "<name> baby"
    tests: str
    expect: str
    adopted_days_ago: int
    visits: Tuple[Visit, ...]
    check: Callable[["Seen"], Tuple[bool, str]]
    lmp_weeks: Optional[int] = None   # pregnant: LMP this many weeks ago
    baby: Optional[Baby] = None


@dataclass
class Seen:
    """What the app shows for one scenario today."""
    db: Any
    mother: models.Mother
    child: Optional[models.Child]
    plan: Dict[str, Any]
    today: List[Dict[str, Any]]
    finish: List[Dict[str, Any]]
    growth: Dict[str, Any] = field(default_factory=dict)   # the baby's row on "My babies' growth"
    bf_ids: List[str] = field(default_factory=list)        # the BF form's scored questions, in order


def _pnc_lt(days: Sequence[int], pf_days: Sequence[int] = (0,), **kw) -> Tuple[Visit, ...]:
    """Bucket 2 visits: CG + BF each, PF on the given days."""
    return tuple(Visit(d, (GM, BF, PF) if d in pf_days else (GM, BF), **kw) for d in days)


B3_FORMS = {0: (GM, BF, CF, PF), 1: (GM, BF), 2: (GM, BF), 3: (GM, BF), 5: (GM, BF, CF),
            10: (GM, CF), 15: (GM, CF, PF)}


def _pnc_ge(days: Sequence[int]) -> Tuple[Visit, ...]:
    """Bucket 3 visits as the spec's table lays them out (PF on day 0, then day 15)."""
    return tuple(Visit(d, B3_FORMS[d]) for d in days)


# ── What the app shows, in words ───────────────────────────────────────────

def _forms_txt(codes: Sequence[str], cf_no: Optional[int] = None) -> str:
    out = []
    for c in codes:
        out.append(f"CF-{cf_no}" if c == CF and cf_no else WORD.get(c, c))
    return " + ".join(out) or "(none)"


def _today_txt(seen: Seen) -> str:
    if not seen.today:
        return "Today: nothing"
    parts = []
    for g in seen.today:
        late = f", {g['late_days']} days late" if g["late_days"] else ""
        ask = "'Has the delivery happened?' then " if g.get("ask_delivery") else ""
        parts.append(f"Today: {ask}{_forms_txt([f['key'] for f in g['forms']], (seen.plan.get('next') or {}).get('cf_no'))}{late}")
    return "; ".join(parts)


def _today_codes(seen: Seen) -> List[str]:
    return [f["key"] for g in seen.today for f in g["forms"]]


def _next_txt(seen: Seen) -> str:
    nxt = seen.plan.get("next")
    if not nxt:
        return "no next visit"
    return f"next: day {nxt['day']} ({nxt['due_on']}) {_forms_txt(nxt['forms'], nxt.get('cf_no'))}"


# ── The scenarios and what the spec says each should show ──────────────────

def _check_anc36(s: Seen) -> Tuple[bool, str]:
    g = s.today[0] if s.today else {}
    ok = bool(g.get("ask_delivery")) and _today_codes(s) == [AF, PF]
    return ok, _today_txt(s)


def _check_anc20(s: Seen) -> Tuple[bool, str]:
    ok = _today_codes(s) == [AF, PF] and not any(g.get("ask_delivery") for g in s.today)
    finish = "; finish row: " + ", ".join(f["missing"] for f in s.finish) if s.finish else ""
    return ok, f"MF done (registered); {_today_txt(s)}{finish}"


def _later_days(s: Seen) -> List[int]:
    return [v["day"] for v in s.plan.get("later") or []]


def _check_pnc20(s: Seen) -> Tuple[bool, str]:
    nxt = s.plan.get("next") or {}
    later = _later_days(s)
    ok = nxt.get("day") == 7 and _today_codes(s) == [GM, BF] and later[:3] == [10, 12, 14]
    return ok, f"{_today_txt(s)} (day {nxt.get('day')}); then days {', '.join(map(str, later))}"


def _check_turning180(s: Seen) -> Tuple[bool, str]:
    nxt = s.plan.get("next") or {}
    codes = _today_codes(s)
    ok = nxt.get("cf_no") == 1 and nxt.get("day") == 0 and codes[:2] == [GM, CF] and BF not in codes
    age = (date.today() - s.child.dob).days
    return ok, f"age {age} d; {_today_txt(s)}; counts as CF day {nxt.get('day')}"


def _check_pnc7m(s: Seen) -> Tuple[bool, str]:
    nxt = s.plan.get("next") or {}
    ok = nxt.get("day") == 5 and nxt.get("cf_no") == 2 and _today_codes(s) == [GM, BF, CF]
    return ok, f"{_today_txt(s)} (day {nxt.get('day')}, BF-{s.plan['bf']['count'] + 1})"


def _check_dropping(s: Seen) -> Tuple[bool, str]:
    hidden = set(s.plan["bf"]["hidden_questions"])
    want, stray = {s.bf_ids[i] for i in S_POINTS}, {s.bf_ids[i] for i in X_POINT}
    ok = hidden == want and not (hidden & stray) and BF in _today_codes(s)
    return ok, (f"{_today_txt(s)}; BF hides {len(hidden)} points ({', '.join(sorted(hidden))}); "
                f"{', '.join(stray)} (green in forms 1 and 3, red in 2) is {'HIDDEN' if hidden & stray else 'still shown'}")


def _check_bf_stopped(s: Seen) -> Tuple[bool, str]:
    ok = s.plan["bf"]["status"] == "stopped" and BF not in _today_codes(s)
    return ok, f"{_today_txt(s)}; BF status {s.plan['bf']['status']}"


def _check_bf_reopens(s: Seen) -> Tuple[bool, str]:
    ok = s.plan["bf"]["status"] == "reopened" and BF in _today_codes(s)
    hidden = len(s.plan["bf"]["hidden_questions"])
    return ok, f"{_today_txt(s)}; BF status {s.plan['bf']['status']}; {hidden} of 30 points marked hidden"


def _check_pf(stopped: bool) -> Callable[[Seen], Tuple[bool, str]]:
    def check(s: Seen) -> Tuple[bool, str]:
        pf = s.plan["pf"]
        due = PF in _today_codes(s)
        ok = pf["stopped"] is stopped and due is (not stopped)
        return ok, f"{_today_txt(s)}; PF stopped={pf['stopped']}, last PF {pf['last_on']}"
    return check


def _check_not_bf(s: Seen) -> Tuple[bool, str]:
    feeding = s.plan["feeding"]
    ok = feeding["state"] == "can_drop_out" and BF not in _today_codes(s)
    return ok, (f"{_today_txt(s)}; feeding state {feeding['state']} (not breastfeeding since {feeding['since']}, "
                f"counselled {feeding['counselled_on']}, {feeding['visits_after']} visits after)")


def _check_growth(groups: Sequence[str], tier: Optional[int], well: bool = False) -> Callable[[Seen], Tuple[bool, str]]:
    def check(s: Seen) -> Tuple[bool, str]:
        b = s.growth
        p = b.get("priority") or {}
        ok = (b.get("growing_well") if well else (all(g in b.get("groups", []) for g in groups) and p.get("tier") == tier))
        z = b.get("z") or {}
        zs = ", ".join(f"{k.upper()} {v:+.2f}" for k, v in z.items() if v is not None)
        return bool(ok), (f"groups {b.get('groups')}, trend {b.get('trend', {}).get('group')}, "
                          f"tier {p.get('tier')} (score {p.get('score')}); {zs}")
    return check


def _check_measure(s: Seen) -> Tuple[bool, str]:
    out, ok = [], True
    for typed, want in ((75.0, {"typing_error"}), (6.6, {"weight_loss_refer"})):
        flags = growth_entry_checks.run(s.db, s.child, date.today(), typed, None)
        codes = {f["code"] for f in flags["flags"]}
        ok = ok and want <= codes
        out.append(f"{typed:g} kg -> {', '.join(sorted(codes)) or 'no flag'}")
    prev = flags["previous"]["weight"]
    return ok, f"last weight {prev['value']} kg on {prev['on']}; " + "; ".join(out)


S_POINTS = frozenset(range(8))          # the points green in the last two BF forms
X_POINT = frozenset({29})               # green in forms 1 and 3, red in form 2 (not back to back)

SCENARIOS: Tuple[Scenario, ...] = (
    Scenario("Test ANC 36 weeks", "ANC from 35 weeks asks about the delivery",
             "Today: 'Has the delivery happened?' then AF + PF", 30,
             (Visit(0, (AF, PF)), Visit(15, (AF, PF))), _check_anc36, lmp_weeks=36),
    Scenario("Test ANC 20 weeks", "ANC day 0, nothing filled yet",
             "Day 0 in order MF -> AF -> PF (MF is the registration)", 0, (), _check_anc20, lmp_weeks=20),
    Scenario("Test PNC 20 days", "Bucket 2 visit days",
             "Today day 7: CG + BF; then days 10, 12, 14", 7, _pnc_lt((0, 1, 2, 3, 5)), _check_pnc20,
             baby=Baby("Female", 20, laz=-0.2, waz=((0, -0.30), (5, -0.20)), birth_z=-0.3)),
    Scenario("Test turning 180", "Bucket 2 switches to the CF schedule at 180 days",
             "Visit today (181 d) is CF day 0: CG + CF-1 (PF if its 15 days are up)", 31,
             _pnc_lt((0, 1, 2, 3, 5, 7, 10, 12, 14, 21), pf_days=(0, 14)), _check_turning180,
             baby=Baby("Male", 150, laz=0.1, waz=((0, -0.10), (21, 0.05)))),
    Scenario("Test PNC 7 months", "Bucket 3 day 5",
             "Today day 5: CG + BF-5 + CF-2", 5, _pnc_ge((0, 1, 2, 3)), _check_pnc7m,
             baby=Baby("Female", 213, laz=-0.4, waz=((0, -0.50), (3, -0.45)))),
    Scenario("Test BF dropping points", "BF points green in two back-to-back forms drop out",
             "Today's BF hides the 8 points green in forms 2 and 3; the point green in forms 1 and 3 stays", 3,
             (Visit(0, (GM, BF, PF), bf=X_POINT), Visit(1, (GM, BF), bf=S_POINTS),
              Visit(2, (GM, BF), bf=S_POINTS | X_POINT)), _check_dropping,
             baby=Baby("Male", 40, laz=0.0, waz=((0, -0.20), (2, -0.15)))),
    Scenario("Test BF stopped", "BF stops: two all-green forms, WFA >= P30 and not falling",
             "Today day 5: CG only (BF stopped)", 5,
             (Visit(0, (GM, BF, PF), bf=frozenset(range(3, 30))), Visit(1, (GM, BF), bf=frozenset(range(2, 30))),
              Visit(2, (GM, BF), bf="all_green"), Visit(3, (GM, BF), bf="all_green")), _check_bf_stopped,
             baby=Baby("Female", 60, laz=0.0, waz=((0, -0.20), (3, -0.11)))),
    Scenario("Test BF reopens", "BF reopens when the weight-for-age z falls after a stop",
             "Today day 7: CG + BF (reopened)", 7,
             (Visit(0, (GM, BF, PF), bf=frozenset(range(3, 30))), Visit(1, (GM, BF), bf=frozenset(range(2, 30))),
              Visit(2, (GM, BF), bf="all_green"), Visit(3, (GM, BF), bf="all_green"),
              Visit(5, (GM, BF), bf="all_green")), _check_bf_reopens,
             baby=Baby("Female", 60, laz=0.0, waz=((0, -0.20), (3, -0.11), (5, -0.21)))),
    Scenario("Test protein met", "PF stops after two forms each >= 40 g high-quality and >= 80 g total",
             "Today day 28: CG + BF, no PF", 28,
             tuple(Visit(d, (GM, BF, PF) if d in (0, 14) else (GM, BF), pf="met")
                   for d in (0, 1, 2, 3, 5, 7, 10, 12, 14, 21)), _check_pf(True),
             baby=Baby("Male", 60, laz=0.0, waz=((0, -0.10), (21, 0.0)))),
    Scenario("Test protein not met", "PF goes on when one of the two falls short",
             "Today day 28: CG + BF + PF", 28,
             tuple(Visit(d, (GM, BF, PF) if d in (0, 14) else (GM, BF), pf="met" if d == 0 else "below")
                   for d in (0, 1, 2, 3, 5, 7, 10, 12, 14, 21)), _check_pf(False),
             baby=Baby("Female", 60, laz=0.0, waz=((0, -0.10), (21, 0.0)))),
    Scenario("Test not breastfeeding", "Not breastfeeding at 2 visits after counselling: drop-out prompt",
             "Drop-out prompt (can_drop_out); no BF form", 14,
             tuple(Visit(d, (GM, BF, PF) if d == 0 else (GM, BF)) for d in (0, 1, 2, 3, 5))
             + tuple(Visit(d, (GM,), breastfed=False) for d in (7, 10, 12)), _check_not_bf,
             baby=Baby("Male", 50, laz=0.0, waz=((0, -0.30), (12, -0.20)), counselled_day=7)),
    Scenario("Test severely underweight", "Growth: WAZ below -3",
             "Underweight (and stunted); tier 1 refer today", 16, _pnc_ge((0, 1, 2, 3, 5, 10, 15)),
             _check_growth(["underweight"], 1),
             baby=Baby("Male", 240, laz=-3.2, waz=-3.3)),
    Scenario("Test moderately stunted", "Growth: LAZ between -3 and -2",
             "Stunted; tier 3 counsel at next visit", 16, _pnc_ge((0, 1, 2, 3, 5, 10, 15)),
             _check_growth(["stunted"], 3),
             baby=Baby("Female", 250, laz=-2.5, waz=-1.3)),
    Scenario("Test wasted", "Growth: WLZ between -3 and -2",
             "Wasted; tier 2 act this week", 16, _pnc_ge((0, 1, 2, 3, 5, 10, 15)),
             _check_growth(["wasted"], 2),
             baby=Baby("Male", 230, laz=0.0, wlz=-2.5)),
    Scenario("Test faltering", "Growth: WAZ fell more than 0.67 over 14+ days",
             "Faltering; tier 3 counsel at next visit", 16, _pnc_ge((0, 1, 2, 3, 5, 10, 15)),
             _check_growth(["faltering"], 3),
             baby=Baby("Female", 260, laz=0.0, waz=((0, 0.30), (1, 0.30), (5, 0.10), (10, -0.20), (15, -0.55)))),
    Scenario("Test growing well", "Growth: none of the four groups",
             "Growing well, not flagged", 16, _pnc_ge((0, 1, 2, 3, 5, 10, 15)),
             _check_growth([], None, well=True),
             baby=Baby("Male", 220, laz=0.2, waz=0.3)),
    Scenario("Test measurement check", "Entry checks on a new weight",
             "75 -> 'likely typing error'; 6.6 (12 % loss) -> 'weigh again, refer today'", 35,
             _pnc_ge((0, 1, 2, 3, 5, 10, 15)), _check_measure,
             baby=Baby("Female", 185, laz=0.0, waz=0.0, weights=((15, 7.5),))),
)


# ── Building the people ────────────────────────────────────────────────────

def _project(db) -> models.ProgramDistrict:
    project = db.query(models.ProgramDistrict).filter(models.ProgramDistrict.slug == PROJECT).one_or_none()
    if project is None:
        sys.exit("No Chandrapur project. Run the migrations / scripts.chandrapur_demo setup first.")
    protocol, split = visit_plan.VP.LAP_2026_11, VP.NEW_SPLIT_DAYS
    if (project.visit_protocol, project.pnc_split_days) != (protocol, split):
        sys.exit(f"STOP: Chandrapur runs visit_protocol={project.visit_protocol!r}, pnc_split_days="
                 f"{project.pnc_split_days}; expected {protocol!r} / {split} after migration e3a9c4b7d218.")
    return project


def _learner(db, project: models.ProgramDistrict) -> models.User:
    from app.auth import get_password_hash

    user = db.query(models.User).filter(models.User.email == EMAIL).one_or_none()
    if user is not None:
        _select_for_f2f(db, user, project)
        return user
    dept =db.query(models.Department).filter(models.Department.code == "WCD").one_or_none()
    desig = db.query(models.Designation).filter(models.Designation.name == "Anganwadi Worker (AWW)").one_or_none()
    taluka = (db.query(models.Block).filter(models.Block.district_id == project.reg_district_id)
              .order_by(models.Block.name).first())
    gp = (db.query(models.GramPanchayat).filter(models.GramPanchayat.block_id == taluka.id)
          .order_by(models.GramPanchayat.name).first()) if taluka else None
    qual = db.query(models.EducationalQualification).order_by(models.EducationalQualification.id).first()
    exp = db.query(models.ExperienceRange).order_by(models.ExperienceRange.id).first()
    now = datetime.now(timezone.utc)
    user = models.User(
        email=EMAIL, password_hash=get_password_hash(MOCK_PASSWORD), full_name="Test Scenario Learner",
        avatar_initials="TS", age=32, gender="Female", is_verified=True, is_admin=False,
        program_district_id=project.id, state_id=project.reg_state_id, district_id=project.reg_district_id,
        block_id=taluka.id if taluka else None, gram_panchayat_id=gp.id if gp else None,
        village_name=gp.name if gp else None, work_center_name=f"{gp.name if gp else 'Test'} AWC",
        department_id=dept.id if dept else None, department=dept.name if dept else None,
        designation_id=desig.id if desig else None, role="Anganwadi Worker (AWW)", learner_category="AWW",
        qualification_id=qual.id if qual else None, experience_range_id=exp.id if exp else None,
        years_service=6.0, years_designation=6.0, years_facility=4.0, residence_distance_km=2.0,
        marital_status="Married", has_children=False, internet_workplace="Often",
        nutrition_training="Yes", pregnancy_nutrition_training="Yes", breastfeeding_training="Yes",
        complementary_feeding_training="Yes", growth_monitoring_training="Yes",
        created_at=now - timedelta(days=90),
    )
    db.add(user)
    db.flush()
    _select_for_f2f(db, user, project)
    return user


def _select_for_f2f(db, user: models.User, project: models.ProgramDistrict) -> None:
    """Selected for face-to-face training: only then are Adoptions open (User.adoptions_open)."""
    if db.query(models.FaceToFaceSelection.id).filter(models.FaceToFaceSelection.user_id == user.id).first():
        return
    db.add(models.FaceToFaceSelection(user_id=user.id, program_district_id=project.id, uploaded_by=SEEDED_BY,
                                      notified=True, selected_at=datetime.now(timezone.utc) - timedelta(days=60)))
    db.flush()


def _stamp(on: date, seq: int) -> datetime:
    return datetime.combine(on, time(5, 0), tzinfo=timezone.utc) + timedelta(minutes=seq)


def _track(spec: Track, day: int) -> float:
    if isinstance(spec, (int, float)):
        return float(spec)
    points = sorted(spec)
    if day <= points[0][0]:
        return points[0][1]
    for (d0, z0), (d1, z1) in zip(points, points[1:]):
        if d0 <= day <= d1:
            return z0 + (z1 - z0) * (day - d0) / (d1 - d0)
    return points[-1][1]


def _sex(gender: str) -> str:
    return "boys" if gender == "Male" else "girls"


def _measure(baby: Baby, age: int, day: int) -> Tuple[float, float]:
    sex = _sex(baby.gender)
    length = round(value_for_z("lfa", sex, age, _track(baby.laz, day)), 1)
    if dict(baby.weights).get(day) is not None:
        return dict(baby.weights)[day], length
    if baby.wlz is not None:
        return round(value_for_z("wfl", sex, length, baby.wlz), 3), length
    return round(value_for_z("wfa", sex, age, _track(baby.waz, day)), 3), length


class Filler:
    """Files forms for one learner exactly as routers/forms.create_response would."""

    def __init__(self, db, learner: models.User):
        self.db, self.learner, self.rng, self.seq = db, learner, Random(20261113), 0
        self.defs = {code: _resolve_for_user(db, key, learner) for code, key in FORM_KEY.items()}
        bf_schema = self.defs[BF][1]
        self.bf_questions = [(q["id"], {o.get("verdict"): o["id"] for o in q.get("options") or []})
                             for n in (bf_schema.get("nodes") or {}).values()
                             for q in (n.get("children") or [] if n.get("kind") == "section" else [n])
                             if isinstance(q, dict) and any(o.get("verdict") for o in q.get("options") or [])]
        self.bf_greens: Dict[int, List[frozenset]] = {}

    def submit(self, code: str, on: date, answers: List[AnswerIn], *, child=None, mother=None) -> None:
        definition, schema, version = self.defs[code]
        if child is not None:
            _check_cf_gate(FORM_KEY[code], child, on)
        entry_checks.assessment_date(on, mother=mother, child=child)
        if definition.builder_type == "flat":
            snaps, summary, actions = _snapshot_flat_answers(schema, answers, child, on, enforce=True)
        else:
            snaps, summary, actions = _snapshot_answers(schema, answers)
        if code == GM:
            entry_checks.birth_weight(child, on, snaps)
            summary = _with_entry_checks(self.db, summary, child, on, snaps, [])
        self.seq += 1
        self.db.add(models.FormResponse(
            form_key=FORM_KEY[code], definition_version=version, child_id=child.id if child else None,
            mother_id=mother.id if mother else None, submitted_by_user_id=self.learner.id, assessment_date=on,
            status="submitted", answers_json=snaps, summary_json=summary, actions_json=actions,
            created_at=_stamp(on, self.seq)))
        self.db.flush()   # the next growth check's measurement checks read this one

    # One form each

    def growth(self, child: models.Child, baby: Baby, on: date, day: int, breastfed: bool) -> None:
        age = (on - child.dob).days
        weight, length = _measure(baby, age, day)
        exclusive = breastfed and age < VP.CF_SWITCH_AGE_DAYS
        foods = ["semi_solid_foods"] if age >= VP.CF_SWITCH_AGE_DAYS else ["infant_formula", "cow_s_milk"]
        prefer = {"measurement_completed": ["yes"], "measurement_location": ["mother_s_home"],
                  "breastfed_24h": ["yes" if breastfed else "no"],
                  "exclusive_breastfeeding": ["yes" if exclusive else "no"],
                  "received_other_foods": ["no" if exclusive else "yes"], "foods_given": foods,
                  "complementary_feeding_started": ["yes" if age >= VP.CF_SWITCH_AGE_DAYS else "no"],
                  "illness_since_last_visit": ["no"]}
        started = min(child.dob + timedelta(days=VP.CF_SWITCH_AGE_DAYS), on).isoformat()
        values = {"complementary_feeding_start_date": started}
        self.submit(GM, on, _flat_answers(self.defs[GM][1], on, age, weight, length, prefer, values, self.rng),
                    child=child)

    def breastfeeding(self, child: models.Child, on: date, pattern: Any) -> None:
        ids = [q for q, _ in self.bf_questions]
        done = self.bf_greens.setdefault(child.id, [])
        hidden = set().union(*(a & b for a, b in zip(done, done[1:]))) if len(done) > 1 else set()
        if hidden >= set(ids):
            hidden = set()        # the runner shows the whole form then (frontend lib/visitProtocol.ts)
        if pattern == "alternate":           # no point green twice in a row, so none drops out
            green = {q for i, q in enumerate(ids) if i % 2 == len(done) % 2}
        elif pattern == "all_green":
            green = set(ids)
        else:
            green = {ids[i] for i in pattern}
        prefer = {q: [opts["green" if q in green else "red"]] for q, opts in self.bf_questions}
        answers = [a for a in _flow_answers(self.defs[BF][1], on, 0.0, self.rng, prefer) if a.nodeId not in hidden]
        done.append(frozenset(q for q in green if q not in hidden))
        self.submit(BF, on, answers, child=child)

    def complementary(self, child: models.Child, on: date) -> None:
        self.submit(CF, on, _flow_answers(self.defs[CF][1], on, 0.0, self.rng), child=child)

    def antenatal(self, mother: models.Mother, on: date) -> None:
        schema = self.defs[AF][1]
        prefer = {"high_risk_conditions": ["none"], "pregnancy_symptoms": ["none"], "medications": ["none"],
                  "ifa_purpose": ["routine_prophylactic_supplementation_during_pregnancy"],
                  "ifa_compliance": ["7_tablets_once_daily"], "calcium_compliance": ["7_tablets_once_daily"]}
        options = {f["id"]: {o.get("value") for o in f.get("options") or []} for f in schema.get("fields") or []}
        missing = [f"{k}={v[0]}" for k, v in prefer.items() if v[0] not in options.get(k, set())]
        if missing:
            sys.exit(f"The antenatal form has changed: no option {missing}. Update the scenario answers.")
        answers = _flat_answers(schema, on, 0, (mother.weight or 50.0) + 2.0, 0.0, prefer, {}, self.rng)
        answers.append(AnswerIn(nodeId="hb_value", value="11.2"))   # hb_date: the visit day, from _flat_answers
        self.submit(AF, on, answers, mother=mother)

    PF_GRIDS = {   # (matrix, row) -> grams eaten in the past 24 hours, as servings
        "usual": {("pca_m_milk", "pca_m_milk_r3"): "1", ("pca_m_grains", "pca_m_grains_r1"): "2",
                  ("pca_m_pulses", "pca_m_pulses_r1"): "1", ("pca_m_grains", "pca_m_grains_r2"): "1"},
        # 58 g high-quality, 91 g total
        "met": {("pca_m_milk", "pca_m_milk_r1"): "2", ("pca_m_milk", "pca_m_milk_r3"): "1",
                ("pca_m_eggs", "pca_m_eggs_r1"): "2", ("pca_m_meat", "pca_m_meat_r1"): "1",
                ("pca_m_pulses", "pca_m_pulses_r1"): "1", ("pca_m_pulses", "pca_m_pulses_r2"): "0.5",
                ("pca_m_grains", "pca_m_grains_r1"): "2"},
        # 35.4 g high-quality (short of 40), 84.4 g total
        "below": {("pca_m_milk", "pca_m_milk_r1"): "2", ("pca_m_milk", "pca_m_milk_r3"): "1",
                  ("pca_m_eggs", "pca_m_eggs_r1"): "1", ("pca_m_milk", "pca_m_milk_r2"): "0.5",
                  ("pca_m_pulses", "pca_m_pulses_r2"): "1", ("pca_m_grains", "pca_m_grains_r1"): "2",
                  ("pca_m_pulses", "pca_m_pulses_r1"): "1", ("pca_m_grains", "pca_m_grains_r2"): "1"},
    }

    def protein(self, mother: models.Mother, on: date, pregnant: bool, level: str) -> None:
        schema = self.defs[PF][1]
        eaten = self.PF_GRIDS[level]
        answers: List[AnswerIn] = []
        for node in (schema.get("nodes") or {}).values():
            nid = node.get("id")
            if node.get("kind") == "matrix" and nid != "pca_m_supp":
                grid = {}
                for row in node.get("rows") or []:
                    qty = eaten.get((nid, row["id"]), "0")
                    grid[row["id"]] = {"freq": "4" if qty != "0" else "0", "usual": qty, "qty24": qty}
                answers.append(AnswerIn(nodeId=nid, value=json.dumps(grid)))
            elif node.get("questionType") == "date":
                answers.append(AnswerIn(nodeId=nid, value=on.isoformat()))
            elif nid == "pca_status":
                answers.append(AnswerIn(nodeId=nid, optionIds=["pca_status_pregnant" if pregnant else "pca_status_lactating"]))
            elif nid == "pca_diet":
                answers.append(AnswerIn(nodeId=nid, optionIds=["pca_diet_nonveg" if level != "usual" else "pca_diet_veg"]))
            elif nid == "pca_supplements":
                answers.append(AnswerIn(nodeId=nid, optionIds=["pca_supp_none"]))
        self.submit(PF, on, answers, mother=mother)


def _build(db, filler: Filler, project: models.ProgramDistrict, n: int, sc: Scenario, today: date) -> models.Mother:
    adopted = today - timedelta(days=sc.adopted_days_ago)
    lmp = today - timedelta(weeks=sc.lmp_weeks) if sc.lmp_weeks else None
    baby = sc.baby
    declared = "anc" if lmp else ("pnc_lt5" if baby.age_at_adoption < VP.NEW_SPLIT_DAYS else "pnc_ge5")
    mother = models.Mother(
        mother_uid=f"{UID_PREFIX}M{n:02d}", registered_by_user_id=filler.learner.id, mother_name=sc.name,
        adoption_date=adopted, declared_adoption_type=declared, mother_age=24, weight=52.0, height=152.0,
        lmp=lmp, edd_lmp=lmp + timedelta(days=VP.PREGNANCY_DAYS) if lmp else None,
        state_id=project.reg_state_id, district_id=project.reg_district_id, taluk_id=filler.learner.block_id,
        village=filler.learner.village_name, occupation="Homemaker", ration_card="BPL", social_category="OBC",
        created_at=datetime.combine(adopted, time(4, 30), tzinfo=timezone.utc))
    db.add(mother)
    db.flush()
    child = None
    if baby is not None:
        sex = _sex(baby.gender)
        dob = adopted - timedelta(days=baby.age_at_adoption)
        child = models.Child(
            child_uid=f"{UID_PREFIX}C{n:02d}", mother_id=mother.id, child_name=f"{sc.name} baby", dob=dob,
            adoption_date=adopted, gender=baby.gender, babies_born="Single",
            birth_weight=round(value_for_z("wfa", sex, 0, baby.birth_z), 3),
            birth_length=round(value_for_z("lfa", sex, 0, _track(baby.laz, 0)), 1),
            delivery_method="Normal vaginal delivery", delivery_place="District Hospital (DH)",
            bf_within_one_hour=True, previous_living_children=1,
            bf_counselled_on=adopted + timedelta(days=baby.counselled_day) if baby.counselled_day is not None else None,
            created_at=datetime.combine(adopted, time(4, 45), tzinfo=timezone.utc))
        db.add(child)
        db.flush()
    for v in sc.visits:
        on = adopted + timedelta(days=v.day)
        for code in v.forms:                       # CG first, then BF, CF, AF, PF — the visit's order
            if code == GM:
                filler.growth(child, baby, on, v.day, v.breastfed)
            elif code == BF:
                filler.breastfeeding(child, on, v.bf)
            elif code == CF:
                filler.complementary(child, on)
            elif code == AF:
                filler.antenatal(mother, on)
            elif code == PF:
                filler.protein(mother, on, pregnant=lmp is not None, level=v.pf)
    db.commit()
    if child is not None and any(GM in v.forms for v in sc.visits):
        # What the submission of the latest growth check sends (routers/forms._care_prompt).
        on_growth_check(db, child.id, filler.learner)
        on_feeding_check(db, child.id, filler.learner)
    return mother


# ── Removing ───────────────────────────────────────────────────────────────

def _remove(db, with_account: bool) -> None:
    user = db.query(models.User).filter(models.User.email == EMAIL).one_or_none()
    if user is None:
        print("No scenario learner; nothing to remove.")
        return
    assert user.email.endswith("@nurturehub.mock"), user.email
    mothers = db.query(models.Mother).filter(models.Mother.registered_by_user_id == user.id).all()
    scripted = [m for m in mothers if m.mother_uid.startswith(UID_PREFIX) and m.mother_name.startswith(NAME_PREFIX)]
    by_hand = [m for m in mothers if m not in scripted]
    gone = scripted + (by_hand if with_account else [])
    mother_ids = [m.id for m in gone]
    child_ids = [c for (c,) in db.query(models.Child.id).filter(models.Child.mother_id.in_(mother_ids))] if mother_ids else []
    responses = alerts = 0
    if child_ids:
        responses += db.query(models.FormResponse).filter(models.FormResponse.child_id.in_(child_ids)).delete(synchronize_session=False)
        alerts += db.query(models.CareAlert).filter(models.CareAlert.child_id.in_(child_ids)).delete(synchronize_session=False)
        db.query(models.Child).filter(models.Child.id.in_(child_ids)).delete(synchronize_session=False)
    if mother_ids:
        responses += db.query(models.FormResponse).filter(models.FormResponse.mother_id.in_(mother_ids)).delete(synchronize_session=False)
        db.query(models.Mother).filter(models.Mother.id.in_(mother_ids)).delete(synchronize_session=False)
    alerts += db.query(models.CareAlert).filter(models.CareAlert.learner_id == user.id).delete(synchronize_session=False)
    notes = db.query(models.Notification).filter(models.Notification.user_id == user.id).delete(synchronize_session=False)
    if with_account:
        db.query(models.FaceToFaceSelection).filter(models.FaceToFaceSelection.user_id == user.id).delete(synchronize_session=False)
        db.query(models.User).filter(models.User.id == user.id).delete(synchronize_session=False)
    db.commit()
    print(f"Removed {len(scripted)} scenario mothers, {len(child_ids)} babies, {responses} forms, "
          f"{alerts} care prompts, {notes} notifications" + (" and the scenario learner" if with_account else ""))
    if by_hand and with_account:
        print(f"  also {len(by_hand)} registered by hand under the scenario login: "
              + ", ".join(m.mother_name for m in by_hand))
    elif by_hand:
        print(f"  kept {len(by_hand)} registered by hand under the scenario login.")


# ── Verifying ──────────────────────────────────────────────────────────────

def _verify(db, today: date) -> bool:
    user = db.query(models.User).filter(models.User.email == EMAIL).one_or_none()
    if user is None:
        print("No scenario learner. Run --create first.")
        return False
    print(f"\nScenario learner {EMAIL}: project {user.program_district.name}, protocol "
          f"{user.visit_protocol} / split {user.pnc_split_days} d, adoptions open: {user.adoptions_open}")
    view = fieldplan.today_view(db, user, today)
    growth = growth_groups.my_babies(db, user, today)
    from app.growth_priority import assess
    from app.routers.growth import _build_cases
    z_of = {c["child"]["id"]: (assess(c) or {}).get("z") for c in _build_cases(db, user_id=user.id)}
    rows_of = {b["child_id"]: {**b, "z": z_of.get(b["child_id"])} for b in growth["babies"]}
    cases = visit_plan.learner_cases(db, user, today)
    bf_ids = [q for q, _ in Filler(db, user).bf_questions]

    rows, all_ok = [], True
    for sc in SCENARIOS:
        mother = (db.query(models.Mother).filter(models.Mother.registered_by_user_id == user.id,
                                                 models.Mother.mother_name == sc.name).one_or_none())
        if mother is None:
            rows.append((sc, False, "missing - run --create"))
            all_ok = False
            continue
        child = mother.children[0] if mother.children else None
        if child is not None:
            plan = visit_plan.child_plan(db, user, child, today, horizon_days=30)
        else:
            plan = VP.plan(cases[mother.id][0][1], today, 30)
        seen = Seen(db, mother, child, plan,
                    today=[g for g in view["today"] if g["mother_id"] == mother.id],
                    finish=[f for f in view["finish"] if f["mother_id"] == mother.id],
                    growth=rows_of.get(child.id, {}) if child is not None else {}, bf_ids=bf_ids)
        ok, shows = sc.check(seen)
        all_ok = all_ok and ok
        rows.append((sc, ok, f"{shows} | {_next_txt(seen)}"))

    print("\n" + "=" * 110)
    for sc, ok, shows in rows:
        print(f"[{'MATCH' if ok else 'MISMATCH'}] {sc.name}  ({sc.tests})")
        print(f"    expected: {sc.expect}")
        print(f"    app shows: {shows}")
    print("=" * 110)
    print(f"\nMy babies' growth: {growth['measured']} weighed, {growth['not_measured']} not weighed, "
          f"{growth['growing_well']} growing well; counts {growth['counts']}")
    print("Urgent list ('See these babies soon'), in order:")
    for i, u in enumerate(view["urgent"], 1):
        p = u.get("priority") or {}
        print(f"  {i}. {u['child_name']}: tier {p.get('tier') or '-'} (score {p.get('score')}), "
              f"status {u['status']}, reasons {', '.join(u['reasons'])}, forms {_forms_txt(u['forms'])}")
    tiers = [(u.get("priority") or {}).get("tier") or 9 for u in view["urgent"]]
    order_ok = tiers == sorted(tiers) and len({t for t in tiers}) >= 3
    print(f"  tiers in order and at least three different: {'MATCH' if order_ok else 'MISMATCH'}")
    return all_ok and order_ok


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    act = ap.add_mutually_exclusive_group(required=True)
    act.add_argument("--create", action="store_true", help="remove the previous scenario rows, build them again, verify")
    act.add_argument("--verify", action="store_true", help="print what the app shows for each scenario")
    act.add_argument("--remove", action="store_true", help="delete the scenario learner and everything under it")
    args = ap.parse_args()
    db = SessionLocal()
    today = date.today()
    try:
        if args.remove:
            _remove(db, with_account=True)
            return
        if args.create:
            project = _project(db)
            _remove(db, with_account=False)
            learner = _learner(db, project)
            filler = Filler(db, learner)
            for n, sc in enumerate(SCENARIOS, 1):
                _build(db, filler, project, n, sc, today)
            db.commit()
            print(f"Built {len(SCENARIOS)} scenarios for {EMAIL} ({filler.seq} forms) as of {today}.")
        ok = _verify(db, today)
        print("\nAll scenarios show what the spec says." if ok else "\nSome scenarios differ - see MISMATCH above.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
