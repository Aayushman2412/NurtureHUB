"""The November 2026 visit protocol, read from the database.

app/visit_protocol.py holds the rules and touches no database; this module
turns a learner's mothers, babies and submitted forms into its `Case`s and
hands the answers to the worker app: Today (app/fieldplan.py), the baby page
and the form runner (routers/visits.py), and the care prompts
(app/care_alerts.py). Only projects on "lap_2026_11" come here — the others
keep the LAP tables of app/masd/rules.py, untouched.

What each rule reads, and where it already lives:
  * a growth check's weight-for-age z — the weight the growth monitor extracts
    (routers/growth.growth_metrics) and the WHO tables (who_growth);
  * "breastfed in the past 24 hours" — the check-growth form's breastfed_24h;
  * a breastfeeding question's green — the option verdict's scoring polarity
    in the form definition, as routers/forms scores it;
  * a protein form's totals — summary_json["protein"] computed at submit
    (routers/forms._protein_totals): the 24-hour total and high-quality grams.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app import visit_protocol as VP

FORM_CODES = {
    "growth_monitoring": VP.CG, "breastfeeding": VP.BF, "complementary_feeding": VP.CF,
    "antenatal": VP.AF, "mother_protein_intake": VP.PF,
}
BREASTFED_FIELD = "breastfed_24h"
POSTNATAL_TYPES = ("pnc_lt5", "pnc_ge5")
_DEFAULT_POSITIVE = {"green"}


def settings_for(user: models.User) -> Tuple[str, int]:
    """(protocol, PNC split days) of the learner's project."""
    from app.projects import visit_settings
    return visit_settings(user.program_district)


def uses_new_protocol(user: models.User) -> bool:
    return settings_for(user)[0] == VP.LAP_2026_11


# ── Reading the forms ──────────────────────────────────────────────────────

def _positive_verdicts(db: Session) -> Set[str]:
    """The breastfeeding form's verdicts that score as "as per LAP" (green)."""
    definition = db.query(models.FormDefinition).filter(models.FormDefinition.form_key == "breastfeeding").first()
    verdicts = ((definition.schema_json or {}).get("verdicts") if definition else None) or []
    positive = {v.get("id") for v in verdicts if isinstance(v, dict) and v.get("scoring") == "positive"}
    return positive or set(_DEFAULT_POSITIVE)


def _green_questions(answers: Any, positive: Set[str]) -> frozenset:
    out = set()
    for snap in answers or []:
        if not isinstance(snap, dict) or not snap.get("nodeId"):
            continue
        picked = [s.get("verdict") for s in snap.get("selected") or [] if isinstance(s, dict)]
        if picked and all(v in positive for v in picked):
            out.add(snap["nodeId"])
    return frozenset(out)


def _breastfed(answers: Any) -> Optional[bool]:
    for snap in answers or []:
        if isinstance(snap, dict) and snap.get("nodeId") == BREASTFED_FIELD:
            picked = [s.get("optionId") for s in snap.get("selected") or [] if isinstance(s, dict)]
            if "yes" in picked:
                return True
            if "no" in picked:
                return False
    return None


def _waz(child: models.Child, on: date, weight: Optional[float]) -> Optional[float]:
    from app.routers.growth import _sex_key
    from app.who_growth import zscore_for_value

    sex = _sex_key(child.gender)
    if weight is None or sex is None or child.dob is None or on < child.dob:
        return None
    return zscore_for_value("wfa", sex, (on - child.dob).days, weight)


