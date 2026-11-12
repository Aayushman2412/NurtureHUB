"""The learner's "My babies' growth" (visit protocol, November 2026).

Four counts over her adopted babies' latest checks — underweight (WAZ below
−2), faltering (the weight-for-age trend of app/growth_priority.py), stunted
(LAZ below −2) and wasted (WLZ below −2) — each "x of y" over the babies
weighed so far, plus the babies growing well and those not weighed yet. One
baby can be in several groups. Each group opens on its babies, most urgent
first by the priority score, with what the learner needs to act: the name she
knows the baby by, why it is listed, the last check and the visit to start.

Her own cases only (mothers she registered); real measurements only.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app import growth_priority as GP
from app import models

# The grade each group is read from, for the reason in words.
_GRADE_OF = {"underweight": GP.UNDERWEIGHT, "stunted": GP.STUNTING, "wasted": GP.WASTING}


def _baby(case: Dict[str, Any], as_of: date) -> Dict[str, Any]:
    from app.fieldplan import _baby_forms

    child, mother = case["child"], case["mother"]
    dob = date.fromisoformat(child["dob"]) if child.get("dob") else None
    return {"child_id": child["id"], "mother_id": mother["id"], "child_name": child.get("name"),
            "mother_name": mother.get("name"), "forms": _baby_forms((as_of - dob).days if dob else None)}


def my_babies(db: Session, user: models.User, as_of: Optional[date] = None) -> Dict[str, Any]:
    from app.fieldplan import baby_status
    from app.routers.growth import _build_cases

    as_of = as_of or date.today()
    weighed: List[Dict[str, Any]] = []
    unmeasured: List[Dict[str, Any]] = []
    for case in _build_cases(db, user_id=user.id):
        base = _baby(case, as_of)
        assessed = GP.assess(case)
        if assessed is None:
            unmeasured.append(base)
            continue
        trend = assessed["trend"]
        weighed.append({
            **base,
            "last_check": assessed["last_check"],
            "groups": assessed["groups"],
            "grades": {group: assessed["grades"][ind] for group, ind in _GRADE_OF.items()},
            "trend": {"group": trend["group"], "rule": trend["rule"], "since": trend.get("since")},
            "priority": {"tier": assessed["priority"]["tier"], "score": assessed["priority"]["score"]},
            # Today's "see these babies soon" reads baby_status: a baby on it
            # is not growing well here.
            "growing_well": GP.growing_well(assessed, see_soon=bool(baby_status(case)["see_within_days"])),
        })
    weighed.sort(key=lambda b: (GP.sort_key(b["priority"]), b["last_check"], b["child_name"] or ""))
    unmeasured.sort(key=lambda b: (b["child_name"] or "", b["mother_name"] or ""))
    return {
        "as_of": as_of.isoformat(),
        "measured": len(weighed),
        "not_measured": len(unmeasured),
        "growing_well": sum(1 for b in weighed if b["growing_well"]),
        "counts": {g: sum(1 for b in weighed if g in b["groups"]) for g in GP.GROUPS},
        "babies": weighed,
        "unmeasured": unmeasured,
    }
