"""Demo adoptions for the MASD dashboard and the growth monitor.

Gives the face-to-face-selected mock learners (``@nurturehub.mock``) of Jalna,
Ujjain and Khasi a full programme's worth of field work, so the MASD report and
the growth monitor can be shown end to end:

  * adoptions of every type — ANC, PNC <5 months, PNC ≥5 months, and a Staff
    Nurse's hospital PNC<5M adoptions — across both tranches;
  * learners who behave differently — steady, star (these become the Master
    Trainers / Facilitators), over-adopting, under-adopting, fading away,
    registering cases but filing nothing, adopting nobody, skipping
    complementary feeding — and blocks that are stronger or weaker than others;
  * growth that improves for most children, stalls for some and worsens for a
    few, with WHO-consistent weights and lengths;
  * the edge cases the report's data-quality checks exist for: every primary
    exclusion reason, twins, a mother who cannot be typed, children adopted at
    exactly 149 and 150 days, an adoption before the training date, a visit
    where the child could not be measured, and a few learners outside F2F
    training who registered cases anyway.

Every form answer goes through the same snapshot/validation code the API uses,
so the stored payloads look exactly like real submissions.

Adoptions follow each project's target steps (one of each type after
training, more at each review — Jalna ends on 3 ANC · 5 PNC<5M · 3 PNC≥5M),
and each case's forms are its expected forms (app/masd/rules.case_expected)
scaled by how diligent its learner is. Pregnancies are taken on in the last
trimester and checked every fortnight; some births are never entered, so the
dashboard has overdue pregnancies to flag. Each project gets five F2F
training batches, its learners split across them by block.

Idempotent and removable. Every seeded mother and child has a UID starting
``MASD-``; nothing else is touched except the learners' MT/FL mark and batch,
the three projects' MASD calendar and targets, and the batches it created.

  cd backend
  ./venv-win/Scripts/python.exe -m scripts.seed_masd_demo            # seed (skips if present)
  ./venv-win/Scripts/python.exe -m scripts.seed_masd_demo --reseed   # remove, then seed again
  ./venv-win/Scripts/python.exe -m scripts.seed_masd_demo --remove   # remove only
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, time as dtime, timedelta, timezone
from random import Random
from typing import Dict, List, Optional, Tuple

import app.models_live  # noqa: F401  (registers every table)
from app import models
from app.database import SessionLocal
from app.masd import rules as R
from app.masd.data import expected_forms_for
from app.routers.forms import AnswerIn, _snapshot_answers, _snapshot_flat_answers
from app.seed_growth_demo import _flat_answers, _flow_answers, _format_number, _growth_answers
from app.who_growth import value_for_z

MARK = "MASD-"
SEEDED_BY = "seed_masd_demo"
MOCK_DOMAIN = "@nurturehub.mock"

# Programme calendar, counted back from today: (days before today of the F2F
# training, days from training to tranche 2). With the batches ending up to
# eight days before it, every learner's follow-up counts as 90 days on the day
# the demo is seeded — the figure agreed for 29 Sep 2026 — and the third target
# step (tranche 2 + 45 days) is in force.
PROJECTS = {
    "jalna": {"training_days_ago": 106, "tranche2_after": 42, "state": "mh"},
    "ujjain": {"training_days_ago": 106, "tranche2_after": 42, "state": "mp"},
    "khasi": {"training_days_ago": 106, "tranche2_after": 42, "state": "ml"},
}

# The five F2F batches end this many days before the project's training date.
BATCH_ENDS_BEFORE_TRAINING = (8, 6, 4, 2, 0)

NAMES = {
    "mh": (["Sunita", "Kavita", "Pooja", "Swati", "Anjali", "Priyanka", "Sonali", "Ashwini", "Manisha",
            "Jyoti", "Rupali", "Shital", "Vaishali", "Pallavi", "Komal", "Dipali", "Monika", "Snehal"],
           ["Jadhav", "Pawar", "Shinde", "Kale", "Deshmukh", "Patil", "More", "Gaikwad", "Wagh", "Bhosale"],
           ["Ambad", "Badnapur", "Bhokardan", "Ghansawangi", "Jafrabad", "Mantha", "Partur", "Jalna"]),
    "mp": (["Rekha", "Seema", "Radha", "Kiran", "Meena", "Sapna", "Neha", "Rani", "Lakshmi", "Sarita",
            "Pinki", "Mamta", "Durga", "Savita", "Sangeeta", "Babita", "Geeta", "Nisha"],
           ["Verma", "Malviya", "Chouhan", "Rathore", "Solanki", "Parmar", "Yadav", "Patel", "Sharma"],
           ["Tarana", "Ghattia", "Khachrod", "Mahidpur", "Nagda", "Badnagar", "Ujjain Rural"]),
    "ml": (["Daribha", "Iba", "Banri", "Wanda", "Ridalin", "Phidalia", "Sanbha", "Ibashisha", "Dasuklang",
            "Everlasting", "Kynjai", "Lamphrang", "Mebanshai", "Wanshai", "Badaplin", "Rilang"],
           ["Lyngdoh", "Syiem", "Kharkongor", "Marbaniang", "Nongrum", "Rymbai", "Dkhar", "Kharbuli"],
           ["Mawlai", "Nongthymmai", "Smit", "Mawkyrwat", "Sohra", "Mylliem", "Mawphlang"]),
}

# How each learner behaves. f = share of their cases' expected activities
# they file; quiet = days of silence before today; extra/drop = adoptions
# above/below the targets.
PROFILES = {
    "star":    {"weight": 12, "f": (0.95, 1.15), "quiet": (0, 3), "trend": 0.55, "extra": (1, 2)},
    "steady":  {"weight": 36, "f": (0.62, 0.86), "quiet": (0, 6), "trend": 0.35, "extra": (0, 2)},
    "over":    {"weight": 12, "f": (0.42, 0.58), "quiet": (0, 5), "trend": 0.12, "extra": (2, 4)},
    "under":   {"weight": 12, "f": (0.55, 0.80), "quiet": (0, 8), "trend": 0.18, "drop": (2, 4)},
    "fading":  {"weight": 12, "f": (0.55, 0.80), "quiet": (18, 45), "trend": 0.08},
    "cf_skip": {"weight": 8,  "f": (0.62, 0.84), "quiet": (0, 6), "trend": 0.15, "no_cf": True},
    "silent":  {"weight": 4,  "f": (0.0, 0.0), "quiet": (0, 0), "trend": 0.0, "drop": (2, 4)},
    "zero":    {"weight": 4,  "f": (0.0, 0.0), "quiet": (0, 0), "trend": 0.0},
}
NURSE_PROFILES = {"nurse_good": 0.5, "nurse_low": 0.5}

# Data-quality edge cases (and how many of each per project, varied a little
# so the three projects do not look identical).
_PNC_EDGES = {"no_adoption_details", "mother_after_lv", "birth_weight_extreme", "birth_vs_visit1",
              "dob_vs_visit1", "adoption_vs_visit", "only_adoption_visit", "only_birth_anthropometry",
              "z_missing", "baby_before_mother", "twins", "pre_training", "unmeasured_visit"}
_EDGES_FOR = {
    R.ANC: {"anc_not_followed", "unknown_type", "pre_training"},
    R.PNC_LT5: _PNC_EDGES | {"age_149"},
    R.PNC_GE5: _PNC_EDGES | {"age_150"},
}

EDGES = ["no_adoption_details", "mother_after_lv", "birth_weight_extreme", "birth_vs_visit1",
         "dob_vs_visit1", "adoption_vs_visit", "only_adoption_visit", "only_birth_anthropometry",
         "z_missing", "baby_before_mother", "twins", "unknown_type", "age_149", "age_150",
         "pre_training", "anc_not_followed", "unmeasured_visit"]


@dataclass
class Plan:
    type: str
    tranche: int
    on: date
    edge: Optional[str] = None


@dataclass
class Ctx:
    db: object
    rng: Random
    today: date
    training: date
    tranche2: date
    defs: Dict[str, Tuple[dict, int]]      # form_key -> (schema, version_number)
    names: Tuple[list, list, list]
    project_slug: str
    steps: List[Dict[str, object]] = field(default_factory=list)
    table: Dict[str, object] = field(default_factory=R.default_expected_forms)
    counters: Dict[str, int] = field(default_factory=lambda: {"mothers": 0, "children": 0, "responses": 0})
    seq: int = 0


# ── Answer builders ────────────────────────────────────────────────────────


def _response(ctx: Ctx, form_key: str, learner_id: int, on: date, answers, summary, actions,
              mother_id=None, child_id=None) -> models.FormResponse:
    schema, version = ctx.defs[form_key]
    ctx.counters["responses"] += 1
    stamp = datetime.combine(on, dtime(10, 0), tzinfo=timezone.utc) + timedelta(minutes=ctx.rng.randint(0, 420))
    return models.FormResponse(
        form_key=form_key, definition_version=version, child_id=child_id, mother_id=mother_id,
        submitted_by_user_id=learner_id, assessment_date=on, status="submitted",
        answers_json=answers, summary_json=summary, actions_json=actions, created_at=stamp,
    )


def growth_response(ctx: Ctx, learner_id: int, child: models.Child, on: date,
                    weight: Optional[float], length: Optional[float], illness: bool):
    schema, _ = ctx.defs["growth_monitoring"]
    visit_day = (on - child.dob).days if child.dob else 30
    if weight is None:
        # Could not measure: the form then asks why instead of the numbers.
        answers = _flat_answers(
            schema, on, visit_day, 0.0, 0.0,
            {"measurement_completed": ["no"],
             "measurement_not_done_reason": [ctx.rng.choice(["house_was_locked", "mother_and_child_not_present"])],
             "breastfed_24h": ["yes"], "received_other_foods": ["no"],
             "illness_since_last_visit": ["no"]},
            {}, ctx.rng,
        )
    else:
        answers = _growth_answers(schema, {"illness_prone": illness}, max(visit_day, 0), on,
                                  child.dob or on, weight, length, ctx.rng)
    snaps, summary, actions = _snapshot_flat_answers(schema, answers, child, on, enforce=True)
    return _response(ctx, "growth_monitoring", learner_id, on, snaps, summary, actions, child_id=child.id)


def flow_response(ctx: Ctx, form_key: str, learner_id: int, on: date, red_p: float,
                  child_id=None, prefer=None):
    schema, _ = ctx.defs[form_key]
    snaps, summary, actions = _snapshot_answers(schema, _flow_answers(schema, on, red_p, ctx.rng, prefer))
    return _response(ctx, form_key, learner_id, on, snaps, summary, actions, child_id=child_id)


def antenatal_response(ctx: Ctx, learner_id: int, mother: models.Mother, on: date, weight: float):
    schema, _ = ctx.defs["antenatal"]
    rng = ctx.rng
    risk = rng.random() < 0.18
    prefer = {
        "high_risk_conditions": ([rng.choice(["short_stature_145_cm", "previous_caesarean_section",
                                              "age_more_than_35_years"])] if risk else ["none"]),
        "pregnancy_symptoms": rng.choice([["nausea"], ["heartburn_acidity"], ["swelling_of_feet"],
                                          ["excessive_tiredness", "constipation"], ["none"]]),
        "ifa_purpose": [rng.choice(["routine_prophylactic_supplementation_during_pregnancy"] * 4
                                   + ["treatment_of_diagnosed_anaemia", "not_taking_ifa_currently"])],
        "ifa_compliance": [rng.choice(["7_tablets_once_daily", "7_tablets_once_daily", "4_6_tablets",
                                       "14_tablets_twice_daily", "1_3_tablets"])],
        "calcium_compliance": [rng.choice(["7_tablets_once_daily", "14_tablets_twice_daily", "4_6_tablets",
                                           "calcium_tablets_unavailable"])],
        "medications": ["none"],
    }
    answers = _flat_answers(schema, on, 0, weight, 0.0, prefer, {}, rng)
    answers.append(AnswerIn(nodeId="hb_value", value=f"{rng.uniform(8.6, 12.8):.1f}"))
    answers.append(AnswerIn(nodeId="hb_date", value=(on - timedelta(days=rng.randint(0, 20))).isoformat()))
    snaps, summary, actions = _snapshot_flat_answers(schema, answers, None, on, enforce=True)
    return _response(ctx, "antenatal", learner_id, on, snaps, summary, actions, mother_id=mother.id)


def protein_response(ctx: Ctx, learner_id: int, mother: models.Mother, on: date, pregnant: bool, diet: str):
    schema, _ = ctx.defs["mother_protein_intake"]
    rng = ctx.rng
    answers: List[AnswerIn] = []
    for node in (schema.get("nodes") or {}).values():
        nid, kind = node.get("id"), node.get("kind")
        if kind == "matrix":
            if nid == "pca_m_supp":
                continue
            grid = {}
            for row in node.get("rows") or []:
                days = rng.choice([0, 0, 1, 2, 3, 4, 7] if nid not in ("pca_m_eggs", "pca_m_meat") or diet != "pca_diet_veg" else [0])
                usual = "0" if days == 0 else rng.choice(["0.5", "1", "1", "1.5", "2"])
                grid[row["id"]] = {"freq": str(days), "usual": usual,
                                   "qty24": "0" if days < 3 else rng.choice(["0", "0.5", "1"])}
            answers.append(AnswerIn(nodeId=nid, value=json.dumps(grid)))
        elif node.get("questionType") == "date":
            answers.append(AnswerIn(nodeId=nid, value=on.isoformat()))
        elif nid == "pca_status":
            answers.append(AnswerIn(nodeId=nid, optionIds=["pca_status_pregnant" if pregnant else "pca_status_lactating"]))
        elif nid == "pca_diet":
            answers.append(AnswerIn(nodeId=nid, optionIds=[diet]))
        elif nid == "pca_supplements":
            opts = [o["id"] for o in node.get("options") or []]
            none = [o for o in opts if o.endswith("none")]
            answers.append(AnswerIn(nodeId=nid, optionIds=none[:1] or opts[:1]))
    snaps, summary, actions = _snapshot_answers(schema, answers)
    return _response(ctx, "mother_protein_intake", learner_id, on, snaps, summary, actions, mother_id=mother.id)


# ── People ─────────────────────────────────────────────────────────────────


def _pick_weighted(rng: Random, table: Dict[str, float]) -> str:
    total = sum(table.values())
    x = rng.uniform(0, total)
    for key, w in table.items():
        x -= w
        if x <= 0:
            return key
    return next(iter(table))


def new_mother(ctx: Ctx, learner: models.User, adoption_date: Optional[date], lmp: Optional[date]) -> models.Mother:
    rng = ctx.rng
    first, last, villages = ctx.names
    ctx.seq += 1
    age = _pick_weighted(rng, {"a": 3, "b": 55, "c": 39, "d": 2, "x": 1})
    age_val = {"a": rng.randint(16, 18), "b": rng.randint(19, 24), "c": rng.randint(25, 36),
               "d": rng.randint(37, 42), "x": None}[age]
    social = (_pick_weighted(rng, {"ST": 84, "SC": 3, "OBC": 3, "General": 7, "Do not know": 3})
              if ctx.project_slug == "khasi" else
              _pick_weighted(rng, {"General": 40, "OBC": 28, "SC": 18, "ST": 9, "Do not know": 5}))
    mother = models.Mother(
        mother_uid=f"{MARK}{ctx.project_slug[:2].upper()}M{ctx.seq:05d}",
        registered_by_user_id=learner.id,
        mother_name=f"{rng.choice(first)} {rng.choice(last)}",
        adoption_date=adoption_date,
        mother_age=age_val,
        weight=round(rng.uniform(42, 68), 1),
        height=round(rng.uniform(142, 166), 1),
        lmp=lmp,
        edd_lmp=(lmp + timedelta(days=280)) if lmp else None,
        mobile=f"9{rng.randint(100000000, 999999999)}",
        village=rng.choice(villages),
        ration_card=_pick_weighted(rng, {"BPL": 40, "APL": 34, "AAY": 12, "No ration card": 5,
                                         "Eligible for BPL but not applied": 6, "Others": 3}),
        social_category=social,
        occupation=_pick_weighted(rng, {"Homemaker": 70, "Agriculture": 18, "Unskilled Worker": 8,
                                        "Service Provider": 4}),
        created_at=datetime.combine(adoption_date or ctx.today, dtime(9, 30), tzinfo=timezone.utc)
        + timedelta(days=rng.randint(0, 2)),
    )
    mother.sync_lookups()
    ctx.db.add(mother)
    ctx.db.flush()
    ctx.counters["mothers"] += 1
    return mother


def new_child(ctx: Ctx, mother: models.Mother, dob: date, adoption_date: Optional[date],
              gender: Optional[str], birth_weight: Optional[float], birth_length: Optional[float],
              twins: bool = False) -> models.Child:
    rng = ctx.rng
    ctx.seq += 1
    place = _pick_weighted(rng, {"District Hospital (DH)": 18, "Rural Hospital (RH)": 12,
                                 "Sub-District Hospital (SDH)": 8, "Community Health Centre (CHC)": 10,
                                 "Primary Health Centre (PHC)": 7, "Private Hospital/Nursing Home": 40,
                                 "Home": 3, "Other": 2})
    child = models.Child(
        child_uid=f"{MARK}{ctx.project_slug[:2].upper()}C{ctx.seq:05d}",
        mother=mother,
        child_name=f"Baby of {mother.mother_name.split()[0]}",
        dob=dob, adoption_date=adoption_date, gender=gender,
        birth_weight=birth_weight, birth_length=birth_length,
        babies_born="Twins" if twins else "Single",
        delivery_method=_pick_weighted(rng, {"Normal vaginal delivery": 68, "Caesarean section": 30,
                                             "Assisted vaginal delivery": 2}),
        delivery_place=place,
        delivery_place_other="Relative's house" if place == "Other" else None,
        bf_within_one_hour=rng.random() < 0.78,
        previous_living_children=rng.choice([0, 0, 1, 1, 2]),
        created_at=datetime.combine(adoption_date or dob, dtime(11, 0), tzinfo=timezone.utc),
    )
    ctx.db.add(child)
    ctx.counters["children"] += 1
    return child


# ── Growth ─────────────────────────────────────────────────────────────────


def _birth(rng: Random, sex: str) -> Tuple[float, float, float, float]:
    waz = max(-3.2, min(2.2, rng.gauss(-0.7, 0.9)))
    haz = max(-3.2, min(2.2, rng.gauss(-0.5, 0.9)))
    bw = round(value_for_z("wfa", sex, 0, waz), 3)
    bl = round(value_for_z("lfa", sex, 0, haz), 1)
    return bw, bl, waz, haz


def _measure(rng: Random, sex: str, age: int, haz: float, whz: float) -> Tuple[float, float]:
    length = value_for_z("lfa", sex, max(age, 0), haz)
    weight = value_for_z("wfl", sex, length, whz) if length and 45 <= length <= 110 else None
    if weight is None:
        weight = value_for_z("wfa", sex, max(age, 0), whz * 0.6 + haz * 0.4)
    weight = min(30.0, max(1.0, weight * rng.uniform(0.992, 1.008)))
    length = min(120.0, max(30.0, length))
    return round(weight, 3), round(length, 1)


def _dates(rng: Random, start: date, end: date, n: int) -> List[date]:
    """n visit dates from `start` (the adoption visit) to `end`, denser early."""
    if n <= 0 or end < start:
        return []
    span = (end - start).days
    out = [start]
    for i in range(1, n):
        t = (i / max(n - 1, 1)) ** 1.25
        d = start + timedelta(days=max(1, round(span * t) + rng.randint(-2, 2)))
        out.append(min(end, d))
    seen, uniq = set(), []
    for d in sorted(out):
        if d not in seen:
            seen.add(d)
            uniq.append(d)
    return uniq


def child_visits(ctx: Ctx, learner: models.User, child: models.Child, start: date, end: date,
                 n_gm: int, n_bf: int, n_cf: int, n_protein: int, mother: models.Mother,
                 trend: float, edge: Optional[str], bf_quality: float, cf_quality: float,
                 dates: Optional[List[date]] = None) -> List[date]:
    rng = ctx.rng
    sex = "boys" if child.gender == "Male" else "girls"
    visits = list(dates) if dates is not None else _dates(rng, start, end, n_gm)
    if edge == "only_adoption_visit":
        visits = visits[:1]
    elif edge == "only_birth_anthropometry":
        visits = []
    elif edge == "adoption_vs_visit" and visits:
        visits[0] = start + timedelta(days=rng.randint(18, 26))
        visits = sorted(set(d for d in visits if d >= visits[0]))
    elif edge == "dob_vs_visit1" and child.dob:
        visits = [child.dob - timedelta(days=rng.randint(4, 9))] + visits
    # Recent adoptions: no visit can be dated after today.
    visits = sorted({d for d in visits if d <= ctx.today})
    haz0 = max(-3.4, min(1.8, rng.gauss(-0.8, 1.05)))
    whz0 = max(-3.4, min(1.8, rng.gauss(-0.55, 1.05)))
    d_h = trend * rng.uniform(0.5, 1.2) + rng.gauss(0, 0.25)
    d_w = trend * rng.uniform(0.7, 1.4) + rng.gauss(0, 0.3)
    span = max(1, (visits[-1] - visits[0]).days) if visits else 1
    unmeasured_at = rng.randrange(1, len(visits)) if (edge == "unmeasured_visit" and len(visits) > 2) else None
    illness_prone = rng.random() < 0.2
    for i, on in enumerate(visits):
        age = (on - child.dob).days if child.dob else 60
        p = (on - visits[0]).days / span
        if child.dob and 0 <= age <= 3 and child.birth_weight:
            weight = round(child.birth_weight * (0.97 if age >= 2 else 1.0), 3)
            length = child.birth_length or _measure(rng, sex, age, haz0, whz0)[1]
            if edge == "birth_vs_visit1" and i == 0:
                weight = round(weight + rng.choice([-0.8, 0.9]), 3)
        else:
            weight, length = _measure(rng, sex, age, haz0 + d_h * p + rng.gauss(0, 0.07),
                                      whz0 + d_w * p + rng.gauss(0, 0.1))
        if i == unmeasured_at:
            weight = length = None
        ctx.db.add(growth_response(ctx, learner.id, child, on, weight, length,
                                   illness_prone and age > 14 and rng.random() < 0.3))
    # Breastfeeding goes with the earlier visits, complementary feeding the later.
    for k, on in enumerate(visits[:n_bf]):
        age = (on - child.dob).days if child.dob else 60
        red = min(0.55, max(0.03, bf_quality + (0.15 if age <= 21 else 0) - 0.02 * k))
        ctx.db.add(flow_response(ctx, "breastfeeding", learner.id, on, red, child_id=child.id))
    cf_days = [d for d in visits if child.dob and (d - child.dob).days >= R.CF_FIRST_AGE_DAYS]
    diet = rng.choice(["cf_diet_veg", "cf_diet_veg", "cf_diet_nonveg", "cf_diet_egg"])
    for on in cf_days[-n_cf:] if n_cf > 0 else []:
        ctx.db.add(flow_response(ctx, "complementary_feeding", learner.id, on, cf_quality,
                                 child_id=child.id, prefer={"cf_diet_type": [diet]}))
    for on in visits[:: max(1, len(visits) // max(n_protein, 1))][:n_protein]:
        ctx.db.add(protein_response(ctx, learner.id, mother, on, False,
                                    rng.choice(["pca_diet_veg", "pca_diet_egg", "pca_diet_nonveg"])))
    return visits


# ── One learner ────────────────────────────────────────────────────────────


def _windows(ctx: Ctx) -> List[Tuple[int, date, date, Dict[str, int]]]:
    """One adoption window per target step: (tranche, from, to, adoptions it
    adds per type). Learners take on the new ask in the weeks after each review."""
    out = []
    prev = {k: 0 for k in R.TARGET_KEYS}
    steps = sorted(ctx.steps, key=lambda s: s["from"])
    for i, step in enumerate(steps):
        start = date.fromisoformat(step["from"]) + timedelta(days=1 if i == 0 else 0)
        nxt = date.fromisoformat(steps[i + 1]["from"]) - timedelta(days=1) if i + 1 < len(steps) else None
        end = start + timedelta(days=34 if i == 0 else 20)
        if nxt is not None:
            end = min(end, nxt)
        end = min(end, ctx.today - timedelta(days=6))
        if end < start:
            break
        adds = {k: max(0, int(step[k]) - prev[k]) for k in R.TARGET_KEYS}
        tranche = 2 if start >= ctx.tranche2 else 1
        out.append((tranche, start, end, adds))
        prev = {k: int(step[k]) for k in R.TARGET_KEYS}
    return out


def plan_adoptions(ctx: Ctx, profile: str, nurse: bool) -> List[Plan]:
    rng = ctx.rng
    plans: List[Plan] = []
    windows = _windows(ctx)
    for tranche, lo, hi, adds in windows:
        if nurse:
            types = [R.PNC_LT5] * adds["nurse"]
        else:
            types = [R.ANC] * adds["anc"] + [R.PNC_LT5] * adds["pnc_lt5"] + [R.PNC_GE5] * adds["pnc_ge5"]
        for t in types:
            plans.append(Plan(t, tranche, lo + timedelta(days=rng.randint(0, (hi - lo).days))))
    spec = PROFILES.get(profile, {})
    if "extra" in spec and windows:
        for _ in range(rng.randint(*spec["extra"])):
            tranche, lo, hi, _adds = rng.choice(windows)
            plans.append(Plan(rng.choice([R.PNC_LT5, R.PNC_LT5, R.PNC_GE5, R.ANC]), tranche,
                              lo + timedelta(days=rng.randint(0, (hi - lo).days))))
    if "drop" in spec:
        rng.shuffle(plans)
        plans = plans[: max(0, len(plans) - rng.randint(*spec["drop"]))]
    if nurse and profile == "nurse_low":
        plans = plans[: max(2, round(len(plans) * rng.uniform(0.4, 0.7)))]
    if profile == "zero":
        plans = []
    return sorted(plans, key=lambda p: p.on)


def seed_learner(ctx: Ctx, learner: models.User, profile: str, block_factor: float,
                 edges: List[str]) -> None:
    rng = ctx.rng
    nurse = profile.startswith("nurse")
    spec = PROFILES.get(profile, {"f": (0.8, 1.0), "quiet": (0, 0), "trend": 0.3})
    f = rng.uniform(*spec["f"]) * (block_factor if spec["f"][1] > 0 else 1)
    if profile == "nurse_good":
        f = rng.uniform(0.85, 1.0)
    elif profile == "nurse_low":
        f = rng.uniform(0.35, 0.6)
    quiet = rng.randint(*spec["quiet"])
    active_until = ctx.today - timedelta(days=quiet)
    trend = spec.get("trend", 0.3)

    for plan in plan_adoptions(ctx, profile, nurse):
        edge = None
        if edges and not nurse and f > 0.4 and rng.random() < 0.4:
            fits = [e for e in edges if e in _EDGES_FOR[plan.type]]
            if fits:
                edge = fits[0]
                edges.remove(edge)
        if edge == "pre_training":
            plan.on = ctx.training - timedelta(days=rng.randint(3, 8))
        end = min(active_until, ctx.today)
        expected: Dict[str, int] = {}

        def n(key: str, factor: float = 1.0) -> int:
            return max(0, round(expected.get(key, 0) * f * factor * rng.uniform(0.85, 1.15)))

        if edge == "unknown_type":
            new_mother(ctx, learner, plan.on, None)
            continue

        if plan.type == R.ANC or edge == "anc_not_followed":
            # Taken on in the last trimester (sometimes the sixth month).
            weeks = rng.choice([rng.randint(24, 27)] + [rng.randint(28, 37)] * 4)
            lmp = plan.on - timedelta(weeks=weeks)
            mother = new_mother(ctx, learner, plan.on, lmp)
            edd = lmp + timedelta(days=280)
            born_on = edd + timedelta(days=rng.randint(-14, 7))
            birth_end = min(born_on - timedelta(days=1), end)
            expected = R.case_expected(ctx.table, mother_adopted=plan.on, lmp=lmp,
                                       dob=born_on if born_on <= end else None, baby_adopted=None, end=end)
            checks = [plan.on + timedelta(days=15 * k + rng.randint(0, 3)) for k in range(expected["anc"])]
            checks = [d for d in checks if d <= birth_end]
            keep = sorted(rng.sample(checks, min(len(checks), n("anc")))) if checks else []
            for on in keep:
                ctx.db.add(antenatal_response(ctx, learner.id, mother, on, (mother.weight or 50) + rng.uniform(0, 6)))
            for on in keep[: n("protein")]:
                ctx.db.add(protein_response(ctx, learner.id, mother, on + timedelta(days=rng.randint(0, 1)), True,
                                            rng.choice(["pca_diet_veg", "pca_diet_egg", "pca_diet_nonveg"])))
            # Some births are never entered — the pregnancy then shows as past its due date.
            followed = edge != "anc_not_followed" and rng.random() < 0.85
            if born_on <= end - timedelta(days=2) and followed and f > 0:
                gender = rng.choice(["Male", "Female"])
                bw, bl, _, _ = _birth(rng, "boys" if gender == "Male" else "girls")
                adopted = born_on + timedelta(days=rng.randint(0, 2))
                child = new_child(ctx, mother, born_on, adopted, gender, bw, bl)
                ctx.db.flush()
                expected = R.case_expected(ctx.table, mother_adopted=plan.on, lmp=lmp, dob=born_on,
                                           baby_adopted=adopted, end=end)
                child_visits(ctx, learner, child, adopted, end, max(1, n("gm")), n("bf"), n("cf"),
                             0, mother, trend, None, 0.2, 0.15)
            continue

        # PNC adoptions — the child is already born.
        if nurse or edge == "birth_vs_visit1":
            age = rng.randint(0, 1)
        elif plan.type == R.PNC_LT5:
            age = {"age_149": 149}.get(edge) or rng.choice(
                [rng.randint(0, 7)] * 4 + [rng.randint(8, 60)] * 3 + [rng.randint(61, 148)] * 3)
        else:
            age = {"age_150": 150}.get(edge) or rng.randint(150, 320)
        dob = plan.on - timedelta(days=age)
        gender = None if edge == "z_missing" else rng.choice(["Male", "Female"])
        sex = "boys" if gender == "Male" else "girls"
        bw, bl, _, _ = _birth(rng, sex)
        if edge == "birth_weight_extreme":
            gender, bw = "Female", 0.85
        mother_adopted = plan.on
        child_adopted: Optional[date] = plan.on
        if edge == "no_adoption_details":
            child_adopted = None
        if edge == "baby_before_mother":
            child_adopted = plan.on - timedelta(days=rng.randint(4, 6))
        mother = new_mother(ctx, learner, mother_adopted, None)
        child = new_child(ctx, mother, dob, child_adopted, gender, bw, bl)
        expected = R.case_expected(ctx.table, mother_adopted=mother_adopted, lmp=None, dob=dob,
                                   baby_adopted=child_adopted or plan.on, end=end, is_nurse=nurse)
        if nurse:
            expected.update(R.NURSE_FLAT)     # the hospital stay's visits happen at once
        twin = None
        if edge == "twins":
            tw_bw, tw_bl, _, _ = _birth(rng, sex)
            twin = new_child(ctx, mother, dob, child_adopted, rng.choice(["Male", "Female"]),
                             round(tw_bw * 0.88, 3), tw_bl, twins=True)
            child.babies_born = "Twins"
        ctx.db.flush()

        if nurse:
            # Facility-based: two visits a day through the hospital stay.
            n_gm = n("gm")
            stay = [plan.on + timedelta(days=k // 2) for k in range(n_gm)]
            child_visits(ctx, learner, child, plan.on, plan.on, n_gm, n("bf"), 0, 0,
                         mother, 0.0, None, 0.25, 0.15, dates=stay)
            continue

        no_cf = spec.get("no_cf", False)
        # The data slip "mother adopted after the child's last visit" needs
        # the visits to stop a while before today.
        visit_end = end - timedelta(days=15) if edge == "mother_after_lv" else end
        last_seen = None
        for kid in [child] + ([twin] if twin else []):
            seen = child_visits(ctx, learner, kid, plan.on, visit_end, max(1 if f > 0 else 0, n("gm")), n("bf"),
                                0 if no_cf else n("cf"), 0,
                                mother, trend, edge if kid is child else None,
                                0.12 if trend > 0.3 else 0.28, 0.12 if trend > 0.3 else 0.3)
            if kid is child and seen:
                last_seen = seen[-1]
        if edge == "mother_after_lv" and last_seen:
            mother.adoption_date = min(ctx.today, last_seen + timedelta(days=rng.randint(5, 10)))


# ── Projects ───────────────────────────────────────────────────────────────


def _definitions(db) -> Dict[str, Tuple[dict, int]]:
    out = {}
    for key in R.ACTIVITY_FORMS.values():
        definition = db.query(models.FormDefinition).filter_by(form_key=key).one()
        version = db.get(models.FormVersion, definition.default_version_id) if definition.default_version_id else None
        out[key] = ((version.schema_json if version else definition.schema_json),
                    version.version_number if version else definition.version)
    return out


def seed_project(db, slug: str, today: date) -> Dict[str, int]:
    project = db.query(models.ProgramDistrict).filter_by(slug=slug).one_or_none()
    if project is None:
        print(f"  {slug}: project not found, skipped")
        return {}
    conf = PROJECTS[slug]
    training = today - timedelta(days=conf["training_days_ago"])
    tranche2 = training + timedelta(days=conf["tranche2_after"])
    rng = Random(f"masd-{slug}-2026")
    steps = R.default_targets(slug, training, tranche2)
    ctx = Ctx(db=db, rng=rng, today=today, training=training, tranche2=tranche2,
              defs=_definitions(db), names=NAMES[conf["state"]], project_slug=slug,
              steps=steps, table=expected_forms_for(db)[0])

    learners = (
        db.query(models.User)
        .filter(models.User.program_district_id == project.id, models.User.email.like(f"%{MOCK_DOMAIN}"))
        .order_by(models.User.id)
        .all()
    )
    selections = {s.user_id: s for s in db.query(models.FaceToFaceSelection)
                  .filter(models.FaceToFaceSelection.user_id.in_([u.id for u in learners]))}
    f2f = [u for u in learners if u.id in selections]
    others = [u for u in learners if u.id not in selections]

    blocks = sorted({u.block_id for u in f2f if u.block_id})
    block_factor = {b: 1.0 for b in blocks}
    if len(blocks) >= 3:
        weak, strong = rng.sample(blocks, 2)
        block_factor[weak], block_factor[strong] = 0.72, 1.12

    edges: List[str] = []
    for e in EDGES:
        edges += [e] * rng.randint(2, 4)
    rng.shuffle(edges)

    profile_table = {k: v["weight"] for k, v in PROFILES.items()}
    stars: List[int] = []
    for u in f2f:
        nurse = R.role_group(u.role) == R.NURSING_STAFF
        profile = _pick_weighted(rng, NURSE_PROFILES) if nurse else _pick_weighted(rng, profile_table)
        if profile == "star":
            stars.append(u.id)
        # Edge cases go to ordinary, active learners so they read as the data
        # slips they are, not as a pattern of one bad learner.
        mine = edges if profile in ("steady", "over", "cf_skip") else []
        seed_learner(ctx, u, profile, block_factor.get(u.block_id, 1.0), mine)
        db.flush()

    # A few learners outside F2F training registered cases anyway.
    for u in rng.sample(others, min(len(others), rng.randint(6, 10))):
        seed_learner(ctx, u, rng.choice(["steady", "under"]), 1.0, [])
    db.flush()

    # Master Trainers / Facilitators: the stars, plus a few steady hands.
    extra = [u.id for u in f2f if u.id not in stars and R.role_group(u.role) != R.NURSING_STAFF]
    chosen = stars + rng.sample(extra, min(len(extra), max(2, len(stars) // 5)))
    for i, uid in enumerate(chosen):
        selections[uid].trainer_role = "master_trainer" if i % 3 == 0 else "facilitator"

    # Five F2F batches ending over the fortnight up to the training date; a
    # batch trains a block or two, so learners are split in block order.
    batches = []
    for i, back in enumerate(BATCH_ENDS_BEFORE_TRAINING):
        batch = models.MasdTrainingBatch(program_district_id=project.id, name=f"Batch {i + 1}",
                                         end_date=training - timedelta(days=back), updated_by=SEEDED_BY)
        db.add(batch)
        batches.append(batch)
    db.flush()
    ordered = sorted(f2f, key=lambda u: (u.block_id or 0, u.id))
    size = math.ceil(len(ordered) / len(batches)) if ordered else 1
    for i, u in enumerate(ordered):
        selections[u.id].batch_id = batches[min(i // size, len(batches) - 1)].id

    settings = db.get(models.MasdProjectSettings, project.id)
    if settings is None:
        settings = models.MasdProjectSettings(program_district_id=project.id)
        db.add(settings)
    settings.training_date, settings.tranche2_start, settings.updated_by = training, tranche2, SEEDED_BY
    settings.targets_json = steps
    db.commit()
    return {**ctx.counters, "f2f": len(f2f), "mtfl": len(chosen), "batches": len(batches),
            "edges_left": len(edges)}


def remove(db) -> None:
    mothers = db.query(models.Mother.id).filter(models.Mother.mother_uid.like(f"{MARK}%"))
    mother_ids = [m for (m,) in mothers]
    child_ids = [c for (c,) in db.query(models.Child.id).filter(models.Child.mother_id.in_(mother_ids))] if mother_ids else []
    n_resp = 0
    for start in range(0, len(child_ids), 1000):
        n_resp += db.query(models.FormResponse).filter(
            models.FormResponse.child_id.in_(child_ids[start:start + 1000])).delete(synchronize_session=False)
    for start in range(0, len(mother_ids), 1000):
        chunk = mother_ids[start:start + 1000]
        n_resp += db.query(models.FormResponse).filter(models.FormResponse.mother_id.in_(chunk)).delete(synchronize_session=False)
        db.query(models.Child).filter(models.Child.mother_id.in_(chunk)).delete(synchronize_session=False)
        db.query(models.Mother).filter(models.Mother.id.in_(chunk)).delete(synchronize_session=False)
    mock_ids = [u for (u,) in db.query(models.User.id).filter(models.User.email.like(f"%{MOCK_DOMAIN}"))]
    if mock_ids:
        db.query(models.FaceToFaceSelection).filter(models.FaceToFaceSelection.user_id.in_(mock_ids)) \
            .update({models.FaceToFaceSelection.trainer_role: None, models.FaceToFaceSelection.batch_id: None},
                    synchronize_session=False)
    seeded_batches = [b for (b,) in db.query(models.MasdTrainingBatch.id)
                      .filter(models.MasdTrainingBatch.updated_by == SEEDED_BY)]
    if seeded_batches:
        db.query(models.FaceToFaceSelection).filter(models.FaceToFaceSelection.batch_id.in_(seeded_batches)) \
            .update({models.FaceToFaceSelection.batch_id: None}, synchronize_session=False)
        db.query(models.MasdTrainingBatch).filter(models.MasdTrainingBatch.id.in_(seeded_batches)) \
            .delete(synchronize_session=False)
    db.query(models.MasdProjectSettings).filter(models.MasdProjectSettings.updated_by == SEEDED_BY) \
        .delete(synchronize_session=False)
    db.commit()
    print(f"Removed {len(mother_ids)} mothers, {len(child_ids)} children, {n_resp} form responses "
          f"(MASD demo); cleared MT/FL marks, batches and seeded calendars/targets.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed (or remove) the MASD demo adoptions.")
    ap.add_argument("--remove", action="store_true", help="remove the demo data and stop")
    ap.add_argument("--reseed", action="store_true", help="remove, then seed again")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        existing = db.query(models.Mother).filter(models.Mother.mother_uid.like(f"{MARK}%")).count()
        if args.remove or args.reseed:
            remove(db)
            if args.remove:
                return
        elif existing:
            print(f"MASD demo already present ({existing} mothers). Use --reseed to rebuild.")
            return
        today = date.today()
        for slug in PROJECTS:
            t0 = time.time()
            stats = seed_project(db, slug, today)
            print(f"  {slug:7} {stats}  ({time.time() - t0:.0f}s)")
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
