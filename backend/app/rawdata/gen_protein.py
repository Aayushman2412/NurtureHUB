"""MP_<District>_Mother's_Protein_Intake_<stamp>.csv — one row per protein assessment."""
from __future__ import annotations

from .common import NULL, Dataset, ResponseView, ddmmyyyy, s, truefalse

FILE_STEM = "Mother's_Protein_Intake"

HEADER = [
    "User Acc ID",
    "User Name",
    "NGO/Facility",
    "Submission_ID",
    "Submission_Date",
    "Case ID",
    "Name of mother",
    "Case Adoption Date",
    "District",
    "Taluka",
    "Village",
    "Awc Name No",
    "Draft",
    "Assessment date *",
    "Diet type *",
    "Mother's status *",
    "Number of portions eaten in the last 24 hours/1 cup of cooked whole beans or sprouts or thick consistency dal (10 grams of protein)",
    "Days per week eaten/1 cup of cooked whole beans or sprouts or thick consistency dal (10 grams of protein)",
    "Number of portions eaten in the last 24 hours/1 cup of cooked whole soyabeans (22 grams of protein)",
    "Days per week eaten/1 cup of cooked whole soyabeans (22 grams of protein)",
    "Pulses consumed by mother *",
    "Number of portions eaten in the last 24 hours/1 cup of curd (8 grams of protein)",
    "Days per week eaten/1 cup of curd (8 grams of protein)",
    "Number of portions eaten in the last 24 hours/1 glass of milk  (8 grams of protein)",
    "Days per week eaten/1 glass of milk  (8 grams of protein)",
    "Number of portions eaten in the last 24 hours/3 to 4 pieces of paneer (8.8 grams of protein)",
    "Days per week eaten/3 to 4 pieces of paneer (8.8 grams of protein)",
    "Milk products consumed by mother *",
    "Number of portions eaten in the last 24 hours/1 bhakri (jowar/bajra/etc.)  (10.9 grams of protein)",
    "Days per week eaten/1 bhakri (jowar/bajra/etc.)  (10.9 grams of protein)",
    "Number of portions eaten in the last 24 hours/1 cup of rice  (5 grams of protein)",
    "Days per week eaten/1 cup of rice  (5 grams of protein)",
    "Number of portions eaten in the last 24 hours/1 cup of cooked millets (jowar/bajra/ragi/kodo, etc.)  (7.5 grams of protein)",
    "Days per week eaten/1 cup of cooked millets (jowar/bajra/ragi/kodo, etc.)  (7.5 grams of protein)",
    "Number of portions eaten in the last 24 hours/1 roti or chapati  (6 grams of protein)",
    "Days per week eaten/1 roti or chapati  (6 grams of protein)",
    "Grains and millets consumed by mother *",
    "Number of portions eaten in the last 24 hours/Half cup or wati of dry cooked green leafy vegetables (not curry) (150 grams raw)  (3.6 grams of protein)",
    "Days per week eaten/Half cup or wati of dry cooked green leafy vegetables (not curry) (150 grams raw)  (3.6 grams of protein)",
    "Number of portions eaten in the last 24 hours/1 cup or wati of thinly cooked curry (100 grams raw)  (5.4 grams of protein)",
    "Days per week eaten/1 cup or wati of thinly cooked curry (100 grams raw)  (5.4 grams of protein)",
    "Green leafy vegetables consumed by mother *",
    "Number of portions eaten in the last 24 hours/1 cup or wati of thinly cooked vegetable curry (100 grams raw)  (1.7 grams of protein)",
    "Days per week eaten/1 cup or wati of thinly cooked vegetable curry (100 grams raw)  (1.7 grams of protein)",
    "Number of portions eaten in the last 24 hours/1 cup or wati of dry cooked vegetables (200 grams raw)  (3.4 grams of protein)",
    "Days per week eaten/1 cup or wati of dry cooked vegetables (200 grams raw)  (3.4 grams of protein)",
    "Other vegetables consumed by mother *",
    "Number of portions eaten in the last 24 hours/1 cup or wati of thinly cooked roots and tubers curry (100 grams raw) (1.3 grams of protein)",
    "Days per week eaten/1 cup or wati of thinly cooked roots and tubers curry (100 grams raw) (1.3 grams of protein)",
    "Number of portions eaten in the last 24 hours/1 cup or wati of dry cooked roots and tubers (200 grams raw)  (2.6 grams of protein)",
    "Days per week eaten/1 cup or wati of dry cooked roots and tubers (200 grams raw)  (2.6 grams of protein)",
    "Roots and tubers consumed by mother *",
    "Number of portions eaten in the last 24 hours/1 tablespoon (15 grams) (3 grams of protein)",
    "Days per week eaten/1 tablespoon (15 grams) (3 grams of protein)",
    "Nuts and seeds consumed by mother *",
    "Number of portions eaten in the last 24 hours/1 egg  (7 grams of protein)",
    "Days per week eaten/1 egg  (7 grams of protein)",
    "Eggs consumed by mother * #",
    "Number of portions eaten in the last 24 hours/4 medium size pieces cooked at home (100 grams)  (20 grams of protein)",
    "Days per week eaten/4 medium size pieces cooked at home (100 grams)  (20 grams of protein)",
    "Meat and organs, chicken or poultry, or seafood consumed by mother * #",
    "Total protein from all foods (grams)",
    "Excellent and high quality protein (grams)",
]

