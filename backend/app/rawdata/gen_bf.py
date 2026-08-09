"""MP_<District>_Check_BF_<stamp>.csv — one row per breastfeeding assessment."""
from __future__ import annotations

from .common import NULL, Dataset, ResponseView, ddmmyyyy, s, truefalse

FILE_STEM = "Check_BF"

# Column header → BF flow-node id, in reference column order. Retired ids
# (bf_breast_hold, bf_finger_distance, bf_mouth_opening) simply resolve to
# NULL for responses recorded after those questions were folded away.
_QUESTIONS: list[tuple[str, str]] = [
    ("Hunger cues *", "bf_hunger"),
    ("Washing hands *", "bf_prep_wash"),
    ("Drinking a glass of water *", "bf_prep_water"),
    ("Sitting posture *", "bf_prep_posture"),
    ("Type of clothes worn (loose/tight/front open) *", "bf_clothes"),
    ("Waking up the baby *", "bf_waking"),
    ("Support for the baby’s body *", "bf_body_support"),
    ("Position of the baby’s ears, shoulder joint and hip joint *", "bf_alignment"),
    ("Support for the baby’s head *", "bf_head_support"),
    ("Direction of the baby's face *", "bf_face_direction"),
    ("Position of the baby’s lips (vertical/ horizontal/ diagonal) *", "bf_lip_position"),
    ("Position of the baby’s nose and chin *", "bf_nose_chin"),
    ("Holding the breast with her fingers *", "bf_breast_hold"),
    ("Direction of the mother’s fingers *", "bf_finger_direction"),
    ("Distance of the fingers from the nipple *", "bf_finger_distance"),
    ("Compressing the breast *", "bf_compressing"),
    ("Stimulate opening of the mouth *", "bf_stimulate_mouth"),
    ("Opening of the mouth for latching *", "bf_mouth_opening"),
    ("How is mother latching the baby? *", "bf_latching"),
    ("Position of baby's upper and lower lips *", "bf_upper_lower_lips"),
    ("Checking baby’s deep attachment to the breast *", "bf_deep_attachment"),
    ("Visibility of the lips and chin while breastfeeding *", "bf_lips_chin_visibility"),
    ("Appearance of the cheeks while breastfeeding *", "bf_cheeks"),
    ("How does the mother release the baby's latch in case of nipple latching or if the baby goes to sleep? *", "bf_release_latch"),
    ("Supporting the breast after checking the latch *", "bf_support_after_latch"),
    ("Frequency of breastfeeding *", "bf_frequency"),
    ("Breastfeeding at night *", "bf_night_feeding"),
    ("Breastfeeding from both the sides *", "bf_both_sides"),
    ("Emptying of one breast completely before switching to another *", "bf_emptying"),
    ("Manually expressing milk to check if the breast is completely emptied or not *", "bf_check_emptied"),
    ("Manual expression *", "bf_manual_expression"),
    ("Burping *", "bf_burping"),
]

HEADER = [
    "User Acc ID", "User Name", "NGO/Facility", "Submission_ID", "Submission_Date",
    "Case ID", "Name of mother", "Case Adoption Date", "District", "Taluka",
    "Village", "Awc Name No", "Draft", "Assessment date *",
] + [col for col, _node in _QUESTIONS]


def generate(ds: Dataset) -> list[list[str]]:
    rows: list[list[str]] = []
    for r in ds.responses.get("breastfeeding", []):
        view = ResponseView(r)
        mother = ds.mother_of_response(r)
        learner = ds.learners_by_id.get(r.submitted_by_user_id or 0)
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
            NULL,
            truefalse(r.status == "draft"),
            ddmmyyyy(r.assessment_date),
        ] + [view.label(node) for _col, node in _QUESTIONS])
    return rows
