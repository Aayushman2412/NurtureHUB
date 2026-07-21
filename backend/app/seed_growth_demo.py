"""Demo growth-monitoring data: learner→mother→child cases with LAP visits.

Seeds a realistic dataset for the growth charts: demo learners across the
program districts, mothers/children with varied ages and genders, and a full
LAP visit history per child (growth measurements + breastfeeding assessments
before 6 months, complementary-feeding assessments after). Weights and lengths
follow WHO percentile tracks (per-child z-score trajectories + measurement
noise) so the plotted curves look like real field data — including one
faltering baby and one above the 85th percentile.

All responses are generated through the SAME snapshot/validation code path the
API uses (`_snapshot_flat_answers` / `_snapshot_answers`), so stored payloads
are indistinguishable from real submissions.

PRODUCTION SAFETY — this is throwaway data and must be removable:
- Only seeds when SEED_DEMO_DATA=true (set false in production; nothing seeds).
- Every demo row is identifiable: learner emails end in ``@nurturehub.demo``,
  mother/child UIDs start with ``DEMO-``.
- ``python -m app.seed_growth_demo --remove`` deletes exactly those rows
  (children and form responses cascade), leaving real data untouched.
"""

import math
import sys
from datetime import date, timedelta
from random import Random
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.routers.forms import AnswerIn, _snapshot_answers, _snapshot_flat_answers
from app.who_growth import value_for_z

# LAP visit schedule (age in days): postnatal days 3–14, weeks 3/4/6/10/14,
# then 3.5–12 months, then monthly follow-up into the second year.
LAP_VISIT_DAYS = [
    3, 5, 7, 10, 12, 14, 21, 28, 42, 70, 98,
    107, 137, 167,                       # 3.5 / 4.5 / 5.5 months
    183, 198, 213, 228, 244, 274, 304, 335, 365,   # 6–12 months
    396, 426, 457, 487, 518, 548, 579, 609,        # monthly, second year
]

CF_START_AGE_DAYS = 183  # complementary feeding begins at 6 months per LAP

# Demo learners (email, name, initials, district slug, role). The two existing
# demo logins also receive cases so the learner view is populated on sign-in.
DEMO_LEARNERS = [
    ("demo.sunita@nurturehub.demo", "Sunita Pawar", "SP", "jalna", "Anganwadi Worker (AWW)"),
    ("demo.kavita@nurturehub.demo", "Kavita Malviya", "KM", "ujjain", "Anganwadi Worker (AWW)"),
    ("demo.priya@nurturehub.demo", "Priya Kharkongor", "PK", "meghalaya", "ANM / Health Worker"),
    ("demo.rekha@nurturehub.demo", "Rekha Deshmukh", "RD", "jalna", "Anganwadi Supervisor"),
]

