"""Large fabricated Dataset for localhost testing (RAW_EXPORT_MOCK=true).

Fabrication happens at the Dataset layer — mock objects imitate the ORM rows'
attributes and flow through the exact same generators as production data, so a
mock run proves the real code path. Option answers are drawn from the REAL
form schemas (seed_forms.build_schema), so exported labels are authentic.

Deterministic: same seed → same dataset.
"""
from __future__ import annotations

import json
import random
from datetime import date, datetime, timedelta
from types import SimpleNamespace as NS

from app.seed_forms import build_schema

from .common import Dataset

MOCK_LEARNERS = 40
MOCK_MOTHERS = 600
_TODAY = date(2026, 8, 1)

_FIRST = ["Sunita", "Radha", "Kavita", "Meena", "Pooja", "Asha", "Rekha", "Geeta",
          "Sarita", "Anita", "Lakshmi", "Savita", "Nirmala", "Usha", "Manju"]
_LAST = ["Parmar", "Verma", "Malviya", "Chouhan", "Sharma", "Yadav", "Patel",
         "Rathore", "Solanki", "Jat"]
_VILLAGES = ["Kalyanpur", "Naya Gaon", "Rampura", "Bhilsuda", "Khachrod",
             "Tarana", "Nagda", "Mahidpur", "Ghatiya", "Barnagar"]
_BLOCKS = {1: "Badnagar", 2: "Bhadla", 3: "Ghatiya", 4: "Khachrod", 5: "Mahidpur", 6: "Tarana"}
_ROLES = ["Anganwadi Worker", "ANM", "ASHA", "Anganwadi Supervisor", "CHO"]


def _rng() -> random.Random:
    return random.Random(20260801)


def _flat_answers(schema: dict, rng: random.Random, overrides: dict) -> list:
    """Snapshot-shaped answers for a flat form, random options, overrides win."""
    snaps = []
    for f in schema.get("fields") or []:
        fid = f.get("id")
        ftype = f.get("type") or "text"
        if not fid:
            continue
        if fid in overrides:
            value = overrides[fid]
            snaps.append({"nodeId": fid, "question": f.get("label") or "",
                          "questionType": ftype, "value": str(value), "selected": []})
            continue
        options = [o for o in (f.get("options") or []) if isinstance(o, dict)]
        if ftype in ("radio", "dropdown") and options:
            o = rng.choice(options)
            snaps.append({"nodeId": fid, "question": f.get("label") or "", "questionType": ftype,
                          "value": None,
                          "selected": [{"optionId": o.get("value") or o.get("id"), "label": o.get("label")}]})
        elif ftype == "checkbox" and options:
            picks = rng.sample(options, k=min(len(options), rng.randint(1, 3)))
            snaps.append({"nodeId": fid, "question": f.get("label") or "", "questionType": ftype,
                          "value": None,
                          "selected": [{"optionId": o.get("value") or o.get("id"), "label": o.get("label")} for o in picks]})
        elif ftype == "number":
            snaps.append({"nodeId": fid, "question": f.get("label") or "", "questionType": ftype,
                          "value": str(rng.randint(1, 9)), "selected": []})
        # text/date/image fields without overrides stay unanswered (optional)
    return snaps


def _flow_answers(schema: dict, rng: random.Random, overrides: dict) -> list:
    """Snapshot-shaped answers for every question/matrix node of a flow form.

    Questions may sit at the top level OR nested inside section nodes'
    `children` (the BF checklist does the latter) — walk both.
    """
    snaps = []
    queue: list = list((schema.get("nodes") or {}).values())
    while queue:
        node = queue.pop(0)
        nid = node.get("id")
        kind = node.get("kind")
        if kind == "section":
            queue.extend(c for c in (node.get("children") or []) if isinstance(c, dict))
            continue
        if not nid:
            continue
        if kind == "question":
            if nid in overrides:
                snaps.append({"nodeId": nid, "question": node.get("title") or "",
                              "questionType": node.get("questionType") or "single",
                              "value": str(overrides[nid]), "selected": []})
                continue
            options = [o for o in (node.get("options") or []) if isinstance(o, dict)]
            qtype = node.get("questionType") or "single"
            if qtype == "multi" and options:
                picks = rng.sample(options, k=min(len(options), rng.randint(1, 3)))
                sel = [{"optionId": o.get("id"), "label": o.get("label")} for o in picks]
            elif options:
                o = rng.choice(options)
                sel = [{"optionId": o.get("id"), "label": o.get("label")}]
            else:
                snaps.append({"nodeId": nid, "question": node.get("title") or "",
                              "questionType": qtype, "value": str(rng.randint(1, 5)), "selected": []})
                continue
            snaps.append({"nodeId": nid, "question": node.get("title") or "",
                          "questionType": qtype, "value": None, "selected": sel})
        elif kind == "matrix":
            matrix = node.get("matrix") or node
            grid = {}
            for row in matrix.get("rows") or []:
                rid = row.get("id")
                if not rid:
                    continue
                freq = rng.randint(0, 7)
                grid[rid] = {"freq": str(freq),
                             "usual": str(rng.randint(0, 3)) if freq else "0",
                             "qty24": str(rng.randint(0, 3)) if freq else "0"}
            snaps.append({"nodeId": nid, "question": node.get("title") or "",
                          "questionType": "matrix", "value": json.dumps(grid), "selected": []})
    return snaps


