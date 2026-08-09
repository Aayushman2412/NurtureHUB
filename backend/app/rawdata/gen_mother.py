"""MP_<District>_Mother_<stamp>.csv — one row per registered mother.

Column semantics come from the legacy Ujjain export (see the mapping spec);
headers must stay byte-identical, including trailing ' *' / ' #' markers.
"""
from __future__ import annotations

from .common import NULL, Dataset, ddmmyyyy, epoch_ms, num, s

FILE_STEM = "Mother"

HEADER = [
    "User Acc ID", "User Name", "NGO/Facility", "Submission_ID", "Submission_Date",
    "Case ID", "Role", "Draft", "Test",
    "Adoption date *", "Mother's Name *", "Who is involved in this case? *",
    "Last Menstrual Period (LMP) * #", "What was the delivery date? * #",
    "Stage at registration * #", "Current Month of Pregnancy #",
    "Current month of Pregnancy #", "Mother's Age (years) *",
    "Mother's weight (kgs) *", "Mother's height (cms)", "Diet Type *",
    "Send notifications to mother? *", "Mother's mobile number *", "Email ID",
    "Mother's education level *", "District or similar region *",
    "Village or similar geographic area", "Block Name",
    "Enter if name of mother's village and block are different",
    "Color of mother's family ration card *",
    'Enter details for "Other" ration card * #', "Mother's family type *",
    "Mother's social category *", 'Enter details for "Other" #',
    "Estimated Date of Delivery (EDD) * #", "Other ID", "ID (cannot edit)",
]

STAGE_PNC = "Postnatal Care (Child is 5 months of age or younger)"
STAGE_ANC = "Antenatal care (Currently pregnant)"


def generate(ds: Dataset) -> list[list[str]]:
    rows: list[list[str]] = []
    # Latest protein response per mother supplies the Diet Type label.
    diet_by_mother: dict[int, str] = {}
    for resp in ds.responses.get("mother_protein_intake", []):
        if resp.mother_id:
            from .common import ResponseView
            label = ResponseView(resp).label("pca_diet")
            if label != NULL:
                diet_by_mother[resp.mother_id] = label

    for m in ds.mothers:
        learner = ds.learner_of(m)
        kids = ds.children_by_mother.get(m.id, [])
        first_dob = min((c.dob for c in kids if c.dob), default=None)
        is_pnc = bool(kids)
        reg_date = m.created_at.date() if m.created_at else None
        preg_month = NULL
        if not is_pnc and m.lmp and reg_date:
            preg_month = str(max(1, (reg_date - m.lmp).days // 30))
        rows.append([
            s(learner.id if learner else None),
            s(learner.full_name if learner else None),
            s((ds.facility_names.get(learner.facility_id) if learner and learner.facility_id else None)
              or (learner.work_center_name if learner else None)),
            s(m.id),
            ddmmyyyy(m.created_at),
            s(m.id),
            s(learner.role if learner else None),
            "false",
            "false",
            ddmmyyyy(m.adoption_date),
            s(m.mother_name),
            NULL,
            ddmmyyyy(m.lmp) if not is_pnc else (ddmmyyyy(m.lmp) if m.lmp else NULL),
            ddmmyyyy(first_dob),
            STAGE_PNC if is_pnc else STAGE_ANC,
            preg_month,
            NULL,
            num(m.mother_age),
            num(m.weight),
            num(m.height),
            diet_by_mother.get(m.id, NULL),
            "Yes" if m.mobile else "No",
            s(m.mobile),
            s(m.email),
            s(ds.education_names.get(m.education_id) if getattr(m, "education_id", None) else None),
            s(ds.district_names.get(m.district_id).upper() if getattr(m, "district_id", None) and ds.district_names.get(m.district_id) else None),
            s(getattr(m, "village", None)),
            s(ds.block_names.get(getattr(m, "taluk_id", None)) if getattr(m, "taluk_id", None) else None),
            NULL,
            s(getattr(m, "ration_card", None)),
            s(getattr(m, "ration_card_other", None)),
            NULL,
            s(getattr(m, "social_category", None)),
            NULL,
            ddmmyyyy(m.edd_records) if not is_pnc else NULL,
            NULL,
            f"90/{learner.id}/{epoch_ms(m.created_at)}" if learner and m.created_at else NULL,
        ])
    return rows