# Cases: one entry per mother; children carry a WHO z-score trajectory
# (weight z start→end, length z start→end) that the measurements follow.
# age = child's age today, in days.
CASES = [
    {"learner": "ayushman2412@gmail.com", "mother": "Daribha Lyngdoh", "village": "Mawlai",
     "children": [
         {"name": "Banri", "gender": "Female", "age": 95, "zw": (0.2, 0.1), "zl": (0.3, 0.3),
          "bf_quality": 0.08},
     ]},
    {"learner": "ayushman2412@gmail.com", "mother": "Wanda Syiem", "village": "Nongthymmai",
     "children": [
         # The faltering baby: drifts from just under the median to below P3 —
         # the case the LAP escalation rules exist for.
         {"name": "Shem", "gender": "Male", "age": 130, "zw": (-1.0, -2.4), "zl": (-0.8, -1.4),
          "bf_quality": 0.40, "illness_prone": True},
     ]},
    {"learner": "aayushman@edupyramids.org", "mother": "Meera Rathore", "village": "Tarana",
     "children": [
         {"name": "Aarav", "gender": "Male", "age": 45, "zw": (0.5, 0.6), "zl": (0.4, 0.5),
          "bf_quality": 0.12},
     ]},
    {"learner": "aayushman@edupyramids.org", "mother": "Pooja Chouhan", "village": "Ghattia",
     "children": [
         # Recovers after complementary feeding starts.
         {"name": "Ishita", "gender": "Female", "age": 210, "zw": (-0.6, 0.0), "zl": (-0.4, -0.1),
          "bf_quality": 0.15, "cf_quality": 0.10},
     ]},
    {"learner": "demo.sunita@nurturehub.demo", "mother": "Anita Jadhav", "village": "Badnapur",
     "children": [
         {"name": "Rohan", "gender": "Male", "age": 320, "zw": (0.8, 0.6), "zl": (0.6, 0.6),
          "bf_quality": 0.10, "cf_quality": 0.12},
     ]},
    {"learner": "demo.sunita@nurturehub.demo", "mother": "Shobha Kale", "village": "Ambad",
     "children": [
         # Falters in the CF phase (poor dietary diversity).
         {"name": "Sai", "gender": "Male", "age": 480, "zw": (-1.4, -2.0), "zl": (-1.0, -1.5),
          "bf_quality": 0.20, "cf_quality": 0.45, "illness_prone": True},
     ]},
    {"learner": "demo.kavita@nurturehub.demo", "mother": "Radha Verma", "village": "Ujjain Rural",
     "children": [
         # Twins with diverging growth — above P85 vs just under the median.
         {"name": "Kiran", "gender": "Female", "age": 160, "zw": (1.5, 1.3), "zl": (1.0, 0.9),
          "bf_quality": 0.10, "twins": True},
         {"name": "Kirti", "gender": "Female", "age": 160, "zw": (-0.4, -0.6), "zl": (-0.3, -0.4),
          "bf_quality": 0.22, "twins": True},
     ]},
    {"learner": "demo.priya@nurturehub.demo", "mother": "Iba Marbaniang", "village": "Smit",
     "children": [
         {"name": "Dari", "gender": "Female", "age": 365, "zw": (0.0, 0.1), "zl": (0.1, 0.1),
          "bf_quality": 0.10, "cf_quality": 0.15},
     ]},
    {"learner": "demo.rekha@nurturehub.demo", "mother": "Vandana Patil", "village": "Partur",
     "children": [
         {"name": "Advait", "gender": "Male", "age": 620, "zw": (-0.8, -0.3), "zl": (-0.5, -0.2),
          "bf_quality": 0.14, "cf_quality": 0.18},
     ]},
]

# Newborns lose a little weight before day 7 and regain it — the dip the LAP
# day-5/day-7 rules are written around.
_NEWBORN_DIP = {3: 0.965, 5: 0.982}


def _sexkey(gender: str) -> str:
    return "boys" if gender == "Male" else "girls"


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


# ── Answer builders (payloads fed through the real snapshot functions) ──────
#
# Form definitions are admin-editable, so answers are built against the LIVE
# schema: every visible required field gets a plausible answer. Semantic
# preferences (keyed by the repo-default field ids) apply when those fields
# exist; anything else falls back to a sensible generic pick, so seeding works
# whether the deployment runs the default 24-field growth form or a customized
# one.

def _flat_answers(schema: Dict, visit_date: date, age_days: int, weight: float,
                  length: float, prefer_options: Dict[str, List[str]],
                  prefer_values: Dict[str, str], rng: Random) -> List[AnswerIn]:
    choice_types = {"dropdown", "radio", "checkbox"}
    # Guard non-dict entries and missing ids up front (mirrors the server, which
    # filters `isinstance(f, dict) and f.get("id")` before touching a field).
    fields = [f for f in (schema.get("fields") or []) if isinstance(f, dict) and f.get("id")]

    # Build a candidate answer for EVERY field, then hand them all to the server
    # unfiltered. The server (_snapshot_flat_answers) builds its values map from
    # all answers FIRST and evaluates showIf SECOND, so answering fields
    # incrementally in list order and gating on visibility would diverge
    # whenever a field's showIf references a field defined later. Emitting every
    # candidate keeps the server's values map identical to the intended one; the
    # server snapshots only the visible subset and ignores the rest, so what
    # gets stored equals a real client's submission and seeding never trips a
    # required-but-hidden field.
    candidates: List[AnswerIn] = []

    for f in fields:
        fid = f["id"]
        ftype = f.get("type") or "text"

        if ftype in choice_types:
            opts = [o.get("value") for o in (f.get("options") or [])
                    if isinstance(o, dict) and o.get("value")]
            if not opts:
                continue
            want = [v for v in (prefer_options.get(fid) or []) if v in opts]
            if not want:
                # generic: a yes/no field answers "yes", otherwise first option
                want = ["yes"] if "yes" in opts else [opts[0]]
            if ftype != "checkbox":
                want = want[:1]
            candidates.append(AnswerIn(nodeId=fid, optionIds=want))
        elif ftype == "number":
            key = f"{fid} {f.get('label') or ''}".lower()
            if "weight" in key:
                val = weight
            elif "length" in key or "height" in key:
                val = length
            elif f.get("required", True):
                val = f.get("min") if f.get("min") is not None else 1.0
            else:
                continue
            if f.get("min") is not None:
                val = max(val, f["min"])
            if f.get("max") is not None:
                val = min(val, f["max"])
            candidates.append(AnswerIn(nodeId=fid, value=_format_number(val, f.get("decimals"))))
        elif ftype == "date":
            candidates.append(AnswerIn(nodeId=fid, value=prefer_values.get(fid) or visit_date.isoformat()))
        elif ftype == "image":
            # A real photo upload isn't seeded, but a required image field would
            # otherwise fail server validation — store a placeholder URL.
            if f.get("required", True):
                candidates.append(AnswerIn(nodeId=fid, value="/uploads/demo/measurement-placeholder.jpg"))
        else:  # text / textarea
            if f.get("required", True) or fid in prefer_values:
                candidates.append(AnswerIn(
                    nodeId=fid, value=prefer_values.get(fid) or "Recorded during LAP home visit."))

    return candidates


