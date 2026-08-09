"""MP_<District>_MCJ_Case_Report_<date>.csv — one row per mother case.

Antenatal-stage mothers appear with every child/visit column as NULL; a mother
with a child carries adoption-visit and latest-visit anthropometry with WHO
z-scores recomputed via app/who_growth.py.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Optional

from app.who_growth import zscore_for_value

from .common import NULL, Dataset, ResponseView, ddmmyyyy, num, s

FILE_STEM = "MCJ_Case_Report"

HEADER = [
    "User Acc ID", "User name", "User Phone", "User Role", "Mother Adoption date",
    "Case ID", "Name of mother", "Pregnancy Stage", "Child ID", "Child Name",
    "Date of birth of baby", "Gender of baby", "Birth Weight", "Birth Height",
    "Birth Weight Zscore", "Birth Height Zscore", "Birth WFH Zscore",
    "Baby Adoption date", "Baby Adoption Weight", "Baby Adoption Height",
    "Baby Adoption Weight Zscore", "Baby Adoption Height Zscore",
    "Baby Adoption WFH Zscore", "Baby Adoption Percentile (W)",
    "Baby Adoption Percentile (H)", "Baby Adoption Percentile (WFH)",
    "Last Visit Date", "Last Weight", "Last Height", "Last Weight Zscore",
    "Last Height Zscore", "Last WFH Zscore", "Last Percentile (W)",
    "Last Percentile (H)", "Last Percentile (WFH)", "Phc Name", "Phc District",
    "Phc Taluka", "Member Tag", "Cue Rating Tag", "Last Menstrual Period (LMP)",
    "Estimated Date of Delivery (EDD)", "Case Rating", "Comments",
    "Viewed notification", "Viewed planner",
]


def _f(text) -> Optional[float]:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _z(v: Optional[float]) -> str:
    return NULL if v is None else str(round(v, 2))


def _pct(z: Optional[float]) -> str:
    if z is None:
        return NULL
    return str(round(50 * (1 + math.erf(z / math.sqrt(2))), 2))


def _sex(child) -> str:
    g = (child.gender or "").lower() if child else ""
    return "boys" if g.startswith("m") else "girls" if g.startswith("f") else ""


def _visit_metrics(child, resp) -> tuple:
    """(date, weight, height, wz, hz, whz) for one growth response."""
    view = ResponseView(resp)
    weight = _f(view.value("baby_weight"))
    height = _f(view.value("baby_length"))
    visit = resp.assessment_date
    sex = _sex(child)
    wz = hz = whz = None
    if sex and child.dob and visit:
        age_days = (visit - child.dob).days
        if age_days >= 0:
            wz = zscore_for_value("wfa", sex, age_days, weight)
            hz = zscore_for_value("lfa", sex, age_days, height)
    if sex and height is not None:
        whz = zscore_for_value("wfl", sex, height, weight)
    return visit, weight, height, wz, hz, whz


def generate(ds: Dataset) -> list[list[str]]:
    rows: list[list[str]] = []
    growth_by_child: dict[int, list] = {}
    for r in ds.responses.get("growth_monitoring", []):
        if r.child_id and r.status == "submitted":
            growth_by_child.setdefault(r.child_id, []).append(r)

    for m in ds.mothers:
        learner = ds.learner_of(m)
        kids = ds.children_by_mother.get(m.id, [])
        child = kids[0] if kids else None
        sex = _sex(child)

        bwz = bhz = bwhz = None
        if child:
            if sex and child.birth_weight is not None:
                bwz = zscore_for_value("wfa", sex, 0, child.birth_weight)
            if sex and child.birth_length is not None:
                bhz = zscore_for_value("lfa", sex, 0, child.birth_length)
            if sex and child.birth_length is not None:
                bwhz = zscore_for_value("wfl", sex, child.birth_length, child.birth_weight)

        first = last = None
        if child:
            visits = sorted(growth_by_child.get(child.id, []), key=lambda r: r.assessment_date or date.min)
            if visits:
                first = _visit_metrics(child, visits[0])
                last = _visit_metrics(child, visits[-1])

        if child and not kids[0].dob and m.lmp:
            stage = "Antenatal"
        elif child:
            stage = "Delivered"
        else:
            stage = "Antenatal"

        rows.append([
            s(learner.id if learner else None),
            s(learner.full_name if learner else None),
            s(learner.phone if learner else None),
            s(learner.role if learner else None),
            ddmmyyyy(m.adoption_date),
            s(m.id),
            s(m.mother_name),
            stage,
            s(child.id if child else None),
            s(child.child_name if child else None),
            ddmmyyyy(child.dob if child else None),
            s(child.gender if child else None),
            num(child.birth_weight if child else None),
            num(child.birth_length if child else None),
            _z(bwz), _z(bhz), _z(bwhz),
            ddmmyyyy(child.adoption_date if child else None),
            num(first[1]) if first else NULL,
            num(first[2]) if first else NULL,
            _z(first[3]) if first else NULL,
            _z(first[4]) if first else NULL,
            _z(first[5]) if first else NULL,
            _pct(first[3]) if first else NULL,
            _pct(first[4]) if first else NULL,
            _pct(first[5]) if first else NULL,
            ddmmyyyy(last[0]) if last else NULL,
            num(last[1]) if last else NULL,
            num(last[2]) if last else NULL,
            _z(last[3]) if last else NULL,
            _z(last[4]) if last else NULL,
            _z(last[5]) if last else NULL,
            _pct(last[3]) if last else NULL,
            _pct(last[4]) if last else NULL,
            _pct(last[5]) if last else NULL,
            s(getattr(m, "hwc_other", None) or None),
            s(ds.district_names.get(getattr(m, "district_id", None)) if getattr(m, "district_id", None) else None),
            s(ds.block_names.get(getattr(m, "taluk_id", None)) if getattr(m, "taluk_id", None) else None),
            NULL,
            NULL,
            ddmmyyyy(m.lmp),
            ddmmyyyy(m.edd_records),
            NULL,
            NULL,
            NULL,
            NULL,
        ])
    return rows