# grams of protein per serving per matrix row (from seed_forms.py's tables)
_PROTEIN = {
    ("pca_m_pulses", "pca_m_pulses_r1"): 10.0, ("pca_m_pulses", "pca_m_pulses_r2"): 22.0,
    ("pca_m_milk", "pca_m_milk_r1"): 8.0, ("pca_m_milk", "pca_m_milk_r2"): 8.8, ("pca_m_milk", "pca_m_milk_r3"): 8.0,
    ("pca_m_grains", "pca_m_grains_r1"): 6.0, ("pca_m_grains", "pca_m_grains_r2"): 5.0,
    ("pca_m_millets", "pca_m_millets_r1"): 10.9,
    ("pca_m_leafy", "pca_m_leafy_r1"): 3.6, ("pca_m_leafy", "pca_m_leafy_r2"): 5.4,
    ("pca_m_veg", "pca_m_veg_r1"): 3.4, ("pca_m_veg", "pca_m_veg_r2"): 1.7,
    ("pca_m_roots", "pca_m_roots_r1"): 2.6, ("pca_m_roots", "pca_m_roots_r2"): 1.3,
    ("pca_m_nuts", "pca_m_nuts_r1"): 3.0,
    ("pca_m_eggs", "pca_m_eggs_r1"): 7.0,
    ("pca_m_meat", "pca_m_meat_r1"): 20.0,
}
_HIGH_QUALITY = {"pca_m_milk", "pca_m_eggs", "pca_m_meat"}

# per-column cell recipe, in HEADER order
_CELLS = [
    ("common", "User Acc ID"),  # users.id
    ("common", "User Name"),  # users.full_name
    ("common", "NGO/Facility"),  # users.work_center_name
    ("common", "Submission_ID"),  # form_responses.id
    ("common", "Submission_Date"),  # form_responses.created_at
    ("common", "Case ID"),  # mothers.id
    ("common", "Name of mother"),  # mothers.mother_name
    ("common", "Case Adoption Date"),  # mothers.adoption_date
    ("common", "District"),  # derived:districts.name (via mothers.district_id) uppercased
    ("common", "Taluka"),  # derived:blocks.name via mothers.taluk_id
    ("common", "Village"),  # mothers.village
    ("null",),
    ("common", "Draft"),  # derived:'true' if form_responses.status=='draft' else 'false
    ("assess_date",),
    ("label", "pca_diet"),
    ("label", "pca_status"),
    ("cell", "pca_m_pulses", "pca_m_pulses_r1", "qty24"),
    ("cell", "pca_m_pulses", "pca_m_pulses_r1", "freq"),
    ("cell", "pca_m_pulses", "pca_m_pulses_r2", "qty24"),
    ("cell", "pca_m_pulses", "pca_m_pulses_r2", "freq"),
    ("null",),
    ("cell", "pca_m_milk", "pca_m_milk_r1", "qty24"),
    ("cell", "pca_m_milk", "pca_m_milk_r1", "freq"),
    ("cell", "pca_m_milk", "pca_m_milk_r3", "qty24"),
    ("cell", "pca_m_milk", "pca_m_milk_r3", "freq"),
    ("cell", "pca_m_milk", "pca_m_milk_r2", "qty24"),
    ("cell", "pca_m_milk", "pca_m_milk_r2", "freq"),
    ("null",),
    ("cell", "pca_m_millets", "pca_m_millets_r1", "qty24"),
    ("cell", "pca_m_millets", "pca_m_millets_r1", "freq"),
    ("cell", "pca_m_grains", "pca_m_grains_r2", "qty24"),
    ("cell", "pca_m_grains", "pca_m_grains_r2", "freq"),
    ("null",),
    ("null",),
    ("cell", "pca_m_grains", "pca_m_grains_r1", "qty24"),
    ("cell", "pca_m_grains", "pca_m_grains_r1", "freq"),
    ("null",),
    ("cell", "pca_m_leafy", "pca_m_leafy_r1", "qty24"),
    ("cell", "pca_m_leafy", "pca_m_leafy_r1", "freq"),
    ("cell", "pca_m_leafy", "pca_m_leafy_r2", "qty24"),
    ("cell", "pca_m_leafy", "pca_m_leafy_r2", "freq"),
    ("null",),
    ("cell", "pca_m_veg", "pca_m_veg_r2", "qty24"),
    ("cell", "pca_m_veg", "pca_m_veg_r2", "freq"),
    ("cell", "pca_m_veg", "pca_m_veg_r1", "qty24"),
    ("cell", "pca_m_veg", "pca_m_veg_r1", "freq"),
    ("null",),
    ("cell", "pca_m_roots", "pca_m_roots_r2", "qty24"),
    ("cell", "pca_m_roots", "pca_m_roots_r2", "freq"),
    ("cell", "pca_m_roots", "pca_m_roots_r1", "qty24"),
    ("cell", "pca_m_roots", "pca_m_roots_r1", "freq"),
    ("null",),
    ("cell", "pca_m_nuts", "pca_m_nuts_r1", "qty24"),
    ("cell", "pca_m_nuts", "pca_m_nuts_r1", "freq"),
    ("null",),
    ("cell", "pca_m_eggs", "pca_m_eggs_r1", "qty24"),
    ("cell", "pca_m_eggs", "pca_m_eggs_r1", "freq"),
    ("null",),
    ("cell", "pca_m_meat", "pca_m_meat_r1", "qty24"),
    ("cell", "pca_m_meat", "pca_m_meat_r1", "freq"),
    ("null",),
    ("total_protein",),
    ("hq_protein",),
]