def _format_number(val: float, decimals: Optional[int]) -> str:
    """Format a numeric answer, rounding UP to the field's precision so a value
    seeded at the field's `min` never rounds strictly below it (which the server
    would reject). Whole/exact values are unaffected."""
    places = decimals if decimals is not None else 3
    factor = 10 ** places
    rounded = math.ceil(round(val * factor, 6)) / factor
    return f"{rounded:.{places}f}"


def _growth_answers(schema: Dict, child_spec: Dict, visit_day: int, visit_date: date,
                    dob: date, weight: float, length: float, rng: Random) -> List[AnswerIn]:
    ebf = visit_day < CF_START_AGE_DAYS
    illness = bool(child_spec.get("illness_prone")) and visit_day > 14 and rng.random() < 0.30
    cf_started = visit_day >= CF_START_AGE_DAYS

    foods = ["semi_solid_foods", "plain_water"]
    if visit_day >= 270:
        foods.append("solid_foods")

    prefer_options = {
        "measurement_completed": ["yes"],
        "measurement_location": (["postnatal_ward_normal_delivery"] if visit_day <= 2
                                 else [rng.choice(["mother_s_home", "mother_s_home", "anganwadi_centre"])]),
        "location": [rng.choice(["mother's_home", "mother's_home", "anganwadi_center"])],
        "breastfed_24h": ["yes" if visit_day < 548 else "no"],
        "exclusive_breastfeeding": ["yes" if ebf else "no"],
        "received_other_foods": ["no" if ebf else "yes"],
        "foods_given": foods,
        "complementary_feeding_started": ["yes" if cf_started else "no"],
        "illness_since_last_visit": ["yes" if illness else "no"],
        "illness_type": rng.choice([["fever"], ["diarrhoea"],
                                    ["cough", "cold_upper_respiratory_infection_uri"]]),
        "illness_duration": [rng.choice(["1_2_days", "3_5_days"])],
        "feeding_during_illness": ["less_than_usual"],
        "health_services": [rng.choice(["asha_advice", "anganwadi_worker_aww_advice",
                                        "primary_health_centre_phc_visit"])],
    }
    cf_start = dob + timedelta(days=CF_START_AGE_DAYS + rng.randint(-10, 10))
    prefer_values = {
        "complementary_feeding_start_date": min(cf_start, visit_date).isoformat(),
        "notes": "Routine LAP home visit; measurements recorded.",
    }
    return _flat_answers(schema, visit_date, visit_day, weight, length,
                         prefer_options, prefer_values, rng)