# Real per-district MASD "Location" vocabulary (from the analysts' location
# masters) — mock learners must carry matchable block names or the MASD
# colour-coding stage finds zero rows per block and writes empty workbooks.
MASD_GEO: dict[str, list[tuple[str, list[str]]]] = {
    "Ujjain": [("Ujjain", ["Badnagar", "Ghatiya", "Khachrod", "Badnagar-01", "Ujjain - Rural"])],
    "Jalna": [("Jalna", ["AMBAD-1", "AMBAD-2", "JALNA-1", "JALNA-2", "Ambad", "Ghansawangi"])],
    "Meghalaya": [
        ("East Khasi Hills", ["Mawphlang", "Laitkroh", "Mawkynrew", "Khatarshnong Laitkroh", "Mawpat"]),
        ("Ri Bhoi", ["Bhoirymbong", "Jirang", "Umling", "Umsning"]),
    ],
}


def mock_dataset(district: str, project_code: str,
                 locations: list[str] | None = None) -> Dataset:
    rng = _rng()
    ds = Dataset(district=district, project_code=project_code)
    ds.district_names = {1: district}
    if locations:
        ds.block_names = {i + 1: name for i, name in enumerate(locations)}
    else:
        ds.block_names = dict(_BLOCKS)

    block_ids = list(ds.block_names)
    for i in range(1, MOCK_LEARNERS + 1):
        u = NS(id=6000 + i,
               full_name=f"{rng.choice(_FIRST)} {rng.choice(_LAST)}",
               email=f"learner{i}@example.org", phone=f"9{rng.randint(100000000, 999999999)}",
               role=rng.choice(_ROLES), designation_id=None, facility_id=None,
               block_id=rng.choice(block_ids),
               work_center_name=f"AWC {rng.choice(_VILLAGES)} {rng.randint(1, 4)}",
               work_center_type="Anganwadi Centre (AWC)", program_district_id=1)
        ds.learners.append(u)
        ds.learners_by_id[u.id] = u

    flat_schemas = {k: build_schema(k) for k in ("growth_monitoring", "antenatal")}
    flow_schemas = {k: build_schema(k) for k in ("breastfeeding", "complementary_feeding", "mother_protein_intake")}
    response_id = 100000

    def add_response(form_key, schema_kind, overrides, *, mother_id=None, child_id=None,
                     user_id, assess: date):
        nonlocal response_id
        response_id += 1
        schema = flat_schemas.get(form_key) or flow_schemas[form_key]
        answers = (_flat_answers if schema_kind == "flat" else _flow_answers)(schema, rng, overrides)
        r = NS(id=response_id, form_key=form_key, mother_id=mother_id, child_id=child_id,
               submitted_by_user_id=user_id, assessment_date=assess, status="submitted",
               answers_json=answers,
               created_at=datetime(assess.year, assess.month, assess.day, rng.randint(8, 18), rng.randint(0, 59)))
        ds.responses.setdefault(form_key, []).append(r)

    child_id_seq = 40000
    for mid in range(1, MOCK_MOTHERS + 1):
        reg = _TODAY - timedelta(days=rng.randint(10, 200))
        learner = rng.choice(ds.learners)
        has_child = rng.random() < 0.75
        lmp = None if has_child else reg - timedelta(days=rng.randint(30, 240))
        m = NS(id=20000 + mid, registered_by_user_id=learner.id,
               mother_name=f"{rng.choice(_FIRST)} {rng.choice(_LAST)}",
               adoption_date=reg, created_at=datetime(reg.year, reg.month, reg.day, 11, 0),
               mother_age=rng.randint(19, 38), weight=float(rng.randint(42, 70)),
               height=float(rng.randint(145, 168)), lmp=lmp,
               edd_lmp=lmp + timedelta(days=280) if lmp else None,
               edd_records=lmp + timedelta(days=280) if lmp else None,
               mobile=f"9{rng.randint(100000000, 999999999)}", email=None,
               education_id=None, district_id=1, taluk_id=rng.choice(block_ids),
               village=rng.choice(_VILLAGES), ration_card=rng.choice(["Yellow", "White", "Saffron"]),
               ration_card_other=None, social_category=rng.choice(
                   ["General", "Scheduled Caste (SC)", "Scheduled Tribe (ST)", "Other Backward Class (OBC)"]),
               hwc_other=None)
        ds.mothers.append(m)
        ds.mothers_by_id[m.id] = m

        if has_child:
            child_id_seq += 1
            dob = reg - timedelta(days=rng.randint(0, 150))
            c = NS(id=child_id_seq, mother_id=m.id, child_name=f"Baby {m.mother_name.split()[0]}",
                   adoption_date=reg, created_at=m.created_at, dob=dob,
                   birth_weight=round(rng.uniform(2.0, 3.8), 2), birth_length=round(rng.uniform(45, 53), 1),
                   gender=rng.choice(["Male", "Female"]), babies_born="Single",
                   previous_living_children=rng.randint(0, 3),
                   delivery_method=rng.choice(["Normal vaginal delivery", "Caesarean section (C-section)"]),
                   delivery_place=rng.choice(["District Hospital", "Primary Health Centre (PHC)", "Home"]),
                   delivery_place_other=None, bf_within_one_hour=rng.random() < 0.8,
                   bf_reason=None, ebf_during_stay=rng.random() < 0.85)
            ds.children.append(c)
            ds.children_by_id[c.id] = c
            ds.children_by_mother.setdefault(m.id, []).append(c)

            # Growth visits (the daily Check Growth stream) + BF/CF assessments.
            for v in range(rng.randint(2, 6)):
                visit = dob + timedelta(days=rng.randint(3, max(4, (_TODAY - dob).days)))
                if visit > _TODAY:
                    visit = _TODAY
                age_days = (visit - dob).days
                weight = round(2.8 + age_days * rng.uniform(0.02, 0.035), 2)
                length = round(48 + age_days * rng.uniform(0.08, 0.12), 1)
                add_response("growth_monitoring", "flat", {
                    "measurement_date": visit.isoformat(),
                    "baby_weight": f"{weight}", "baby_length": f"{length}",
                }, child_id=c.id, user_id=learner.id, assess=visit)
            for _ in range(rng.randint(1, 3)):
                visit = dob + timedelta(days=rng.randint(2, max(3, min(150, (_TODAY - dob).days))))
                add_response("breastfeeding", "flow", {"bf_date": visit.isoformat()},
                             child_id=c.id, user_id=learner.id, assess=visit)
            if (_TODAY - dob).days > 150 and rng.random() < 0.7:
                visit = dob + timedelta(days=rng.randint(151, max(152, (_TODAY - dob).days)))
                add_response("complementary_feeding", "flow", {"cfa_date": visit.isoformat()},
                             child_id=c.id, user_id=learner.id, assess=visit)
        else:
            for _ in range(rng.randint(1, 3)):
                visit = reg + timedelta(days=rng.randint(1, max(2, (_TODAY - reg).days)))
                add_response("antenatal", "flat", {
                    "assessment_date": visit.isoformat(),
                    "current_weight": str(rng.randint(45, 72)),
                }, mother_id=m.id, user_id=learner.id, assess=visit)

        if rng.random() < 0.6:
            visit = reg + timedelta(days=rng.randint(1, max(2, (_TODAY - reg).days)))
            add_response("mother_protein_intake", "flow", {"pca_date": visit.isoformat()},
                         mother_id=m.id, user_id=learner.id, assess=visit)

    return ds
