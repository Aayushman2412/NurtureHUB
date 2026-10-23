"""What a health worker sees first: what to do today (launch review of 19 Oct 2026).

The stakeholders' main point: "as soon as they open the app, the app should
tell them — do this, do this", in one line each, with as few numbers as
possible. Everything here is the worker's OWN cases (mothers she registered).

* **Urgent** — a baby whose weight went down since the last visit, who has
  stopped gaining (fell on the weight-for-age chart), or whose latest
  measurement is low: "see within 2 days" (Dr Rupal: catch faltering "as it is
  happening", relative to the previous visit, not the adoption visit).
* **Today** — forms due today or already late, per mother / baby, from the
  same expected-forms rules the MASD dashboard uses (engine.field_plan).
* **Finish** — a mother registered without her protein-intake form, or a
  delivered mother whose baby is not registered yet.
* **Adopt** — "adopt 1 more pregnant mother", never a percentage.
* **Week** — what falls due in the next 7 days, by day.
* **Cases** — the line list: every mother and baby with a green / yellow /
  red status in words and the next visit.

Traffic light (Dr Rupal): green at or above −1 SD, yellow from −1 to −1.5,
red below −1.5 — stricter than the WHO grades on purpose, so the worker acts
before a baby is moderately low. Percentiles, not z-scores, are what the
worker is shown.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app import models

RED_BELOW_Z = -1.5
YELLOW_BELOW_Z = -1.0
SEE_WITHIN_DAYS = 2
WEEK_DAYS = 7

GREEN, YELLOW, RED, NONE = "green", "yellow", "red", "none"
_RANK = {NONE: 0, GREEN: 1, YELLOW: 2, RED: 3}

# Activity key -> (form key, whose form it is)
FORMS = {
    "gm": ("growth_monitoring", "child"),
    "bf": ("breastfeeding", "child"),
    "cf": ("complementary_feeding", "child"),
    "anc": ("antenatal", "mother"),
    "protein": ("mother_protein_intake", "mother"),
}


def percentile(z: Optional[float]) -> Optional[int]:
    """The WHO percentile for a z-score, 1–99."""
    if z is None:
        return None
    return max(1, min(99, round(50 * (1 + math.erf(z / math.sqrt(2))))))


def tone(z: Optional[float]) -> Optional[str]:
    if z is None:
        return None
    return RED if z < RED_BELOW_Z else YELLOW if z < YELLOW_BELOW_Z else GREEN


def _wfl_grade(z: Optional[float]) -> Optional[str]:
    if z is None:
        return None
    return "severe" if z < -3 else "moderate" if z < -2 else "mild" if z < -1 else "normal"


def baby_status(case: Dict[str, Any]) -> Dict[str, Any]:
    """One baby's latest growth check, as the worker reads it."""
    from app.routers.growth import _sex_key, _visit_z

    sex = _sex_key(case["child"].get("gender"))
    measured = sorted((v for v in case.get("visits") or [] if v.get("weight") is not None and v.get("age_days") is not None),
                      key=lambda v: v["date"])
    if not measured:
        return {"status": NONE, "reasons": ["no_growth_check"], "see_within_days": None,
                "latest": None, "previous": None}
    last = measured[-1]
    prev = measured[-2] if len(measured) > 1 else None
    z = {m: _visit_z(m, sex, last) for m in ("wfa", "lfa", "wfl")}
    prev_wfa = _visit_z("wfa", sex, prev) if prev else None
    reasons: List[str] = []
    status = GREEN
    weight_fell = prev is not None and last["weight"] < prev["weight"]
    fell_on_chart = (not weight_fell and prev_wfa is not None and z["wfa"] is not None
                     and percentile(z["wfa"]) < percentile(prev_wfa))
    if weight_fell:
        reasons.append("weight_fell")
        status = RED
    elif fell_on_chart:
        reasons.append("not_gaining")
        status = YELLOW
    for m in ("wfa", "lfa", "wfl"):
        t = tone(z[m])
        if t in (RED, YELLOW):
            reasons.append(f"low_{m}")
            if _RANK[t] > _RANK[status]:
                status = t
    # "See within 2 days" is for weight: it fell, stopped rising on the chart,
    # or is low for age or length. A low length-for-age alone is chronic — it
    # shows in the status, not as an emergency.
    weight_red = any(tone(z[m]) == RED for m in ("wfa", "wfl"))
    return {
        "status": status,
        "reasons": reasons,
        "see_within_days": SEE_WITHIN_DAYS if (weight_fell or fell_on_chart or weight_red) else None,
        "latest": {
            "date": last["date"], "age_days": last["age_days"], "weight": last["weight"], "length": last.get("length"),
            "wfa": {"pct": percentile(z["wfa"]), "tone": tone(z["wfa"])},
            "lfa": {"pct": percentile(z["lfa"]), "tone": tone(z["lfa"])},
            "wfl": {"grade": _wfl_grade(z["wfl"]), "tone": tone(z["wfl"])},
        },
        "previous": {"date": prev["date"], "weight": prev["weight"], "wfa_pct": percentile(prev_wfa)} if prev else None,
    }