def _flow_answers(schema: Dict, visit_date: date, red_p: float, rng: Random,
                  prefer_options: Optional[Dict[str, List[str]]] = None) -> List[AnswerIn]:
    """One pick per reachable flow question, chosen from the LIVE options by
    verdict: red with probability ``red_p``, else green, else any."""
    prefer = prefer_options or {}
    answers: List[AnswerIn] = []
    for node in (schema.get("nodes") or {}).values():
        if not isinstance(node, dict):
            continue
        questions = node.get("children") or [] if node.get("kind") == "section" else [node]
        for q in questions:
            if not isinstance(q, dict) or not q.get("id"):
                continue
            qid = q["id"]
            if (q.get("questionType") or "single") == "date":
                answers.append(AnswerIn(nodeId=qid, value=visit_date.isoformat()))
                continue
            opts = [o for o in (q.get("options") or []) if isinstance(o, dict) and o.get("id")]
            if not opts:
                continue
            want = [oid for oid in (prefer.get(qid) or []) if any(o["id"] == oid for o in opts)]
            if not want:
                reds = [o["id"] for o in opts if o.get("verdict") == "red"]
                greens = [o["id"] for o in opts if o.get("verdict") == "green"]
                if reds and rng.random() < red_p:
                    want = [rng.choice(reds)]
                elif greens:
                    want = [rng.choice(greens)]
                    if q.get("questionType") == "multi" and len(greens) > 1 and rng.random() < 0.5:
                        want.append(rng.choice([g for g in greens if g != want[0]]))
                else:
                    want = [rng.choice([o["id"] for o in opts])]
            answers.append(AnswerIn(nodeId=qid, optionIds=want))
    return answers


def _bf_red_p(visit_day: int, base_red: float) -> float:
    """New mothers start redder and improve as visits (and coaching) progress."""
    return min(0.55, max(0.03, base_red + (0.18 if visit_day <= 21 else 0.0)
                         - 0.10 * min(visit_day / 365.0, 1.0)))


# ── Seeder ───────────────────────────────────────────────────────────────────

def _ensure_demo_learners(db: Session) -> Dict[str, models.User]:
    from app.auth import get_password_hash
    districts = {pd.slug: pd for pd in db.query(models.ProgramDistrict).all()}
    users: Dict[str, models.User] = {}

    for email, name, initials, slug, role in DEMO_LEARNERS:
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            pd = districts.get(slug)
            user = models.User(
                email=email, password_hash=get_password_hash("password123"),
                full_name=name, is_verified=True, avatar_initials=initials,
                program_district_id=pd.id if pd else None, role=role,
            )
            db.add(user)
        users[email] = user

    for email in {c["learner"] for c in CASES}:
        if email not in users:
            user = db.query(models.User).filter(models.User.email == email).first()
            if user:
                users[email] = user
    db.flush()
    return users


