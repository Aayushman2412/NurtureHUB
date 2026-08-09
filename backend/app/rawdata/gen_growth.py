"""MP_<District>_Check_growth_<stamp>.csv — one row per growth visit response."""
from __future__ import annotations

from datetime import date
from typing import Optional

from app.who_growth import zscore_for_value

from .common import NULL, Dataset, ResponseView, ddmmyyyy, s, truefalse

FILE_STEM = "Check_growth"

HEADER = [
    "User Acc ID", "User Name", "NGO/Facility", "Submission_ID", "Submission_Date",
    "Case ID", "Name of mother", "Case Adoption Date", "District", "Taluka",
    "Village", "Awc Name No", "Draft", "Child ID", "Child Gender", "Invalid Height",
    "Measurement date *", "Are you able to measure the child's weight and height? *",
    "key reasons for not recording measurements * #",
    "Location where measurement taken * #", "Upload picture of weight taken #",
    "Baby's weight (in kgs) * #", "Length of baby (in centimeters) * #",
    "Does this child have any illness? * #", "Illness observed * #",
    'Type details of "other" illness #', "Is this child referred to any doctor? * #",
    "Was child fed anything except breastmilk? * #", "Food given to the baby * #",
    'Type details of "other food" * #', "Weight Zscore Label", "Height Zscore Label",
    "Wfh Zscore Label",
]

_REFERRAL_HINTS = ("centre", "center", "hospital", "clinic", "phc", "chc", "admission")


def _f(text: str) -> Optional[float]:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _bucket(z: Optional[float], moderate: str, severe: str) -> str:
    if z is None:
        return NULL
    if z >= -1:
        return "Normal"
    if z >= -2:
        return "Mild"
    if z >= -3:
        return moderate
    return severe


def _iso_to_ddmmyyyy(iso: str) -> str:
    parts = (iso or "").split("-")
    if len(parts) == 3 and len(parts[0]) == 4:
        return f"{parts[2]}/{parts[1]}/{parts[0]}"
    return iso or NULL


def generate(ds: Dataset) -> list[list[str]]:
    rows: list[list[str]] = []
    responses = [r for r in ds.responses.get("growth_monitoring", []) if r.child_id]

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

        visit_iso = view.value("measurement_date")
        weight = _f(view.value("baby_weight"))
        length = _f(view.value("baby_length"))
        sex = (child.gender or "").lower() if child else ""
        sex = "boys" if sex.startswith("m") else "girls" if sex.startswith("f") else ""
        age_days = None
        if child and child.dob and visit_iso != NULL:
            try:
                y, mo, d = (int(p) for p in visit_iso.split("-"))
                age_days = (date(y, mo, d) - child.dob).days
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

        services = view.labels("health_services")
        referred = NULL
        if services != NULL:
            referred = "Yes" if any(h in services.lower() for h in _REFERRAL_HINTS) else "No"

        awc = NULL
        if learner and "anganwadi" in (getattr(learner, "work_center_type", "") or "").lower():
            awc = s(learner.work_center_name)

        rows.append([
            s(learner.id if learner else None),
            s(learner.full_name if learner else None),
            s((ds.facility_names.get(learner.facility_id) if learner and learner.facility_id else None)
              or (learner.work_center_name if learner else None)),
            s(r.id),
            ddmmyyyy(r.created_at),
            s(mother.id if mother else None),
            s(mother.mother_name if mother else None),
            ddmmyyyy(mother.adoption_date if mother else None),
            s(ds.district_names.get(mother.district_id).upper()
              if mother and getattr(mother, "district_id", None) and ds.district_names.get(mother.district_id) else None),
            s(ds.block_names.get(getattr(mother, "taluk_id", None)) if mother and getattr(mother, "taluk_id", None) else None),
            s(getattr(mother, "village", None) if mother else None),
            awc,
            truefalse(r.status == "draft"),
            s(child.id if child else None),
            s(child.gender if child else None),
            invalid_height,
            _iso_to_ddmmyyyy(visit_iso),
            view.label("measurement_completed"),
            view.labels("measurement_not_done_reason"),
            view.label("measurement_location"),
            view.value("weight_photo"),
            view.value("baby_weight"),
            view.value("baby_length"),
            view.label("illness_since_last_visit"),
            view.labels("illness_type"),
            view.value("illness_other"),
            referred,
            view.label("received_other_foods"),
            view.labels("foods_given"),
            view.value("other_food"),
            _bucket(wz, "MUW", "SUW"),
            _bucket(hz, "Moderate", "Severe"),
            _bucket(whz, "MAM", "SAM"),
        ])
    return rows