def _forms(db: Session, mothers: Sequence[models.Mother], children: Dict[int, List[models.Child]]
           ) -> Tuple[Dict[int, List[VP.Form]], Dict[int, List[VP.Form]]]:
    """(mother id → her antenatal and protein forms, child id → the baby's forms)."""
    from app.routers.growth import growth_metrics

    mother_ids = [m.id for m in mothers]
    kids = {c.id: c for cs in children.values() for c in cs}
    owned = [models.FormResponse.mother_id.in_(mother_ids)]
    if kids:
        owned.append(models.FormResponse.child_id.in_(list(kids)))
    rows = (db.query(models.FormResponse.id, models.FormResponse.form_key, models.FormResponse.mother_id,
                     models.FormResponse.child_id, models.FormResponse.assessment_date,
                     models.FormResponse.summary_json)
            .filter(models.FormResponse.status == "submitted",
                    models.FormResponse.form_key.in_(list(FORM_CODES)), or_(*owned))
            .order_by(models.FormResponse.assessment_date, models.FormResponse.id).all()) if mother_ids else []
    need_answers = [r.id for r in rows if r.form_key in ("breastfeeding", "growth_monitoring")]
    answers: Dict[int, Any] = {}
    for start in range(0, len(need_answers), 2000):
        for rid, blob in (db.query(models.FormResponse.id, models.FormResponse.answers_json)
                          .filter(models.FormResponse.id.in_(need_answers[start:start + 2000]))):
            answers[rid] = blob
    weights = growth_metrics(db, [r.id for r in rows if r.form_key == "growth_monitoring"])
    positive = _positive_verdicts(db) if any(r.form_key == "breastfeeding" for r in rows) else _DEFAULT_POSITIVE

    by_mother: Dict[int, List[VP.Form]] = defaultdict(list)
    by_child: Dict[int, List[VP.Form]] = defaultdict(list)
    for r in rows:
        code, on, summary = FORM_CODES[r.form_key], r.assessment_date, r.summary_json or {}
        if code in VP.MOTHER_FORMS:
            if r.mother_id is None:
                continue
            protein = summary.get("protein") or {}
            by_mother[r.mother_id].append(VP.Form(code, on, total_g=protein.get("total24"), hq_g=protein.get("hq24")))
            continue
        child = kids.get(r.child_id)
        if child is None:
            continue
        if code == VP.CG:
            weight = (weights.get(r.id) or {}).get("weight")
            form = VP.Form(code, on, waz=_waz(child, on, weight), breastfed=_breastfed(answers.get(r.id)))
        elif code == VP.BF:
            all_green = int(summary.get("red") or 0) == 0 and int(summary.get("green") or 0) > 0
            form = VP.Form(code, on, green=_green_questions(answers.get(r.id), positive), all_green=all_green)
        else:
            form = VP.Form(code, on)
        by_child[child.id].append(form)
    return by_mother, by_child


# ── Cases ──────────────────────────────────────────────────────────────────

def _adopted(m: models.Mother, as_of: date) -> date:
    if m.adoption_date:
        return m.adoption_date
    return m.created_at.date() if m.created_at else as_of


def cases_for(db: Session, mothers: Sequence[models.Mother], children: Dict[int, List[models.Child]],
              split_days: int, as_of: date) -> Dict[int, List[Tuple[Optional[models.Child], VP.Case]]]:
    """mother id → [(baby or None while pregnant, its Case)]. With twins the
    protein form rides on the first baby's visits only."""
    mother_forms, child_forms = _forms(db, mothers, children)
    out: Dict[int, List[Tuple[Optional[models.Child], VP.Case]]] = {}
    for m in mothers:
        base = VP.Case(adopted=_adopted(m, as_of), lmp=m.lmp, edd=m.edd_records or m.edd_lmp,
                       forms=tuple(mother_forms.get(m.id, [])), dropped_out_on=m.dropped_out_on,
                       pnc_split_days=split_days)
        kids = sorted(children.get(m.id, []), key=lambda c: (c.dob or date.max, c.id))
        if not kids:
            # Registered as postnatal but the baby is not registered yet: no
            # visits to plan until it is (Today's "finish" row asks for it) —
            # she is not a pregnancy.
            out[m.id] = [] if m.declared_adoption_type in POSTNATAL_TYPES else [(None, base)]
            continue
        out[m.id] = [(k, VP.Case(
            adopted=base.adopted, lmp=base.lmp, edd=base.edd, dob=k.dob, child_adopted=k.adoption_date,
            forms=base.forms + tuple(child_forms.get(k.id, [])), counselled_on=k.bf_counselled_on,
            dropped_out_on=m.dropped_out_on, pnc_split_days=split_days, mother_forms_here=(i == 0),
        )) for i, k in enumerate(kids)]
    return out


def learner_cases(db: Session, user: models.User, as_of: date,
                  mothers: Optional[Sequence[models.Mother]] = None,
                  children: Optional[Dict[int, List[models.Child]]] = None,
                  ) -> Dict[int, List[Tuple[Optional[models.Child], VP.Case]]]:
    """Every adoption of a learner (or the given ones)."""
    if mothers is None:
        mothers = db.query(models.Mother).filter(models.Mother.registered_by_user_id == user.id).all()
    if children is None:
        children = defaultdict(list)
        if mothers:
            for c in db.query(models.Child).filter(models.Child.mother_id.in_([m.id for m in mothers])):
                children[c.mother_id].append(c)
    return cases_for(db, mothers, children, settings_for(user)[1], as_of)