def seed_growth_demo(db: Session) -> None:
    """Idempotent (guards on DEMO- mothers). Call only when SEED_DEMO_DATA."""
    if not settings.SEED_DEMO_DATA:
        return
    if db.query(models.Mother).filter(models.Mother.mother_uid.like("DEMO-%")).count() > 0:
        return

    definitions = {
        key: db.query(models.FormDefinition).filter(models.FormDefinition.form_key == key).first()
        for key in ("growth_monitoring", "breastfeeding", "complementary_feeding")
    }
    if not all(definitions.values()):
        print("Growth demo: form definitions missing, skipping.")
        return

    print("Seeding demo growth-monitoring cases (learners/mothers/children/visits)...")
    rng = Random(20260721)  # deterministic — reseeding produces identical data
    users = _ensure_demo_learners(db)
    today = date.today()
    mother_seq = child_seq = 0
    response_count = 0

    for case in CASES:
        learner = users.get(case["learner"])
        if not learner:
            continue
        mother_seq += 1
        mother = models.Mother(
            mother_uid=f"DEMO-MR-{mother_seq:03d}",
            registered_by_user_id=learner.id,
            mother_name=case["mother"],
            mother_age=rng.randint(21, 34),
            mobile=f"9{rng.randint(100000000, 999999999)}",
            village=case["village"],
        )
        db.add(mother)
        db.flush()

        for spec in case["children"]:
            child_seq += 1
            age = spec["age"]
            dob = today - timedelta(days=age)
            sex = _sexkey(spec["gender"])
            zw0, zw1 = spec["zw"]
            zl0, zl1 = spec["zl"]

            child = models.Child(
                child_uid=f"DEMO-CR-{child_seq:03d}",
                mother_id=mother.id,
                child_name=f"{spec['name']} {case['mother'].split()[-1]}",
                dob=dob,
                gender=spec["gender"],
                birth_weight=round(value_for_z("wfa", sex, 0, zw0), 3),
                birth_length=round(value_for_z("lfa", sex, 0, zl0), 1),
                babies_born="Twins" if spec.get("twins") else "Single",
                delivery_method=rng.choice(["Normal", "Normal", "C-Section"]),
                delivery_place=rng.choice(["PHC", "District Hospital", "CHC"]),
                bf_within_one_hour=rng.random() < 0.8,
            )
            db.add(child)
            db.flush()

            diet = rng.choice(["cf_diet_veg", "cf_diet_veg", "cf_diet_nonveg", "cf_diet_egg"])
            for visit_day in LAP_VISIT_DAYS:
                if visit_day > age:
                    break
                visit_date = dob + timedelta(days=visit_day)
                progress = visit_day / max(age, 1)
                zw = _lerp(zw0, zw1, progress) + rng.gauss(0, 0.07)
                zl = _lerp(zl0, zl1, progress) + rng.gauss(0, 0.05)
                weight = value_for_z("wfa", sex, visit_day, zw)
                length = value_for_z("lfa", sex, visit_day, zl)
                if weight is None or length is None:
                    continue
                weight = round(weight * _NEWBORN_DIP.get(visit_day, 1.0), 3)
                length = round(length, 1)

                # Which forms this visit files: BF accompanies the BF phase,
                # CF the complementary-feeding phase; some visits are a quick
                # growth-only weighing (e.g. vaccination day).
                growth_only = rng.random() < (0.15 if visit_day < CF_START_AGE_DAYS else 0.30)
                if spec.get("bf_quality", 0.1) >= 0.4:
                    growth_only = False  # struggling dyads get the full assessment

                visit_forms = []  # (form_key, answers_json, summary, actions)
                g_schema = definitions["growth_monitoring"].schema_json
                snapshots, summary, actions = _snapshot_flat_answers(
                    g_schema,
                    _growth_answers(g_schema, spec, visit_day, visit_date, dob, weight, length, rng),
                    child, visit_date, enforce=True,
                )
                visit_forms.append(("growth_monitoring", snapshots, summary, actions))

                if not growth_only and visit_day < CF_START_AGE_DAYS:
                    bf_schema = definitions["breastfeeding"].schema_json
                    snapshots, summary, actions = _snapshot_answers(
                        bf_schema,
                        _flow_answers(bf_schema, visit_date,
                                      _bf_red_p(visit_day, spec.get("bf_quality", 0.1)), rng),
                    )
                    visit_forms.append(("breastfeeding", snapshots, summary, actions))
                elif not growth_only and visit_day >= CF_START_AGE_DAYS:
                    cf_schema = definitions["complementary_feeding"].schema_json
                    snapshots, summary, actions = _snapshot_answers(
                        cf_schema,
                        _flow_answers(cf_schema, visit_date, spec.get("cf_quality", 0.15), rng,
                                      prefer_options={"cf_diet_type": [diet]}),
                    )
                    visit_forms.append(("complementary_feeding", snapshots, summary, actions))

                for form_key, snapshots, summary, actions in visit_forms:
                    db.add(models.FormResponse(
                        form_key=form_key,
                        definition_version=definitions[form_key].version,
                        child_id=child.id,
                        submitted_by_user_id=learner.id,
                        assessment_date=visit_date,
                        status="submitted",
                        answers_json=snapshots,
                        summary_json=summary,
                        actions_json=actions,
                    ))
                    response_count += 1

    db.commit()
    print(f"Growth demo: seeded {mother_seq} mothers, {child_seq} children, "
          f"{response_count} form responses.")


def remove_growth_demo_data(db: Session) -> None:
    """Delete every demo row this module can create: DEMO- mothers (children
    and their form responses cascade) and @nurturehub.demo learner accounts.
    Real registrations are untouched — run before go-live if a demo database
    is being promoted."""
    mothers = db.query(models.Mother).filter(models.Mother.mother_uid.like("DEMO-%")).all()
    for mother in mothers:
        db.delete(mother)  # ORM cascades children; DB FK cascades their responses
    demo_users = db.query(models.User).filter(models.User.email.like("%@nurturehub.demo")).all()
    for user in demo_users:
        db.delete(user)
    db.commit()
    print(f"Removed {len(mothers)} demo mothers (+children/responses) and "
          f"{len(demo_users)} demo learner accounts.")


if __name__ == "__main__":
    from app.database import SessionLocal

    session = SessionLocal()
    try:
        if "--remove" in sys.argv:
            remove_growth_demo_data(session)
        else:
            seed_growth_demo(session)
    finally:
        session.close()