def _grids(view: ResponseView) -> dict:
    return {node: view.grid(node) for node in {c[1] for c in _CELLS if c[0] == "cell"}}


def _num(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def generate(ds: Dataset) -> list[list[str]]:
    rows: list[list[str]] = []
    for r in ds.responses.get("mother_protein_intake", []):
        if not r.mother_id:
            continue
        view = ResponseView(r)
        mother = ds.mothers_by_id.get(r.mother_id)
        learner = ds.learners_by_id.get(r.submitted_by_user_id or 0)
        grids = _grids(view)

        total = hq = 0.0
        for (node, row_id), grams in _PROTEIN.items():
            qty = _num((grids.get(node, {}).get(row_id) or {}).get("qty24"))
            total += qty * grams
            if node in _HIGH_QUALITY:
                hq += qty * grams

        common = {
            "User Acc ID": s(learner.id if learner else None),
            "User Name": s(learner.full_name if learner else None),
            "NGO/Facility": s((ds.facility_names.get(learner.facility_id) if learner and learner.facility_id else None)
                              or (learner.work_center_name if learner else None)),
            "Submission_ID": s(r.id),
            "Submission_Date": ddmmyyyy(r.created_at),
            "Case ID": s(mother.id if mother else None),
            "Name of mother": s(mother.mother_name if mother else None),
            "Case Adoption Date": ddmmyyyy(mother.adoption_date if mother else None),
            "District": s(ds.district_names.get(mother.district_id).upper()
                          if mother and getattr(mother, "district_id", None) and ds.district_names.get(mother.district_id) else None),
            "Taluka": s(ds.block_names.get(getattr(mother, "taluk_id", None)) if mother and getattr(mother, "taluk_id", None) else None),
            "Village": s(getattr(mother, "village", None) if mother else None),
            "Awc Name No": NULL,
            "Draft": truefalse(r.status == "draft"),
        }

        row: list[str] = []
        for cell in _CELLS:
            kind = cell[0]
            if kind == "null":
                row.append(NULL)
            elif kind == "assess_date":
                row.append(ddmmyyyy(r.assessment_date))
            elif kind == "label":
                row.append(view.label(cell[1]))
            elif kind == "cell":
                _tag, node, row_id, col_id = cell
                row.append(s((grids.get(node, {}).get(row_id) or {}).get(col_id)))
            elif kind == "total_protein":
                row.append(f"{total:.2f}")
            elif kind == "hq_protein":
                row.append(f"{hq:.2f}")
            else:
                row.append(common.get(cell[1], NULL))
        rows.append(row)
    return rows
