"""<Code> <District>_<Mon-DD-YYYY>_MASD.csv — one row per learner (health worker)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from app.who_growth import zscore_for_value

from .common import NULL, Dataset, ResponseView, s

FILE_STEM = "MASD"

HEADER = [
    "User Account ID", "User Reg ID", "User Name", "Email", "Mobile", "Role",
    "Facilities", "Location", "Antenatal care", "Mother's Protein Intake",
    "Check growth", "Check BF", "Check CF", "Total Active Cases",
    "Total Child Cases", "Breastfeeding Scoring", "SAM", "MAM",
    "Mild Malnutrition", "SUW", "MUW", "Mild Underweight", "Severe Stunting",
    "Moderate Stunting", "Mild Stunting", "Tag", "Faltering", "Pre-Pregnancy",
    "First Trimester", "Second Trimester", "Third Trimester",
    "At time of delivery", "PNC LTE 5 Months", "PNC GTE 5 Months",
    "No Activity Days", "Training Batch",
    "Number of Cases for a HCW that earned LESS THAN 4 stars",
    "Number of Cases for a HCW that earned 4 or MORE stars",
]

_FORM_COLS = [
    ("Antenatal care", "antenatal"),
    ("Mother's Protein Intake", "mother_protein_intake"),
    ("Check growth", "growth_monitoring"),
    ("Check BF", "breastfeeding"),
    ("Check CF", "complementary_feeding"),
]


def _f(text) -> Optional[float]:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def generate(ds: Dataset) -> list[list[str]]:
    today = date.today()

    # Submitted-response counts per (user, form_key) + last activity timestamp.
    counts: dict[tuple[int, str], int] = {}
    last_activity: dict[int, datetime] = {}
    for key, resps in ds.responses.items():
        for r in resps:
            uid = r.submitted_by_user_id
            if not uid:
                continue
            if r.status == "submitted":
                counts[(uid, key)] = counts.get((uid, key), 0) + 1
            if r.created_at:
                prev = last_activity.get(uid)
                if prev is None or r.created_at > prev:
                    last_activity[uid] = r.created_at

    # Latest growth metrics per child (nutrition-state counts + faltering).
    growth_by_child: dict[int, list] = {}
    for r in ds.responses.get("growth_monitoring", []):
        if r.child_id and r.status == "submitted":
            growth_by_child.setdefault(r.child_id, []).append(r)
    for visits in growth_by_child.values():
        visits.sort(key=lambda r: r.assessment_date or date.min)

    def child_zs(child) -> tuple:
        """(wfa_z, lfa_z, wfl_z, faltering) from the child's latest visit."""
        visits = growth_by_child.get(child.id) or []
        if not visits:
            return None, None, None, False
        latest = visits[-1]
        view = ResponseView(latest)
        weight = _f(view.value("baby_weight"))
        length = _f(view.value("baby_length"))
        g = (child.gender or "").lower()
        sex = "boys" if g.startswith("m") else "girls" if g.startswith("f") else ""
        wz = hz = whz = None
        if sex and child.dob and latest.assessment_date:
            age = (latest.assessment_date - child.dob).days
            if age >= 0:
                wz = zscore_for_value("wfa", sex, age, weight)
                hz = zscore_for_value("lfa", sex, age, length)
        if sex and length is not None:
            whz = zscore_for_value("wfl", sex, length, weight)
        faltering = False
        if len(visits) >= 2:
            w_prev = _f(ResponseView(visits[-2]).value("baby_weight"))
            if weight is not None and w_prev is not None and weight < w_prev:
                faltering = True
        return wz, hz, whz, faltering

    # Learner registration responses (User Reg ID), keyed by user.
    reg_by_user: dict[int, ResponseView] = {}
    for r in ds.responses.get("learner_registration", []):
        if r.submitted_by_user_id:
            reg_by_user[r.submitted_by_user_id] = ResponseView(r)

    rows: list[list[str]] = []
    for u in ds.learners:
        mothers = [m for m in ds.mothers if m.registered_by_user_id == u.id]
        kids = [c for m in mothers for c in ds.children_by_mother.get(m.id, [])]

        buckets = {k: 0 for k in ("SAM", "MAM", "MildMal", "SUW", "MUW", "MildUW",
                                  "SevSt", "ModSt", "MildSt")}
        faltering_count = 0
        for c in kids:
            wz, hz, whz, faltering = child_zs(c)
            if faltering:
                faltering_count += 1
            if whz is not None:
                if whz < -3: buckets["SAM"] += 1
                elif whz < -2: buckets["MAM"] += 1
                elif whz < -1: buckets["MildMal"] += 1
            if wz is not None:
                if wz < -3: buckets["SUW"] += 1
                elif wz < -2: buckets["MUW"] += 1
                elif wz < -1: buckets["MildUW"] += 1
            if hz is not None:
                if hz < -3: buckets["SevSt"] += 1
                elif hz < -2: buckets["ModSt"] += 1
                elif hz < -1: buckets["MildSt"] += 1

        stage = {k: 0 for k in ("pre", "t1", "t2", "t3", "atd", "pnc_lte", "pnc_gte")}
        for m in mothers:
            m_kids = ds.children_by_mother.get(m.id, [])
            youngest_dob = max((c.dob for c in m_kids if c.dob), default=None)
            if youngest_dob:
                age_days = (today - youngest_dob).days
                stage["pnc_lte" if age_days <= 150 else "pnc_gte"] += 1
                continue
            if not m.lmp:
                stage["pre"] += 1
                continue
            weeks = (today - m.lmp).days // 7
            if weeks <= 12: stage["t1"] += 1
            elif weeks <= 27: stage["t2"] += 1
            elif weeks < 37: stage["t3"] += 1
            elif weeks <= 45: stage["atd"] += 1
            else: stage["pre"] += 1

        # Star proxy: distinct activity types recorded among the user's cases.
        stars_low = stars_high = 0
        for m in mothers:
            m_child_ids = {c.id for c in ds.children_by_mother.get(m.id, [])}
            activity_types = set()
            for key, resps in ds.responses.items():
                for r in resps:
                    if r.status != "submitted":
                        continue
                    if (r.mother_id == m.id) or (r.child_id in m_child_ids):
                        activity_types.add(key)
            if len(activity_types) >= 4:
                stars_high += 1
            else:
                stars_low += 1

        last = last_activity.get(u.id)
        for m in mothers:
            if m.created_at and (last is None or m.created_at > last):
                last = m.created_at
        no_activity = str((today - last.date()).days) if last else NULL

        facility = (ds.facility_names.get(u.facility_id) if u.facility_id else None) or u.work_center_name
        reg = reg_by_user.get(u.id)

        rows.append([
            s(u.id),
            reg.value("learner_id") if reg else NULL,
            s(u.full_name),
            s(u.email),
            s(u.phone),
            s((ds.designation_names.get(u.designation_id) if getattr(u, "designation_id", None) else None) or u.role),
            s(facility),
            s(ds.block_names.get(getattr(u, "block_id", None)) if getattr(u, "block_id", None) else None),
            *[str(counts.get((u.id, key), 0)) for _col, key in _FORM_COLS],
            str(len(mothers)),
            str(len(kids)),
            "0",
            str(buckets["SAM"]), str(buckets["MAM"]), str(buckets["MildMal"]),
            str(buckets["SUW"]), str(buckets["MUW"]), str(buckets["MildUW"]),
            str(buckets["SevSt"]), str(buckets["ModSt"]), str(buckets["MildSt"]),
            "Other",
            str(faltering_count),
            str(stage["pre"]), str(stage["t1"]), str(stage["t2"]), str(stage["t3"]),
            str(stage["atd"]), str(stage["pnc_lte"]), str(stage["pnc_gte"]),
            no_activity,
            # NurtureHUB has no training-batch entity, but the colour-coded
            # MASD stage DROPS rows whose Training Batch is blank — a literal
            # NULL would erase every learner from those workbooks. Emit a
            # deterministic placeholder batch instead until batches are
            # modelled ("Batch 1 (<join date>), <district>").
            (f"Batch 1 ({u.created_at:%b %d, %Y}), {ds.district}"
             if getattr(u, "created_at", None) else f"Batch 1, {ds.district}"),
            str(stars_low),
            str(stars_high),
        ])
    return rows
