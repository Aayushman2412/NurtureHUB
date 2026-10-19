"""Faltering cases, for the supervisors (review of 18 Oct 2026).

Sir: "I need a downloadable Excel option where I filter out the cases which
are only severe underweight or moderate underweight, or severe wasting or
moderate wasting, or severe stunting or moderate stunting, or faltering — if
any of these are there I want to download those cases specifically." And for
a trainer: "give me the list of faltering cases under me in a break-up of two
batch monitors — one sheet for batch monitor 1's faltering cases, the other
for batch monitor 2's." A separate page, one or two clicks to the whole list.

A case is listed when its baby's LATEST measured visit meets any of the
chosen conditions. The z-score grades are the analysts' (growth.Z_CATEGORY_NAMES:
moderate below −2, severe below −3); "faltering" is the raw-data files' rule
(rawdata/gen_masd.py) — the latest weight is lower than the one before it.
Real measurements only: the demo layer never reaches this list.
"""
from __future__ import annotations

from datetime import date
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from app import models

# (key, label, metric, grade index in Z_CATEGORY_NAMES) — the order of the
# filter chips and of the spreadsheet's "Why" column.
CONDITIONS = [
    ("suw", "Severe underweight (SUW)", "wfaz", 3),
    ("muw", "Moderate underweight (MUW)", "wfaz", 2),
    ("sam", "Severe wasting (SAM)", "wfhz", 3),
    ("mam", "Moderate wasting (MAM)", "wfhz", 2),
    ("sst", "Severe stunting", "hfaz", 3),
    ("mst", "Moderate stunting", "hfaz", 2),
    ("faltering", "Faltering (weight fell since the last visit)", None, None),
]
CONDITION_KEYS = [c[0] for c in CONDITIONS]
LABELS = {c[0]: c[1] for c in CONDITIONS}