def _baby_forms(age_days: Optional[int]) -> List[str]:
    """What a baby's visit is: a growth check, with breastfeeding before six
    and a half months and complementary feeding after six months."""
    from app.masd import rules as R

    forms = ["gm"]
    if age_days is None or age_days < R.BF_UNTIL_AGE_DAYS:
        forms.append("bf")
    if age_days is not None and age_days >= R.CF_FIRST_AGE_DAYS:
        forms.append("cf")
    return forms


def _age_days(dob: Optional[date], on: date) -> Optional[int]:
    return (on - dob).days if dob else None


def today_view(db: Session, user: models.User, as_of: Optional[date] = None) -> Dict[str, Any]:
    from app.masd import data as D, engine as E
    from app.routers.dashboard import _masd_project
    from app.routers.growth import _build_cases

    as_of = as_of or date.today()
    mothers = (db.query(models.Mother)
               .filter(models.Mother.registered_by_user_id == user.id)
               .order_by(models.Mother.created_at.desc()).all())
    children: Dict[int, List[models.Child]] = defaultdict(list)
    if mothers:
        for c in (db.query(models.Child).filter(models.Child.mother_id.in_([m.id for m in mothers]))
                  .order_by(models.Child.dob)):
            children[c.mother_id].append(c)

    project = _masd_project(db, user)
    view = plan = None
    if project is not None:
        data = D.load(db, project, only_learners=[user.id], with_growth=False)
        view = E.learner_view(data, as_of, user.id, due_days=WEEK_DAYS)
        plan = E.field_plan(data, as_of, user.id, WEEK_DAYS)
    plan = plan or {}
    types = {c["mother_id"]: c["type"] for c in (view or {}).get("cases", [])}
    warnings = {c["mother_id"]: c["warnings"] for c in (view or {}).get("cases", [])}

    babies = {c["child"]["id"]: baby_status(c) for c in _build_cases(db, user_id=user.id)}
    protein_done = {mid for (mid,) in db.query(models.FormResponse.mother_id).filter(
        models.FormResponse.mother_id.in_([m.id for m in mothers]),
        models.FormResponse.form_key == "mother_protein_intake",
        models.FormResponse.status == "submitted")} if mothers else set()

    def person(m: models.Mother, key: str) -> Optional[models.Child]:
        return children[m.id][0] if FORMS[key][1] == "child" and children[m.id] else None

    urgent: List[Dict[str, Any]] = []
    today: List[Dict[str, Any]] = []
    finish: List[Dict[str, Any]] = []
    week: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    cases: List[Dict[str, Any]] = []

    for m in mothers:
        kids = children[m.id]
        mtype = types.get(m.id) or m.declared_adoption_type or ("anc" if not kids else None)
        kid_rows = []
        for k in kids:
            st = babies.get(k.id) or {"status": NONE, "reasons": ["no_growth_check"], "latest": None}
            kid_rows.append({"id": k.id, "name": k.child_name, "uid": k.child_uid, "gender": k.gender,
                             "age_days": _age_days(k.dob, as_of), **st})
            if st.get("see_within_days"):
                urgent.append({"mother_id": m.id, "mother_name": m.mother_name, "child_id": k.id,
                               "child_name": k.child_name, "status": st["status"], "reasons": st["reasons"],
                               "see_within_days": st["see_within_days"],
                               "forms": _baby_forms(_age_days(k.dob, as_of)),
                               "last_check": (st.get("latest") or {}).get("date")})

        # Registration not finished: no protein form, or a birth with no baby yet.
        delivered = mtype in ("pnc_lt5", "pnc_ge5", "sn") or bool(kids)
        if m.id not in protein_done:
            finish.append({"mother_id": m.id, "mother_name": m.mother_name, "missing": "protein",
                           "then": ["baby"] if delivered and not kids else []})
        elif delivered and not kids:
            finish.append({"mother_id": m.id, "mother_name": m.mother_name, "missing": "baby", "then": []})

        # Forms due today or late, and the coming week — grouped by person.
        groups: Dict[tuple, Dict[str, Any]] = {}
        for item in plan.get(m.id, []):
            due = date.fromisoformat(item["due_on"])
            kid = person(m, item["key"])
            if FORMS[item["key"]][1] == "child" and kid is None:
                continue          # the baby is not registered yet: "finish" covers it
            gkey = ("today" if due <= as_of else item["due_on"], kid.id if kid else None)
            g = groups.setdefault(gkey, {
                "mother_id": m.id, "mother_name": m.mother_name,
                "child_id": kid.id if kid else None, "child_name": kid.child_name if kid else None,
                "forms": [], "late_days": 0, "due_on": item["due_on"]})
            g["forms"].append({"key": item["key"], "late_days": item["late_days"], "missing": item["missing"]})
            g["late_days"] = max(g["late_days"], item["late_days"])
            g["due_on"] = min(g["due_on"], item["due_on"])
        for (when, _kid), g in groups.items():
            (today.append(g) if when == "today" else week[when].append(g))

        # The line list row: worst status of the babies, then late visits.
        status, reason = GREEN, "all_done"
        for k in kid_rows:
            if _RANK[k["status"]] > _RANK[status]:
                status, reason = k["status"], (k["reasons"] or ["low"])[0]
        late = max((g["late_days"] for (w, _), g in groups.items() if w == "today"), default=None)
        if any(w["code"] == "edd_passed" for w in warnings.get(m.id, [])):
            status, reason = RED, "edd_passed"
        elif late is not None and _RANK[status] < _RANK[YELLOW]:
            status, reason = YELLOW, "late" if late > 0 else "due_today"
        if any(f["mother_id"] == m.id for f in finish) and _RANK[status] < _RANK[YELLOW]:
            status, reason = YELLOW, "finish_registration"
        upcoming = sorted((g for (w, _), g in groups.items()), key=lambda g: g["due_on"])
        cases.append({
            "mother_id": m.id, "mother_name": m.mother_name, "mother_uid": m.mother_uid,
            "type": mtype, "status": status, "reason": reason,
            "next": {"due_on": upcoming[0]["due_on"], "forms": [f["key"] for f in upcoming[0]["forms"]],
                     "child_id": upcoming[0]["child_id"]} if upcoming else None,
            "children": kid_rows,
        })

    urgent.sort(key=lambda u: (-_RANK[u["status"]], u["last_check"] or ""))
    today.sort(key=lambda g: (-g["late_days"], g["mother_name"] or ""))
    cases.sort(key=lambda c: (-_RANK[c["status"]], (c["next"] or {}).get("due_on") or "9999", c["mother_name"] or ""))

    targets: List[Dict[str, Any]] = []
    if view:
        for t in ("anc", "pnc_lt5", "pnc_ge5"):
            target = int((view.get("targets") or {}).get(t) or 0)
            adopted = int((view.get("adoptions") or {}).get(t) or 0)
            if target or adopted:
                targets.append({"type": t, "target": target, "adopted": adopted, "more": max(0, target - adopted)})

    since = as_of - timedelta(days=as_of.weekday())          # this week, from Monday
    done_week = db.query(models.FormResponse.id).filter(
        models.FormResponse.submitted_by_user_id == user.id,
        models.FormResponse.status == "submitted",
        models.FormResponse.assessment_date >= since,
        models.FormResponse.assessment_date <= as_of).count()

    return {
        "available": True,
        "as_of": as_of.isoformat(),
        "project": {"name": project.name, "slug": project.slug} if project is not None else None,
        "urgent": urgent,
        "today": today,
        "finish": finish,
        "targets": targets,
        "week": [{"date": d, "items": week[d]} for d in sorted(week)],
        "cases": cases,
        "done_this_week": done_week,
        "nil_days": (view or {}).get("nil_days"),
    }