# ── What Today reads ───────────────────────────────────────────────────────

def _items(plan: Dict[str, Any], child: Optional[models.Child], as_of: date) -> List[Dict[str, Any]]:
    """One adoption's next visit and the visits after it, as Today's items
    (one per form): {key, due_on, late_days, missing, child_id, ask_delivery}."""
    nxt = plan.get("next")
    if not nxt:
        return []
    child_id = child.id if child is not None else None
    forms = plan["today"]["pending"] if nxt["unfinished"] else nxt["forms"]
    due_now = date.fromisoformat(nxt["due_on"]) <= as_of
    out = [{"key": f, "due_on": nxt["due_on"], "late_days": nxt["late_days"], "missing": 1 if due_now else 0,
            "child_id": child_id,
            "ask_delivery": nxt["ask_delivery"]} for f in forms]
    for v in plan.get("later") or []:
        out.extend({"key": f, "due_on": v["due_on"], "late_days": 0, "missing": 0, "child_id": child_id,
                    "ask_delivery": v["ask_delivery"]} for f in v["forms"])
    return out


def field_plan(db: Session, user: models.User, mothers: Sequence[models.Mother],
               children: Dict[int, List[models.Child]], as_of: date, horizon_days: int
               ) -> Tuple[Dict[int, List[Dict[str, Any]]], Dict[int, Dict[str, Any]]]:
    """(mother id → Today items, child id → that baby's plan)."""
    items: Dict[int, List[Dict[str, Any]]] = {}
    by_child: Dict[int, Dict[str, Any]] = {}
    for mother_id, pairs in learner_cases(db, user, as_of, mothers, children).items():
        rows: List[Dict[str, Any]] = []
        for child, case in pairs:
            plan = VP.plan(case, as_of, horizon_days)
            if child is not None:
                by_child[child.id] = plan
            rows.extend(_items(plan, child, as_of))
        items[mother_id] = sorted(rows, key=lambda i: i["due_on"])
    return items, by_child


def today_forms(plan: Optional[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
    """(forms of a visit to this baby today, those still to fill)."""
    if not plan:
        return [], []
    today = plan["today"]
    return today["forms"], today["pending"]


# ── One baby, for the baby page and the form runner ───────────────────────

def child_plan(db: Session, user: models.User, child: models.Child, as_of: date,
               horizon_days: int = 30) -> Dict[str, Any]:
    protocol, split = settings_for(user)
    if protocol != VP.LAP_2026_11:
        return {"protocol": protocol, "pnc_split_days": split}
    mother = child.mother
    siblings = db.query(models.Child).filter(models.Child.mother_id == mother.id).all()
    pairs = cases_for(db, [mother], {mother.id: siblings}, split, as_of)[mother.id]
    case = next(c for k, c in pairs if k is not None and k.id == child.id)
    plan = VP.plan(case, as_of, horizon_days)
    dropped_by = db.get(models.User, mother.dropped_out_by_user_id) if mother.dropped_out_by_user_id else None
    return {
        "protocol": protocol, "pnc_split_days": split, "child_id": child.id, "mother_id": mother.id,
        **plan,
        "dropout": ({"on": mother.dropped_out_on.isoformat(), "reason": mother.dropout_reason,
                     "by": (dropped_by.full_name or None) if dropped_by else None}
                    if mother.dropped_out_on else None),
    }


def plan_for_alerts(db: Session, user: models.User, child: models.Child, as_of: date) -> Optional[Dict[str, Any]]:
    """The baby's plan on `as_of` for the care prompts (None on lap_2025)."""
    plan = child_plan(db, user, child, as_of, horizon_days=0)
    return plan if plan.get("protocol") == VP.LAP_2026_11 else None


def visits_late_and_due(db: Session, user: models.User, as_of: date) -> Tuple[int, int]:
    """(adoptions with a visit late, adoptions with a visit due today or late)
    — the batch monitor's counts for one learner."""
    late = due = 0
    for pairs in learner_cases(db, user, as_of).values():
        nexts = [VP.plan(case, as_of, 0)["next"] for _child, case in pairs]
        nexts = [n for n in nexts if n and date.fromisoformat(n["due_on"]) <= as_of]
        late += any(n["late_days"] > 0 for n in nexts)
        due += bool(nexts)
    return late, due