def _measured(visits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [v for v in visits if v.get("weight")]


def _flags(row: Dict[str, Any], case: Dict[str, Any]) -> tuple[List[str], Optional[float]]:
    from app.routers.growth import Z_CATEGORY_NAMES

    flags: List[str] = []
    cats = row.get("categories") or {}
    for key, _label, metric, grade in CONDITIONS:
        if metric is None:
            continue
        if (cats.get(metric) or {}).get("lv") == Z_CATEGORY_NAMES[metric][grade]:
            flags.append(key)
    weighed = _measured(case["visits"])
    change = None
    if len(weighed) >= 2:
        change = round((weighed[-1]["weight"] - weighed[-2]["weight"]) * 1000)   # grams
        if change < 0:
            flags.append("faltering")
    return flags, change


def monitor_for(user_id: int, batch_monitor_id: Optional[int], is_batch_monitor: bool) -> Optional[int]:
    """Whose list a learner's cases fall under: her batch monitor's — and a
    batch monitor's own cases under her own name, since she is one of the
    batch she follows up ("the faltering cases under batch monitor 1")."""
    if batch_monitor_id:
        return batch_monitor_id
    return user_id if is_batch_monitor else None


def build(db: Session, district_slug: Optional[str]) -> Dict[str, Any]:
    """Every case in the project with at least one condition, plus who looks
    after it (learner, F2F batch, batch monitor) for the filters and sheets."""
    from app.routers.growth import _build_cases, _rules_context, _summary_rows

    cases = _build_cases(db, district_slug=district_slug or None)
    by_id = {c["child"]["id"]: c for c in cases}
    rows = _summary_rows(cases, _rules_context(db, cases), allow_mock=False)

    learner_ids = sorted({r["learner_id"] for r in rows if r.get("learner_id")})
    monitor_of: Dict[int, Optional[int]] = {}
    names: Dict[int, str] = {}
    # The learner's department, for the filter (review of 19 Oct 2026:
    # "department is one thing we require"): the department code, the text an
    # "Other" department was given, or the older free-text field.
    dept_of: Dict[int, Optional[str]] = {}
    for uid, name, email, monitor_id, is_monitor, code, other, legacy in (
            db.query(models.User.id, models.User.full_name, models.User.email,
                     models.User.batch_monitor_id, models.User.is_batch_monitor,
                     models.Department.code, models.User.department_other, models.User.department)
            .outerjoin(models.Department, models.User.department_id == models.Department.id)
            .filter(models.User.id.in_(learner_ids)) if learner_ids else []):
        monitor_of[uid] = monitor_for(uid, monitor_id, bool(is_monitor))
        names[uid] = name or email
        dept_of[uid] = (other or "Other") if code == "OTHER" else (code or other or legacy or None)
    monitor_ids = sorted({m for m in monitor_of.values() if m})
    for uid, name, email in (db.query(models.User.id, models.User.full_name, models.User.email)
                             .filter(models.User.id.in_(monitor_ids)) if monitor_ids else []):
        names[uid] = name or email
    batch_of: Dict[int, Optional[str]] = {
        uid: bname for uid, bname in (
            db.query(models.FaceToFaceSelection.user_id, models.MasdTrainingBatch.name)
            .outerjoin(models.MasdTrainingBatch, models.MasdTrainingBatch.id == models.FaceToFaceSelection.batch_id)
            .filter(models.FaceToFaceSelection.user_id.in_(learner_ids)) if learner_ids else [])
    }

    today = date.today()
    out: List[Dict[str, Any]] = []
    for row in rows:
        case = by_id.get(row["case_id"])
        if case is None:
            continue
        flags, change = _flags(row, case)
        if not flags:
            continue
        ids = row.get("ids") or {}
        weighed = _measured(case["visits"])
        last = weighed[-1] if weighed else None
        dob = date.fromisoformat(case["child"]["dob"]) if case["child"].get("dob") else None
        lid = row.get("learner_id")
        mid = monitor_of.get(lid) if lid else None
        out.append({
            "case_id": row["case_id"],
            "mother_id": case["mother"]["id"],
            "flags": flags,
            "learner": {"id": lid, "name": row["identity"]["learner_name"],
                        "cadre": ids.get("learner_cadre") or row["identity"].get("role_group"),
                        "block": ids.get("learner_block"), "mobile": ids.get("learner_mobile"),
                        "department": dept_of.get(lid) if lid else None},
            "batch": batch_of.get(lid) if lid else None,
            "monitor": {"id": mid, "name": names.get(mid)} if mid else None,
            "mother": {"name": row["identity"]["mother_name"], "uid": ids.get("mother_uid"),
                       "village": ids.get("case_village")},
            "child": {"name": case["child"].get("name"), "uid": case["child"].get("uid"),
                      "sex": row["meta"].get("sex"), "dob": case["child"].get("dob"),
                      "age_months": round((today - dob).days / 30.44, 1) if dob else None},
            "last_visit": last["date"] if last else None,
            "days_since_visit": (today - date.fromisoformat(last["date"])).days if last else None,
            "weight": last["weight"] if last else None,
            "length": last.get("length") if last else None,
            "weight_change_g": change,
            "z": {m: (row["outcomes"].get(m) or {}).get("lv") for m in ("wfaz", "hfaz", "wfhz")},
            "categories": {m: (row["categories"].get(m) or {}).get("lv") for m in ("wfaz", "hfaz", "wfhz")},
        })
    # The most serious first: severe grades, then moderate, then faltering only.
    rank = {k: i for i, k in enumerate(CONDITION_KEYS)}
    out.sort(key=lambda r: (min(rank[f] for f in r["flags"]), (r["monitor"] or {}).get("name") or "~",
                            r["learner"]["name"] or "", r["mother"]["name"] or ""))
    return {"rows": out, "conditions": [{"key": k, "label": lbl} for k, lbl, _m, _g in CONDITIONS]}


def apply_filters(rows: Iterable[Dict[str, Any]], *, conditions: Optional[List[str]] = None,
                  monitor_id: Optional[int] = None, no_monitor: bool = False, batch: Optional[str] = None,
                  block: Optional[str] = None, cadre: Optional[str] = None,
                  department: Optional[str] = None,
                  learner_id: Optional[int] = None) -> List[Dict[str, Any]]:
    keep = set(conditions or CONDITION_KEYS)
    out = []
    for r in rows:
        if not keep.intersection(r["flags"]):
            continue
        if no_monitor and r["monitor"]:
            continue
        if monitor_id and (r["monitor"] or {}).get("id") != monitor_id:
            continue
        if batch and r["batch"] != batch:
            continue
        if block and r["learner"]["block"] != block:
            continue
        if cadre and r["learner"]["cadre"] != cadre:
            continue
        if department and r["learner"].get("department") != department:
            continue
        if learner_id and r["learner"]["id"] != learner_id:
            continue
        out.append(r)
    return out


_COLUMNS = [
    ("Why listed", lambda r: "; ".join(LABELS[f] for f in r["flags"])),
    ("Batch monitor", lambda r: (r["monitor"] or {}).get("name") or "—"),
    ("F2F batch", lambda r: r["batch"] or "—"),
    ("Learner", lambda r: r["learner"]["name"]),
    ("Learner ID", lambda r: r["learner"]["id"]),
    ("Learner mobile", lambda r: r["learner"]["mobile"]),
    ("Cadre", lambda r: r["learner"]["cadre"]),
    ("Department", lambda r: r["learner"].get("department")),
    ("Block", lambda r: r["learner"]["block"]),
    ("Mother", lambda r: r["mother"]["name"]),
    ("Mother ID", lambda r: r["mother"]["uid"]),
    ("Village", lambda r: r["mother"]["village"]),
    ("Baby", lambda r: r["child"]["name"]),
    ("Baby ID", lambda r: r["child"]["uid"]),
    ("Sex", lambda r: {"boys": "Boy", "girls": "Girl"}.get(r["child"]["sex"] or "", "")),
    ("Age (months)", lambda r: r["child"]["age_months"]),
    ("Last measured", lambda r: r["last_visit"]),
    ("Days since", lambda r: r["days_since_visit"]),
    ("Weight (kg)", lambda r: r["weight"]),
    ("Weight change (g)", lambda r: r["weight_change_g"]),
    ("Length (cm)", lambda r: r["length"]),
    ("WAZ", lambda r: r["z"]["wfaz"]),
    ("HAZ", lambda r: r["z"]["hfaz"]),
    ("WHZ", lambda r: r["z"]["wfhz"]),
    ("Weight for age", lambda r: r["categories"]["wfaz"]),
    ("Length for age", lambda r: r["categories"]["hfaz"]),
    ("Weight for length", lambda r: r["categories"]["wfhz"]),
]


def _sheet_name(name: str, used: set[str]) -> str:
    bad = '[]:*?/\\'
    base = "".join("-" if ch in bad else ch for ch in name).strip()[:28] or "Sheet"
    title, n = base, 2
    while title.lower() in used:
        title = f"{base[:25]} ({n})"
        n += 1
    used.add(title.lower())
    return title


def xlsx(rows: List[Dict[str, Any]], *, project: Optional[str], conditions: List[str]) -> BytesIO:
    """All the listed cases on the first sheet, then one sheet per batch
    monitor with only their learners' cases (and one for learners without a
    monitor) — the break-up a trainer asks for."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    bold = Font(bold=True)
    head_fill = PatternFill("solid", fgColor="E8E0D8")
    severe_fill = PatternFill("solid", fgColor="F4C7C3")
    wrap = Alignment(wrap_text=True, vertical="top")

    def write(ws, items: List[Dict[str, Any]], title: str) -> None:
        ws.cell(row=1, column=1, value=title).font = Font(bold=True, size=12)
        ws.cell(row=2, column=1, value="Listed for: " + ", ".join(LABELS[c] for c in conditions)
                + f" · {len(items)} case(s) · as of {date.today().isoformat()}")
        for ci, (head, _get) in enumerate(_COLUMNS, start=1):
            cell = ws.cell(row=4, column=ci, value=head)
            cell.font = bold
            cell.fill = head_fill
            cell.alignment = wrap
        for ri, r in enumerate(items, start=5):
            severe = any(f in ("suw", "sam", "sst") for f in r["flags"])
            for ci, (_head, get) in enumerate(_COLUMNS, start=1):
                cell = ws.cell(row=ri, column=ci, value=get(r))
                if ci == 1 and severe:
                    cell.fill = severe_fill
        widths = [34, 22, 12, 22, 10, 14, 16, 16, 22, 16, 16, 18, 16, 6, 10, 12, 8, 10, 12, 10, 7, 7, 7, 24, 18, 22]
        for ci, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(ci)].width = w
        ws.freeze_panes = "B5"
        if items:
            ws.auto_filter.ref = f"A4:{get_column_letter(len(_COLUMNS))}{4 + len(items)}"

    wb = Workbook()
    used: set[str] = set()
    ws = wb.active
    ws.title = _sheet_name("All faltering cases", used)
    write(ws, rows, f"Faltering cases — {project or 'all projects'}")

    groups: Dict[Any, List[Dict[str, Any]]] = {}
    for r in rows:
        key = ((r["monitor"] or {}).get("id"), (r["monitor"] or {}).get("name"))
        groups.setdefault(key, []).append(r)
    for (mid, mname), items in sorted(groups.items(), key=lambda kv: (kv[0][0] is None, kv[0][1] or "")):
        label = f"Monitor - {mname}" if mid else "No batch monitor"
        write(wb.create_sheet(_sheet_name(label, used)), items,
              f"Faltering cases — batch monitor: {mname}" if mid else "Faltering cases — learners without a batch monitor")
    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer
