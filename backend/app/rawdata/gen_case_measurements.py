"""MP_<District>_MCJ_Case_Measurements_<date>.csv — one row per growth visit.

Z-scores/percentiles are recomputed with the app's WHO growth tables
(app/who_growth.py) exactly like the learner-facing charts.
"""
from __future__ import annotations

import math
from typing import Optional

from app.who_growth import zscore_for_value

from .common import NULL, Dataset, ResponseView, s

FILE_STEM = "MCJ_Case_Measurements"

HEADER = [
    "User Acc ID", "User Name", "Facility/NGO", "User Role", "Case ID",
    "Name of mother", "Child ID", "Child Name", "Child Gender", "Visit Date",
    "Weight", "Height", "Weight Zscore", "Height Zscore", "WFH Zscore",
    "Percentile (W)", "Percentile (H)", "Percentile (WFH)",
    "Invalid Height", "Duplicate Entry",
]


def _f(text: str) -> Optional[float]:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _z(value: Optional[float]) -> str:
    return NULL if value is None else str(round(value, 2))


def _pct(z: Optional[float]) -> str:
    if z is None:
        return NULL
    return str(round(50 * (1 + math.erf(z / math.sqrt(2))), 2))


def generate(ds: Dataset) -> list[list[str]]:
    rows: list[list[str]] = []
    # For the QA flags: previous lengths + (child, date) duplicates.
    seen_dates: dict[tuple[int, str], int] = {}
    responses = [r for r in ds.responses.get("growth_monitoring", []) if r.child_id]
    for r in responses:
        view = ResponseView(r)
        key = (r.child_id, view.value("measurement_date"))
        seen_dates[key] = seen_dates.get(key, 0) + 1

    lengths_by_child: dict[int, list[tuple[str, float]]] = {}
    for r in responses:
        view = ResponseView(r)
        length = _f(view.value("baby_length"))
        if length is not None:
            lengths_by_child.setdefault(r.child_id, []).append((view.value("measurement_date"), length))

    for r in responses:
        view = ResponseView(r)
        child = ds.child_of_response(r)
        mother = ds.mother_of_response(r)
        learner = ds.learners_by_id.get(r.submitted_by_user_id or 0)
        weight = _f(view.value("baby_weight"))
        length = _f(view.value("baby_length"))
        sex = (child.gender or "").lower() if child else ""
        sex = "boys" if sex.startswith("m") else "girls" if sex.startswith("f") else ""

        age_days = None
        visit_iso = view.value("measurement_date")
        if child and child.dob and visit_iso != NULL:
            try:
                from datetime import date
                y, m_, d = (int(p) for p in visit_iso.split("-"))
                age_days = (date(y, m_, d) - child.dob).days
            except (ValueError, AttributeError):
                age_days = None

        wz = hz = whz = None
        if sex and age_days is not None and age_days >= 0:
            wz = zscore_for_value("wfa", sex, age_days, weight)
            hz = zscore_for_value("lfa", sex, age_days, length)
        if sex and length is not None:
            whz = zscore_for_value("wfl", sex, length, weight)

        invalid_height = "false"
        if child and length is not None and visit_iso != NULL:
            earlier = [l for (dt, l) in lengths_by_child.get(r.child_id, []) if dt != NULL and dt < visit_iso]
            if earlier and length < max(earlier) - 0.5:
                invalid_height = "true"

        duplicate = "true" if seen_dates.get((r.child_id, visit_iso), 0) > 1 else "false"

        rows.append([
            s(learner.id if learner else None),
            s(learner.full_name if learner else None),
            s((ds.facility_names.get(learner.facility_id) if learner and learner.facility_id else None)
              or (learner.work_center_name if learner else None)),
            s(learner.role if learner else None),
            s(mother.id if mother else None),
            s(mother.mother_name if mother else None),
            s(child.id if child else None),
            s(child.child_name if child else None),
            s(child.gender if child else None),
            _iso_to_ddmmyyyy(visit_iso),
            s(view.value("baby_weight")),
            s(view.value("baby_length")),
            _z(wz), _z(hz), _z(whz),
            _pct(wz), _pct(hz), _pct(whz),
            invalid_height,
            duplicate,
        ])
    return rows


def _iso_to_ddmmyyyy(iso: str) -> str:
    if iso == NULL or not iso:
        return NULL
    parts = iso.split("-")
    if len(parts) == 3 and len(parts[0]) == 4:
        return f"{parts[2]}/{parts[1]}/{parts[0]}"
    return iso
