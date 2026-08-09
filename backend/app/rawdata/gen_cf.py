"""MP_<District>_Check_CF_<stamp>.csv — one row per complementary-feeding assessment."""
from __future__ import annotations

from datetime import date

from .common import NULL, Dataset, ResponseView, ddmmyyyy, s, truefalse

FILE_STEM = "Check_CF"

# (header, node id, mode) — mode: 'label' single-choice, 'labels' multi-select,
# 'id' = bare option slug (legacy CSV holds the number itself).
_QUESTIONS: list[tuple[str, str, str]] = [
    ("Baby's diet type *", "cfa_diet", "label"),
    ("Number of days per week whole beans or pulses were given to baby", "cfa_pulses_freq", "label"),
    ("Select whole beans or pulses  given to baby * #", "cfa_pulses_types", "labels"),
    ("Did you give the baby whole beans or pulses in the last 24 hours? * #", "cfa_pulses_24h", "label"),
    ("Number of days per week milk products were given to baby *", "cfa_milk_freq", "label"),
    ("Select types of milk products given to baby * #", "cfa_milk_types", "labels"),
    ("Did you give the baby any milk items in the last 24 hours? * #", "cfa_milk_24h", "label"),
    ("Number of days per week grains were given to baby *", "cfa_grains_freq", "label"),
    ("Select types of grains given to baby * #", "cfa_grains_types", "labels"),
    ("Did you give the baby any grains in the last 24 hours? * #", "cfa_grains_24h", "label"),
    ("Number of days per week millets were given to baby *", "cfa_millets_freq", "label"),
    ("Select types of millets given to baby * #", "cfa_millets_types", "labels"),
    ("Did you give the baby any millets in the last 24 hours? * #", "cfa_millets_24h", "label"),
    ("Number of days per week green leafy vegetables were given to baby *", "cfa_leafy_veg_freq", "label"),
    ("Did you give the baby any green leafy vegetables in the last 24 hours? * #", "cfa_leafy_veg_24h", "label"),
    ("Number of days per week red and orange vegetables were given to baby *", "cfa_orange_veg_freq", "label"),
    ("Did you give the baby any red and orange vegetables in the last 24 hours? * #", "cfa_orange_veg_24h", "label"),
    ("Number of days/week other vegetables were given to baby *", "cfa_other_veg_freq", "label"),
    ("Did you give the baby any other vegetables in the last 24 hours? * #", "cfa_other_veg_24h", "label"),
    ("Number of days per week fruits were given to baby *", "cfa_fruits_freq", "label"),
    ("Did you give the baby any fruits in the last 24 hours? * #", "cfa_fruits_24h", "label"),
    ("Number of days per week roots and tubers were given to baby *", "cfa_roots_freq", "label"),
    ("Did you give the baby any roots and tubers in the last 24 hours? * #", "cfa_roots_24h", "label"),
    ("Number of days per week nuts and seeds were given to baby *", "cfa_nuts_freq", "label"),
    ("Did you give the baby any nuts and seeds in the last 24 hours? * #", "cfa_nuts_24h", "label"),
    ("Number of days per week eggs were given to baby * #", "cfa_eggs_freq", "label"),
    ("Did you give the baby any eggs in the last 24 hours? * #", "cfa_eggs_24h", "label"),
    ("Number of days per week chicken or poultry were given to baby * #", "cfa_chicken_freq", "label"),
    ("Did you give the baby any chicken or poultry in the last 24 hours? * #", "cfa_chicken_24h", "label"),
    ("Number of days per week seafood was given to baby * #", "cfa_seafood_freq", "label"),
    ("Did you give the baby any seafood in the last 24 hours? * #", "cfa_seafood_24h", "label"),
    ("Number of days per week meat and organs were given to baby * #", "cfa_meat_freq", "label"),
    ("Did you give the baby any meat or organs in the last 24 hours? * #", "cfa_meat_24h", "label"),
    ("Consistency of food given to the baby *", "cfa_practice_consistency", "label"),
    ("Number of meals per day *", "cfa_practice_meals", "id"),
    ("Quantity of food given to the baby per meal *", "cfa_practice_quantity", "label"),
    ("Were the following ingredients added to the baby's food? *", "cfa_ingredients", "labels"),
    ("Baby is breastfed or given expressed breast milk every day *", "cfa_bf_timing", "label"),
    ("Type of water given to the baby *", "cfa_water", "label"),
    ("Was a combination of cereals and pulses given? *", "cfa_diversity", "label"),
    ("Which of the following was given to the baby? *", "cfa_limit", "labels"),
    ("Is fruit puree added to the baby's regular meals? *", "cfa_fruit_puree", "puree"),
    ("What cooking techniques were used to increase nutrient absorption for the food given to the baby? *", "cfa_cooking", "labels"),
    ("Which home-made nutritious powders was added to the food given to the baby? *", "cfa_powders", "labels"),
]

HEADER = [
    "User Acc ID", "User Name", "NGO/Facility", "Submission_ID", "Submission_Date",
    "Case ID", "Name of mother", "Case Adoption Date", "District", "Taluka",
    "Village", "Awc Name No", "Draft", "Assessment date *", "Age of baby",
    "Age of baby in days",
] + [col for col, _n, _m in _QUESTIONS]


def _age_text(days: int) -> str:
    months, rem = divmod(days, 30)
    weeks, d = divmod(rem, 7)
    parts = [f"{months}M"]
    if weeks:
        parts.append(f"{weeks}W")
    if d or len(parts) == 1:
        parts.append(f"{d}D")
    return " ".join(parts)


def _cell(view: ResponseView, node: str, mode: str) -> str:
    if mode == "labels":
        return view.labels(node)
    if mode == "id":
        # Legacy CSV holds the bare number ('1'..'5'); our option ids are
        # slugs like 'cfa_practice_meals_5' — keep only the trailing number.
        snap = view.by_node.get(node)
        sel = (snap or {}).get("selected") or []
        if not sel:
            return NULL
        option_id = str(sel[0].get("optionId") or "")
        tail = option_id.rsplit("_", 1)[-1]
        if tail.isdigit():
            return tail
        if tail == "gt5":
            return ">5"
        return s(option_id)
    if mode == "puree":
        label = view.label(node)
        if label == NULL:
            return NULL
        return "Fruit puree added" if label.lower().startswith("yes") or "added" in label.lower() and "not" not in label.lower() else "Fruit puree not added"
    return view.label(node)


def generate(ds: Dataset) -> list[list[str]]:
    rows: list[list[str]] = []
    for r in ds.responses.get("complementary_feeding", []):
        view = ResponseView(r)
        mother = ds.mother_of_response(r)
        child = ds.child_of_response(r)
        learner = ds.learners_by_id.get(r.submitted_by_user_id or 0)
        age_days = None
        if child and child.dob and r.assessment_date:
            age_days = (r.assessment_date - child.dob).days
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
            _age_text(age_days) if age_days is not None and age_days >= 0 else NULL,
            s(age_days) if age_days is not None and age_days >= 0 else NULL,
        ] + [_cell(view, node, mode) for _col, node, mode in _QUESTIONS])
    return rows
