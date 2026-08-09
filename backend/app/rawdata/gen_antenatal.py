"""MP_<District>_Antenatal_care_<stamp>.csv — one row per antenatal visit."""
from __future__ import annotations

from datetime import date

from .common import NULL, Dataset, ResponseView, ddmmyyyy, s, truefalse

FILE_STEM = "Antenatal_care"

HEADER = [
    "User Acc ID", "User Name", "NGO/Facility", "Submission_ID", "Submission_Date",
    "Case ID", "Name of mother", "Case Adoption Date", "District", "Taluka",
    "Village", "Awc Name No", "Draft", "Assessment date *", "Type of ANC Event *",
    "Pregnancy week during assessment *", "Antenatal care stage *",
    "Mother's weight (kgs) *", "Select applicable options *",
    'Fill details for "Other" * #', "Mother's discomfort",
    "Mother's medical history", "Mother's food intake *",
    "Is mother given iron supplement (tablets)? *",
    "Is mother given folic acid supplement (tablets)? *",
    "Hemoglobin test result (g/dL)", "Date of hemoglobin measurement",
    "Month when fetal weight gain was measured by ultrasound",
    "Weight gain measured by ultrasound (in grams) #",
    "Expected place for child delivery", "Next Antenatal checkup date *",
]

STAGE_PNC = "Postnatal Care (Child is 5 months of age or younger)"


def _parse_iso(text: str):
    try:
        y, m, d = (int(p) for p in text.split("-"))
        return date(y, m, d)
    except (ValueError, AttributeError):
        return None


def generate(ds: Dataset) -> list[list[str]]:
    rows: list[list[str]] = []
    for r in ds.responses.get("antenatal", []):
        if not r.mother_id:
            continue
        view = ResponseView(r)
        mother = ds.mothers_by_id.get(r.mother_id)
        learner = ds.learners_by_id.get(r.submitted_by_user_id or 0)
        assess = _parse_iso(view.value("assessment_date")) or r.assessment_date

        weeks = None
        if mother and mother.lmp and assess:
            weeks = max(0, (assess - mother.lmp).days // 7)
        has_child = bool(ds.children_by_mother.get(r.mother_id))
        if has_child and not (mother and mother.lmp):
            stage = STAGE_PNC
        elif weeks is None:
            stage = NULL
        elif weeks < 13:
            stage = "First Trimester"
        elif weeks <= 26:
            stage = "Second Trimester"
        else:
            stage = "Third Trimester"

        ifa_purpose = view.label("ifa_purpose")
        ifa_compliance = view.label("ifa_compliance")
        if ifa_purpose == NULL and ifa_compliance == NULL:
            iron = NULL
        elif "not taking" in ifa_purpose.lower() or "not taking" in ifa_compliance.lower():
            iron = "No"
        else:
            iron = "Yes"

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
            ddmmyyyy(assess),
            NULL,
            s(weeks) if weeks is not None and stage != STAGE_PNC else NULL,
            stage,
            view.value("current_weight"),
            view.labels("high_risk_conditions"),
            view.value("high_risk_other"),
            view.labels("pregnancy_symptoms"),
            view.labels("medications"),
            NULL,
            iron,
            iron,
            view.value("hb_value"),
            _ddmm(view.value("hb_date")),
            NULL,
            NULL,
            NULL,
            NULL,
        ])
    return rows


def _ddmm(iso: str) -> str:
    parts = (iso or "").split("-")
    if len(parts) == 3 and len(parts[0]) == 4:
        return f"{parts[2]}/{parts[1]}/{parts[0]}"
    return iso or NULL
