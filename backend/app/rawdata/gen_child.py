"""MP_<District>_Child_<stamp>.csv — one row per registered child."""
from __future__ import annotations

from .common import NULL, Dataset, ddmmyyyy, num, s, yesno

FILE_STEM = "Child"

HEADER = [
    "User Acc ID", "User Name", "NGO/Facility", "Submission_ID", "Submission_Date",
    "Case ID", "Name of mother", "Case Adoption Date", "District", "Taluka",
    "Village", "Awc Name No", "Draft", "Babies born in this delivery? *",
    "Baby's name", "Date of birth *", "Birth Weight (in Kgs) *",
    "How was weight measured? *", "Length at birth (in cms) *",
    "Head circumference (in cms)", "Baby's gender *", "Method of delivery *",
    "Location of delivery *", "Select Primary Health Center (PHC) #",
    "Select Sub Health Centre (SHC) #", "Is this the mother's first pregnancy? *",
    "Number of child's siblings * #", "Was breast crawl performed at birth? *",
    "Was baby exclusively breastfed within 1 hour of birth? *",
    "Was baby exclusively breastfed during the ward stay? *",
    "Food given to the baby at hospital * #", 'Type details of "other food" #',
]


def generate(ds: Dataset) -> list[list[str]]:
    rows: list[list[str]] = []
    for c in ds.children:
        m = ds.mothers_by_id.get(c.mother_id)
        learner = ds.learner_of(m) if m else None
        first_pregnancy = NULL
        if c.previous_living_children is not None:
            first_pregnancy = "Yes" if c.previous_living_children == 0 else "No"
        delivery_place = getattr(c, "delivery_place", None)
        if delivery_place == "Other":
            delivery_place = getattr(c, "delivery_place_other", None) or "Other"
        rows.append([
            s(learner.id if learner else None),
            s(learner.full_name if learner else None),
            s((ds.facility_names.get(learner.facility_id) if learner and learner.facility_id else None)
              or (learner.work_center_name if learner else None)),
            s(c.id),
            ddmmyyyy(c.created_at),
            s(m.id if m else None),
            s(m.mother_name if m else None),
            ddmmyyyy(m.adoption_date if m else None),
            s(ds.district_names.get(m.district_id) if m and getattr(m, "district_id", None) else None),
            s(ds.block_names.get(getattr(m, "taluk_id", None)) if m and getattr(m, "taluk_id", None) else None),
            s(getattr(m, "village", None) if m else None),
            NULL,
            "false",
            s(c.babies_born),
            s(c.child_name),
            ddmmyyyy(c.dob),
            num(c.birth_weight),
            NULL,
            num(c.birth_length),
            NULL,
            s(c.gender),
            s(c.delivery_method),
            s(delivery_place),
            NULL,
            NULL,
            first_pregnancy,
            num(c.previous_living_children),
            NULL,
            yesno(c.bf_within_one_hour),
            yesno(c.ebf_during_stay),
            NULL,
            NULL,
        ])
    return rows
