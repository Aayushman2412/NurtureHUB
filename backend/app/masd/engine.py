"""The MASD analysis: from a project's learners, adoptions and activities to
every number in the district report.

Pure: `compute(data, as_of)` takes plain records (see `MasdData`) and returns a
JSON-ready dict — no database, no clock. The same function runs for "now" and
for the comparison date, so "then vs now" is two calls with two dates, and the
dashboard, the PowerPoint and the Excel download can never disagree.

Two halves, as in the report:
  * activity — adoption target fulfilment and the share of EXPECTED activity
    done by every F2F-trained learner (against the targets in force, and within
    their own cases), by block, cadre, department, adoption type and subtype,
    plus the pregnancies that need following up;
  * outcomes — the mother-child dyads that survive the data-quality checks,
    and how stunting / underweight / wasting moved from birth (BV) through the
    adoption visit (AV) to the last visit (LV), against the NFHS benchmarks.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.masd import rules as R
from app.who_growth import zscore_for_value

# ── Inputs ─────────────────────────────────────────────────────────────────


@dataclass
class LearnerIn:
    id: int
    name: str
    email: str = ""
    role: Optional[str] = None           # designation / legacy role string
    block: Optional[str] = None
    f2f: bool = False                    # selected for face-to-face training
    trainer_role: Optional[str] = None   # "master_trainer" | "facilitator" | None
    department: Optional[str] = None     # department code (WCD / HFW / OTHER)
    batch_id: Optional[int] = None       # F2F training batch
    training_end: Optional[date] = None  # the batch's last training day
    mobile: Optional[str] = None         # shown to admins beside the name
    is_monitor: bool = False             # tagged a batch monitor
    monitor_id: Optional[int] = None     # the batch monitor watching this learner
    # For splitting and describing learners (review of 6–7 Oct 2026).
    district: Optional[str] = None       # the district project they belong to
    education: Optional[str] = None      # highest qualification
    experience: Optional[str] = None     # years-of-service band
    experience_order: int = 99


@dataclass
class MotherIn:
    id: int
    learner_id: Optional[int]
    adoption_date: Optional[date] = None
    lmp: Optional[date] = None
    created_on: Optional[date] = None
    age: Optional[int] = None
    ration_card: Optional[str] = None
    social_category: Optional[str] = None
    uid: Optional[str] = None             # the record ID (never the name)
    education: Optional[str] = None
    declared_type: Optional[str] = None   # adoption type the learner chose at registration


@dataclass
class ChildIn:
    id: int
    mother_id: int
    dob: Optional[date] = None
    adoption_date: Optional[date] = None
    gender: Optional[str] = None
    birth_weight: Optional[float] = None
    birth_length: Optional[float] = None
    delivery_place: Optional[str] = None
    delivery_method: Optional[str] = None


@dataclass
class ActivityIn:
    form_key: str
    learner_id: Optional[int]
    on: date                              # assessment date
    mother_id: Optional[int] = None
    child_id: Optional[int] = None


@dataclass
class GrowthIn:
    child_id: int
    on: date
    weight: Optional[float] = None
    length: Optional[float] = None


@dataclass
class MasdData:
    project: Dict[str, Any]
    learners: List[LearnerIn]
    mothers: List[MotherIn]
    children: List[ChildIn]
    activities: List[ActivityIn]
    growth: List[GrowthIn]
    training_date: Optional[date] = None
    tranche2_start: Optional[date] = None
    benchmarks: Optional[Dict[str, Any]] = None
    calendar_saved: bool = False
    batches: List[Dict[str, Any]] = field(default_factory=list)   # {id, name, end_date}
    targets: Optional[List[Dict[str, Any]]] = None                 # saved steps; None = default
    expected_forms: Dict[str, Any] = field(default_factory=R.default_expected_forms)
    expected_forms_default: bool = True


# ── Small helpers ──────────────────────────────────────────────────────────


def _pct(num: float, den: float, digits: int = 1) -> Optional[float]:
    return round(100.0 * num / den, digits) if den else None


def _avg(values: Iterable[float], digits: int = 1) -> Optional[float]:
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), digits) if vals else None


def _quartiles(values: Iterable[float]) -> Dict[str, Optional[float]]:
    """Median and interquartile range (25th, 75th percentiles, linear) — what
    the review of 7 Oct 2026 asked for wherever an average would hide a skew
    (days since the last activity, days to adopt)."""
    vals = sorted(values)
    if not vals:
        return {"median": None, "q1": None, "q3": None, "n": 0}

    def at(q: float) -> float:
        pos = (len(vals) - 1) * q
        lo, hi = int(pos), min(int(pos) + 1, len(vals) - 1)
        return round(vals[lo] + (vals[hi] - vals[lo]) * (pos - lo), 1)

    return {"median": at(0.5), "q1": at(0.25), "q3": at(0.75), "n": len(vals)}


def _sex(gender: Optional[str]) -> Optional[str]:
    g = (gender or "").strip().lower()
    if g in ("male", "boy", "boys", "m"):
        return "boys"
    if g in ("female", "girl", "girls", "f"):
        return "girls"
    return None


def _z(indicator: str, sex: Optional[str], age_days: Optional[int],
       weight: Optional[float], length: Optional[float]) -> Optional[float]:
    """One z-score: wfa / hfa (length-for-age) / wfh (weight-for-length)."""
    if not sex:
        return None
    if indicator == "wfa":
        if age_days is None or age_days < 0 or weight is None:
            return None
        return zscore_for_value("wfa", sex, age_days, weight)
    if indicator == "hfa":
        if age_days is None or age_days < 0 or length is None:
            return None
        return zscore_for_value("lfa", sex, age_days, length)
    if length is None or weight is None:
        return None
    return zscore_for_value("wfl", sex, length, weight)


# ── Calendar ───────────────────────────────────────────────────────────────


def calendar(data: MasdData) -> Dict[str, Any]:
    """The project's training date and tranche-2 start — saved, or inferred
    from the first adoption made by an F2F learner when the analysts have not
    set them yet (the dashboard says which)."""
    training, tranche2 = data.training_date, data.tranche2_start
    inferred = False
    if training is None:
        f2f = {l.id for l in data.learners if l.f2f}
        firsts = [m.adoption_date or m.created_on for m in data.mothers
                  if m.learner_id in f2f and (m.adoption_date or m.created_on)]
        training = min(firsts) if firsts else None
        inferred = training is not None
    if tranche2 is None and training is not None:
        tranche2 = training + timedelta(days=R.DEFAULT_TRANCHE2_OFFSET_DAYS)
        inferred = True
    return {"training_date": training, "tranche2_start": tranche2, "inferred": inferred}


# ── Adoptions ──────────────────────────────────────────────────────────────


@dataclass
class Adoption:
    mother: MotherIn
    children: List[ChildIn]
    anchor: Optional[date]          # the adoption date
    type: str
    tranche: int                    # the target step in force on that date (1-based)
    age_at_adoption: Optional[int]  # the child's, for PNC adoptions


def classify(mother: MotherIn, children: List[ChildIn]) -> Tuple[str, Optional[int]]:
    """ANC if the mother was adopted before any of her children was born (or has
    no child yet but a pregnancy date); otherwise PNC, split at 5 months by the
    child's age on the day of adoption."""
    anchor = mother.adoption_date or mother.created_on
    born = sorted((c for c in children if c.dob), key=lambda c: c.dob)
    if born and anchor is not None and born[0].dob <= anchor:
        child = born[0]
        adopted = child.adoption_date if (child.adoption_date and child.adoption_date >= child.dob) else anchor
        age = (adopted - child.dob).days
        return (R.PNC_LT5 if age < R.FIVE_MONTHS_DAYS else R.PNC_GE5), age
    if born or mother.lmp:
        return R.ANC, None
    return R.UNKNOWN, None


def adoptions_of(data: MasdData, steps: List[Dict[str, Any]], as_of: date) -> List[Adoption]:
    kids: Dict[int, List[ChildIn]] = defaultdict(list)
    for c in data.children:
        kids[c.mother_id].append(c)
    opens = sorted(date.fromisoformat(s["from"]) for s in steps if s.get("from"))
    out: List[Adoption] = []
    for m in data.mothers:
        anchor = m.adoption_date or m.created_on
        if anchor is None or anchor > as_of:
            continue
        mine = kids.get(m.id, [])
        atype, age = classify(m, mine)
        tranche = max(1, sum(1 for d in opens if d <= anchor))
        out.append(Adoption(m, mine, anchor, atype, tranche, age))
    return out


# ── Activity half ──────────────────────────────────────────────────────────


DEPARTMENT_LABELS = {"WCD": "WCD", "HFW": "HFW", "OTHER": "Other"}
DEPARTMENT_ORDER = ["WCD", "HFW", "Other"]


def _department(l: LearnerIn, group: str) -> str:
    """The learner's own department; the cadre's when they have not set one."""
    code = (l.department or "").upper()
    return DEPARTMENT_LABELS.get(code) or R.ROLE_GROUP_DEPARTMENT.get(group, R.HFW)


@dataclass
class _Index:
    """Which adoption (case) each activity was filed on."""
    by_mother: Dict[int, Adoption]
    mother_of_child: Dict[int, int]

    def adoption_of(self, act: ActivityIn) -> Optional[Adoption]:
        mid = act.mother_id if act.mother_id is not None else self.mother_of_child.get(act.child_id or -1)
        return self.by_mother.get(mid) if mid is not None else None


def _index(adoptions: List[Adoption]) -> _Index:
    return _Index({a.mother.id: a for a in adoptions},
                  {c.id: a.mother.id for a in adoptions for c in a.children})


def _bucket(atype: str, is_nurse: bool) -> Optional[str]:
    """The adoption-type column an adoption counts under: a Staff Nurse's
    hospital cases are all PNC<5M."""
    if atype == R.UNKNOWN:
        return None
    return R.PNC_LT5 if (is_nurse and atype in (R.PNC_LT5, R.PNC_GE5)) else atype


def case_expected_for(a: Adoption, table: Dict[str, Any], as_of: date, is_nurse: bool) -> Dict[str, int]:
    """One adoption's expected forms from its own follow-up: the pregnancy
    once, and every baby born by `as_of` (twins are two babies)."""
    born = sorted((c for c in a.children if c.dob and c.dob <= as_of), key=lambda c: c.dob)
    total = {k: 0 for k in R.ACTIVITY_KEYS}
    for i, c in enumerate(born or [None]):
        e = R.case_expected(table, mother_adopted=a.anchor, lmp=a.mother.lmp,
                            dob=c.dob if c else None, baby_adopted=c.adoption_date if c else None,
                            end=as_of, is_nurse=is_nurse)
        for k in R.ACTIVITY_KEYS:
            if i and k in ("anc", "protein"):
                continue          # one pregnancy, however many babies
            total[k] += e[k]
    return total


def _tranche_expected(table: Dict[str, Any], tranche: Dict[str, Any], is_nurse: bool) -> Dict[str, Any]:
    """The forms one tranche's adoptions are expected to have generated: the
    adoptions it added × the table at the tranche's own follow-up."""
    lt = R.learner_targets(tranche["added"], is_nurse)
    by_type = {}
    for t in R.ADOPTION_TYPES:
        if not lt[t]:
            continue
        per = R.expected_at(table, R.row_type(t, is_nurse), tranche["fu_days"])
        by_type[t] = {"adoptions": lt[t], "per_adoption": per, "forms": {k: lt[t] * v for k, v in per.items()}}
    forms = {k: sum(v["forms"].get(k, 0) for v in by_type.values()) for k in R.ACTIVITY_KEYS}
    return {"by_type": by_type, "forms": forms, "total": sum(forms.values())}


def _sum_expected(parts: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_type: Dict[str, Dict[str, Any]] = {}
    for part in parts:
        for t, v in part["by_type"].items():
            acc = by_type.setdefault(t, {"adoptions": 0, "forms": {}})
            acc["adoptions"] += v["adoptions"]
            for k, n in v["forms"].items():
                acc["forms"][k] = acc["forms"].get(k, 0) + n
    forms = {k: sum(v["forms"].get(k, 0) for v in by_type.values()) for k in R.ACTIVITY_KEYS}
    return {"by_type": by_type, "forms": forms, "total": sum(forms.values())}


def expected_per_learner(table: Dict[str, Any], tranches: List[Dict[str, Any]]) -> Dict[str, Any]:
    """What one learner is expected to have done by now, tranche by tranche
    and in all — the worked example on the dashboard and in the deck."""
    out: Dict[str, Any] = {"tranches": []}
    per = {name: [_tranche_expected(table, tr, is_nurse) for tr in tranches]
           for is_nurse, name in ((False, "community"), (True, "nurse"))}
    for i, tr in enumerate(tranches):
        out["tranches"].append({**tr, "community": per["community"][i], "nurse": per["nurse"][i]})
    for name, parts in per.items():
        out[name] = _sum_expected(parts)
    return out


def _learner_rows(data: MasdData, adoptions: List[Adoption], acts: List[ActivityIn], as_of: date,
                  cal: Dict[str, Any], steps: List[Dict[str, Any]], targets_now: Dict[str, int],
                  table: Dict[str, Any], idx: _Index) -> List[Dict[str, Any]]:
    by_learner_adopt: Dict[int, List[Adoption]] = defaultdict(list)
    for a in adoptions:
        if a.mother.learner_id is not None:
            by_learner_adopt[a.mother.learner_id].append(a)
    nurse_ids = {l.id for l in data.learners if R.role_group(l.role) == R.NURSING_STAFF}
    counts: Dict[int, Counter] = defaultdict(Counter)     # learner → activity
    own: Dict[int, Counter] = defaultdict(Counter)        # … on the learner's own cases
    typed: Dict[int, Counter] = defaultdict(Counter)      # … by (adoption type, activity)
    last_seen: Dict[int, date] = {}
    first_seen: Dict[int, date] = {}
    for act in acts:
        key = R.FORM_TO_ACTIVITY.get(act.form_key)
        if key is None or act.learner_id is None:
            continue
        counts[act.learner_id][key] += 1
        if act.on > last_seen.get(act.learner_id, date.min):
            last_seen[act.learner_id] = act.on
        if act.on < first_seen.get(act.learner_id, date.max):
            first_seen[act.learner_id] = act.on
        a = idx.adoption_of(act)
        if a is not None and a.mother.learner_id == act.learner_id:
            own[act.learner_id][key] += 1
            bucket = _bucket(a.type, act.learner_id in nurse_ids)
            if bucket:
                typed[act.learner_id][(bucket, key)] += 1
    for a in adoptions:   # registering a mother is activity too
        lid = a.mother.learner_id
        if lid is not None and a.anchor and a.anchor > last_seen.get(lid, date.min):
            last_seen[lid] = a.anchor

    batch_names = {b["id"]: b["name"] for b in data.batches}
    rows = []
    for l in data.learners:
        group = R.role_group(l.role)
        is_nurse = group == R.NURSING_STAFF
        mine = by_learner_adopt.get(l.id, [])
        mix = Counter(_bucket(a.type, is_nurse) or R.UNKNOWN for a in mine)
        training_end = l.training_end or cal["training_date"]
        trs = R.tranches(steps, as_of, training_end)
        lt = R.learner_targets(targets_now, is_nurse)

        # Each tranche's adoptions are read at that tranche's own follow-up.
        ideal = {k: 0 for k in R.ACTIVITY_KEYS}
        exp_type = {t: 0 for t in R.ADOPTION_TYPES}
        exp_tk: Dict[Tuple[str, str], int] = defaultdict(int)
        for tr in trs:
            added = R.learner_targets(tr["added"], is_nurse)
            for t in R.ADOPTION_TYPES:
                for k, v in R.expected_at(table, R.row_type(t, is_nurse), tr["fu_days"]).items():
                    ideal[k] += added[t] * v
                    exp_type[t] += added[t] * v
                    exp_tk[(t, k)] += added[t] * v

        # Level 2 (review of 6 Oct 2026): what the adoptions this learner
        # actually took should have produced by now — not the target. Each
        # adoption is read at the follow-up of the tranche it fills (they fill
        # the tranches in order, per type, as in the uptake); any beyond every
        # target count with the latest tranche open.
        undertaken = {k: 0 for k in R.ACTIVITY_KEYS}
        open_trs = [tr for tr in trs if tr["fu_days"] is not None]
        for t in R.ADOPTION_TYPES:
            slots: List[Dict[str, Any]] = []
            for tr in trs:
                slots += [tr] * R.learner_targets(tr["added"], is_nurse)[t]
            for j in range(mix.get(t, 0)):
                tr = slots[j] if j < len(slots) else (open_trs[-1] if open_trs else None)
                if tr is None:
                    continue
                for k, v in R.expected_at(table, R.row_type(t, is_nurse), tr["fu_days"]).items():
                    undertaken[k] += v
        by_type: Dict[str, Dict[str, Any]] = {}
        for t in R.ADOPTION_TYPES:
            keys = {k for rt, k in R.EXPECTED_ROWS if rt == R.row_type(t, is_nurse)}
            actual = sum(typed[l.id][(t, k)] for k in keys)
            adopted = mix.get(t, 0)
            by_type[t] = {"target": lt[t], "adopted": adopted, "adoption_pct": _pct(adopted, lt[t]),
                          "expected": exp_type[t], "actual": actual, "activity_pct": _pct(actual, exp_type[t]),
                          # Per activity, for the visit-vs-intervention bubble charts.
                          "expected_by": {k: exp_tk.get((t, k), 0) for k in sorted(keys)},
                          "actual_by": {k: typed[l.id][(t, k)] for k in sorted(keys)}}

        own_exp = {k: 0 for k in R.ACTIVITY_KEYS}
        for a in mine:
            for k, v in case_expected_for(a, table, as_of, is_nurse).items():
                own_exp[k] += v
        own_act = {k: own[l.id][k] for k in R.ACTIVITY_KEYS}
        own_exp_total, own_act_total = sum(own_exp.values()), sum(own_act.values())

        target = sum(lt.values())
        acts_by = {k: counts[l.id][k] for k in R.ACTIVITY_KEYS}
        total_acts = sum(acts_by.values())
        ideal_total = sum(ideal.values())
        last = last_seen.get(l.id)
        rows.append({
            "id": l.id,
            "name": l.name,
            "email": l.email,
            "role": l.role,
            "role_group": group,
            "department": _department(l, group),
            "block": l.block or "Not assigned",
            "f2f": l.f2f,
            "trainer_role": l.trainer_role,
            "mtfl": bool(l.trainer_role),
            "mobile": l.mobile,
            "district": l.district,
            "education": l.education,
            "experience": l.experience,
            "experience_order": l.experience_order,
            "is_monitor": l.is_monitor,
            "declared_mismatch": 0,
            "monitor_id": l.monitor_id,
            "is_nurse": is_nurse,
            "batch_id": l.batch_id,
            "batch": batch_names.get(l.batch_id) if l.batch_id else None,
            "training_end": training_end.isoformat() if training_end else None,
            # The first tranche's follow-up — the learner's time in the field —
            # and every tranche's, as the expected forms were counted.
            "fu_raw": trs[0]["fu_raw"] if trs else None,
            "fu_days": trs[0]["fu_days"] if trs else None,
            "tranche_fu": [tr["fu_days"] for tr in trs],
            "adoptions": {
                "anc": mix.get(R.ANC, 0), "pnc_lt5": mix.get(R.PNC_LT5, 0),
                "pnc_ge5": mix.get(R.PNC_GE5, 0), "unknown": mix.get(R.UNKNOWN, 0),
                "total": len(mine),
            },
            "targets": {**lt, "total": target},
            "target": target,
            "fulfilment_pct": _pct(len(mine), target),
            "activities": {**acts_by, "total": total_acts},
            "ideal": {**ideal, "total": ideal_total},
            "intensity_pct": _pct(total_acts, ideal_total),
            "subtype_pct": {k: _pct(acts_by[k], ideal[k]) for k in R.ACTIVITY_KEYS},
            "by_type": by_type,
            "undertaken": {
                "expected": {**undertaken, "total": sum(undertaken.values())},
                "actual": own_act_total,
                "pct": _pct(own_act_total, sum(undertaken.values())),
            },
            "own": {
                "expected": {**own_exp, "total": own_exp_total},
                "actual": {**own_act, "total": own_act_total},
                "pct": _pct(own_act_total, own_exp_total),
                "band": R.own_band(own_act_total, own_exp_total) if mine else None,
            },
            "last_activity": last.isoformat() if last else None,
            "first_activity": first_seen[l.id].isoformat() if l.id in first_seen else None,
            "nil_days": (as_of - last).days if last else None,
            "avg_per_adoption": round(total_acts / len(mine), 1) if mine else None,
        })
    return rows


def _aggregate(rows: List[Dict[str, Any]], key: str, label: str) -> Dict[str, Any]:
    adoptions = sum(r["adoptions"]["total"] for r in rows)
    target = sum(r["target"] for r in rows)
    acts = sum(r["activities"]["total"] for r in rows)
    ideal = sum(r["ideal"]["total"] for r in rows)
    sub_acts = {k: sum(r["activities"][k] for r in rows) for k in R.ACTIVITY_KEYS}
    sub_ideal = {k: sum(r["ideal"][k] for r in rows) for k in R.ACTIVITY_KEYS}
    nil = [r["nil_days"] for r in rows if r["nil_days"] is not None]
    by_type = {}
    for t in R.ADOPTION_TYPES:
        tg = sum(r["by_type"][t]["target"] for r in rows)
        ad = sum(r["by_type"][t]["adopted"] for r in rows)
        ex = sum(r["by_type"][t]["expected"] for r in rows)
        ac = sum(r["by_type"][t]["actual"] for r in rows)
        by_type[t] = {"target": tg, "adopted": ad, "adoption_pct": _pct(ad, tg),
                      "expected": ex, "actual": ac, "activity_pct": _pct(ac, ex)}
    own_exp = sum(r["own"]["expected"]["total"] for r in rows)
    own_act = sum(r["own"]["actual"]["total"] for r in rows)
    und_exp = sum(r["undertaken"]["expected"]["total"] for r in rows)
    und_act = sum(r["undertaken"]["actual"] for r in rows)
    nil_q = _quartiles(nil)
    bands = Counter(r["own"]["band"] for r in rows if r["own"]["band"])
    return {
        "key": key,
        "label": label,
        "learners": len(rows),
        "nurses": sum(1 for r in rows if r["is_nurse"]),
        "mtfl": sum(1 for r in rows if r["mtfl"]),
        "adoptions": adoptions,
        "mix": {t: sum(r["adoptions"][t] for r in rows) for t in ("anc", "pnc_lt5", "pnc_ge5", "unknown")},
        "target": target,
        "fulfilment_pct": _pct(adoptions, target),
        "activities": acts,
        "ideal": ideal,
        "intensity_pct": _pct(acts, ideal),
        "subtype_actual": sub_acts,
        "subtype_ideal": sub_ideal,
        "subtype_pct": {k: _pct(sub_acts[k], sub_ideal[k]) for k in R.ACTIVITY_KEYS},
        "by_type": by_type,
        "own_expected": own_exp,
        "own_actual": own_act,
        "own_pct": _pct(own_act, own_exp),
        "own_bands": {k: bands.get(k, 0) for k in R.OWN_BAND_KEYS},
        "own_banded": sum(bands.values()),
        "fu_days_avg": _avg([r["fu_days"] for r in rows if r["fu_days"] is not None]),
        "nil_days_avg": _avg(nil),
        "nil_days_median": nil_q["median"],
        "nil_days_q1": nil_q["q1"],
        "nil_days_q3": nil_q["q3"],
        "undertaken_expected": und_exp,
        "undertaken_actual": und_act,
        "undertaken_pct": _pct(und_act, und_exp),
        "no_activity": sum(1 for r in rows if r["activities"]["total"] == 0),
        "zero_adoptions": sum(1 for r in rows if r["adoptions"]["total"] == 0),
        # Mutually exclusive (review of 6 Oct 2026): adopted, but not one form since.
        "adopted_no_activity": sum(1 for r in rows if r["adoptions"]["total"] > 0 and r["activities"]["total"] == 0),
    }


def _group_by(rows: List[Dict[str, Any]], field: str, order: Optional[Iterable[str]] = None) -> List[Dict[str, Any]]:
    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        groups[r[field]].append(r)
    keys = [k for k in (order or []) if k in groups] + sorted(k for k in groups if k not in set(order or []))
    return [_aggregate(groups[k], k, k) for k in keys]


def _weekly(acts: List[ActivityIn], adoptions: List[Adoption], f2f_ids: set,
            start: Optional[date], as_of: date) -> List[Dict[str, Any]]:
    """Activities and new adoptions per week (Monday-start) since training."""
    if start is None:
        return []
    first_week = start - timedelta(days=start.weekday())
    weeks: Dict[date, Dict[str, Any]] = {}
    d = first_week
    while d <= as_of:
        weeks[d] = {"week": d.isoformat(), "adoptions": 0, **{k: 0 for k in R.ACTIVITY_KEYS}}
        d += timedelta(days=7)
    for act in acts:
        if act.learner_id not in f2f_ids or act.on < first_week:
            continue
        key = R.FORM_TO_ACTIVITY.get(act.form_key)
        wk = act.on - timedelta(days=act.on.weekday())
        if key and wk in weeks:
            weeks[wk][key] += 1
    for a in adoptions:
        if a.mother.learner_id in f2f_ids and a.anchor and a.anchor >= first_week:
            wk = a.anchor - timedelta(days=a.anchor.weekday())
            if wk in weeks:
                weeks[wk]["adoptions"] += 1
    out = list(weeks.values())
    for w in out:
        w["total"] = sum(w[k] for k in R.ACTIVITY_KEYS)
    return out


def _monitors(rows: List[Dict[str, Any]], attention: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Each batch monitor and the learners they answer for (review of 5 Oct
    2026): how many, how many are on track, and which ones need a call this
    week — "these many are doing well; these two or three are yours to chase"."""
    by_id = {r["id"]: r for r in rows}
    need = {a["id"]: a for a in attention}
    out = []
    for m in (r for r in rows if r["is_monitor"]):
        mine = [r for r in rows if r["monitor_id"] == m["id"]]
        calls = [need[r["id"]] for r in mine if r["id"] in need]
        own = [r["own"]["pct"] for r in mine if r["own"]["pct"] is not None]
        out.append({
            "id": m["id"], "name": m["name"], "block": m["block"], "role_group": m["role_group"],
            "learners": len(mine),
            "on_track": len(mine) - len(calls),
            "need_call": len(calls),
            "own_pct": round(sum(own) / len(own), 1) if own else None,
            "adoptions": sum(r["adoptions"]["total"] for r in mine),
            "calls": calls,
        })
    out.sort(key=lambda x: (-x["need_call"], x["name"] or ""))
    for r in rows:
        mon = by_id.get(r["monitor_id"]) if r["monitor_id"] else None
        r["monitor"] = mon["name"] if mon else None
    return {
        "monitors": out,
        "f2f_without_monitor": sum(1 for r in rows if r["f2f"] and not r["monitor_id"] and not r["is_monitor"]),
    }


def _attention(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """F2F learners a supervisor should call this week, worst first."""
    out = []
    for r in rows:
        reasons = []
        if r["activities"]["total"] == 0:
            reasons.append("no_activity")
        elif r["nil_days"] is not None and r["nil_days"] >= 14:
            reasons.append("inactive")
        if r["activities"]["total"] and (r["intensity_pct"] or 0) < 40:
            reasons.append("low_intensity")
        if (r["fulfilment_pct"] or 0) < 50:
            reasons.append("few_adoptions")
        if reasons:
            # Never started outranks gone quiet, which outranks slow; within a
            # reason, the longer the silence the higher.
            severity = (5 if "no_activity" in reasons else 0) + (2 if "inactive" in reasons else 0) \
                + len(reasons) + min(r["nil_days"] or 0, 99) / 100
            out.append({
                "id": r["id"], "name": r["name"], "block": r["block"], "role_group": r["role_group"],
                "adoptions": r["adoptions"]["total"], "fulfilment_pct": r["fulfilment_pct"],
                "intensity_pct": r["intensity_pct"], "nil_days": r["nil_days"],
                "reasons": reasons, "_severity": severity,
            })
    out.sort(key=lambda x: -x["_severity"])
    for x in out:
        x.pop("_severity")
    return out


def _flags(data: MasdData, adoptions: List[Adoption], acts: List[ActivityIn], as_of: date,
           idx: _Index, table: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Pregnancies to follow up: the due date (LMP + 280) has passed with no
    birth recorded, fortnightly antenatal checks are being missed, or there is
    no LMP to track the due date by. Mothers appear by record ID, never name."""
    learners = {l.id: l for l in data.learners}
    table = table if table is not None else data.expected_forms
    checks: Dict[int, List[date]] = defaultdict(list)
    for act in acts:
        if act.form_key == R.ACTIVITY_FORMS["anc"]:
            a = idx.adoption_of(act)
            if a is not None:
                checks[a.mother.id].append(act.on)
    items, open_n = [], 0
    for a in adoptions:
        if a.anchor is None or any(c.dob and c.dob <= as_of for c in a.children):
            continue
        if a.type not in (R.ANC, R.UNKNOWN):
            continue
        l = learners.get(a.mother.learner_id) if a.mother.learner_id else None
        if l is None:
            continue
        open_n += 1
        due = R.edd(a.mother.lmp)
        stop = min(as_of, due) if due else as_of
        expected = R.pregnancy_visits_due(a.anchor, stop, born=False)
        done = [d for d in checks[a.mother.id] if d <= as_of]
        last = max(done, default=None)
        reasons = []
        if due is not None and due < as_of:
            reasons.append("edd_passed")
        if expected - len(done) >= R.FLAG_ANC_MISSED:
            reasons.append("anc_behind")
        if a.mother.lmp is None:
            reasons.append("no_lmp")
        if not reasons:
            continue
        items.append({
            "mother_id": a.mother.id,
            "mother_uid": a.mother.uid,
            "learner_id": l.id,
            "learner": l.name,
            "block": l.block or "Not assigned",
            "f2f": l.f2f,
            "adopted": a.anchor.isoformat(),
            "lmp": a.mother.lmp.isoformat() if a.mother.lmp else None,
            "edd": due.isoformat() if due else None,
            "days_past_edd": (as_of - due).days if (due and due < as_of) else None,
            "anc_expected": expected,
            "anc_done": len(done),
            "last_anc": last.isoformat() if last else None,
            "days_since_contact": (as_of - (last or a.anchor)).days,
            "reasons": reasons,
        })
    items.sort(key=lambda x: (-(x["days_past_edd"] or -1), -(x["anc_expected"] - x["anc_done"]),
                              -x["days_since_contact"]))

    # Babies being followed up (review of 7 Oct 2026): growth checks missed
    # so far by the case's own LAP schedule, and the last one — a learner who
    # stopped visiting a mother after the birth shows up here.
    growth_checks: Dict[int, List[date]] = defaultdict(list)
    for act in acts:
        if act.form_key == R.ACTIVITY_FORMS["gm"] and act.child_id is not None:
            growth_checks[act.child_id].append(act.on)
    nurse_ids = {l.id for l in data.learners if R.role_group(l.role) == R.NURSING_STAFF}
    pnc = []
    for a in adoptions:
        born = [c for c in a.children if c.dob and c.dob <= as_of]
        l = learners.get(a.mother.learner_id) if a.mother.learner_id else None
        if not born or l is None or (as_of - born[0].dob).days > R.BABY_FOLLOW_UP_MAX_AGE_DAYS:
            continue
        due = case_expected_for(a, table, as_of, l.id in nurse_ids).get("gm", 0)
        done = sorted(d for c in born for d in growth_checks.get(c.id, []) if d <= as_of)
        last = done[-1] if done else None
        since = (as_of - (last or a.anchor or born[0].dob)).days
        missed = max(0, due - len(done))
        reasons = []
        if missed >= R.FLAG_PNC_MISSED:
            reasons.append("visits_missed")
        if since >= R.FLAG_PNC_SILENT_DAYS:
            reasons.append("no_recent_visit")
        if not reasons:
            continue
        pnc.append({
            "mother_id": a.mother.id, "mother_uid": a.mother.uid,
            "learner_id": l.id, "learner": l.name, "block": l.block or "Not assigned", "f2f": l.f2f,
            "type": a.type, "adopted": a.anchor.isoformat() if a.anchor else None,
            "dob": born[0].dob.isoformat(), "visits_due": due, "visits_done": len(done), "visits_missed": missed,
            "last_visit": last.isoformat() if last else None, "days_since_visit": since, "reasons": reasons,
        })
    pnc.sort(key=lambda x: (-x["visits_missed"], -x["days_since_visit"]))

    # Adoption type chosen by the learner vs worked out from the dates.
    mismatch = []
    for a in adoptions:
        declared = a.mother.declared_type
        l = learners.get(a.mother.learner_id) if a.mother.learner_id else None
        if not declared or l is None or a.type == R.UNKNOWN or declared == a.type:
            continue
        mismatch.append({"mother_id": a.mother.id, "mother_uid": a.mother.uid, "learner_id": l.id,
                         "learner": l.name, "block": l.block or "Not assigned",
                         "declared": declared, "computed": a.type,
                         "adopted": a.anchor.isoformat() if a.anchor else None})
    per_block = Counter(i["block"] for i in items)
    per_learner = Counter((i["learner_id"], i["learner"], i["block"]) for i in items)
    return {
        "summary": {"open_pregnancies": open_n, "flagged": len(items),
                    **{k: sum(1 for i in items if k in i["reasons"]) for k in R.FLAG_REASONS}},
        "items": items,
        "pnc": pnc,
        "pnc_summary": {"followed": sum(1 for a in adoptions if any(c.dob and c.dob <= as_of for c in a.children)),
                        "flagged": len(pnc),
                        **{k: sum(1 for i in pnc if k in i["reasons"]) for k in ("visits_missed", "no_recent_visit")}},
        "type_mismatch": mismatch,
        "by_block": [{"block": b, "n": n} for b, n in per_block.most_common()],
        "by_learner": [{"id": lid, "name": name, "block": block, "n": n}
                       for (lid, name, block), n in per_learner.most_common()],
    }


def _batches(data: MasdData, rows: List[Dict[str, Any]], cal: Dict[str, Any], as_of: date,
             steps: List[Dict[str, Any]], table: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Each training batch, how far its learners' follow-up has run and what a
    learner of it is expected to have done — the worked example."""
    f2f = [r for r in rows if r["f2f"]]
    out = []
    groups = [(b["id"], b["name"], b["end_date"]) for b in sorted(data.batches, key=lambda b: (b["end_date"], b["name"]))]
    extra = {b["id"]: b for b in data.batches}
    if any(r["batch_id"] is None for r in f2f) and cal["training_date"] is not None:
        groups.append((None, None, cal["training_date"]))
    for bid, name, end in groups:
        members = [r for r in f2f if r["batch_id"] == bid]
        if bid is None and not members:
            continue
        trs = R.tranches(steps, as_of, end)
        b = extra.get(bid) or {}
        start = b.get("start_date")
        out.append({"id": bid, "name": name, "end_date": end.isoformat(), "learners": len(members),
                    # Who trained it and who watches over it (review of 6 Oct 2026).
                    "start_date": start.isoformat() if start else None,
                    "trainers": b.get("trainers") or [],
                    "monitors": [{"id": r["id"], "name": r["name"]} for r in members if r["is_monitor"]],
                    "without_monitor": sum(1 for r in members if not r["is_monitor"] and not r["monitor_id"]),
                    "fu_raw": trs[0]["fu_raw"] if trs else None, "fu_days": trs[0]["fu_days"] if trs else None,
                    "tranche_fu": [tr["fu_days"] for tr in trs],
                    "expected": expected_per_learner(table, trs)})
    return out


# Days from a tranche opening to a learner's first / last adoption of it.
UPTAKE_BUCKETS = (("before", None), ("d7", 7), ("d15", 15), ("d30", 30), ("later", None))


def _uptake_bucket(days: Optional[int]) -> str:
    if days is None:
        return "not_yet"
    if days <= 0:
        return "before"
    for key, limit in UPTAKE_BUCKETS[1:-1]:
        if days <= limit:
            return key
    return "later"


def _median(values: List[int]) -> Optional[float]:
    vals = sorted(values)
    if not vals:
        return None
    mid = len(vals) // 2
    return float(vals[mid]) if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2


def _uptake(data: MasdData, rows: List[Dict[str, Any]], adoptions: List[Adoption],
            steps: List[Dict[str, Any]], cal: Dict[str, Any], as_of: date) -> List[Dict[str, Any]]:
    """How quickly learners took up each tranche once it opened.

    Adoptions fill the tranches in order, per adoption type: a learner asked
    for 1 ANC in each tranche starts tranche 2 with their second ANC
    adoption. For each learner and tranche: the days from its opening to
    their 1st, 2nd, 3rd … adoption of it (all types together, in date order)
    — the 1st is when they started, the last asked when they completed it.
    One made before the tranche opened counts as "before"; one not yet made,
    "not yet". Reported for the rest of the learners, Staff Nurses (their own
    target) and everyone, each with median and interquartile range (review of
    6 Oct 2026). Adds each learner's days to their row (`uptake`)."""
    by_learner: Dict[int, Dict[str, List[date]]] = defaultdict(lambda: defaultdict(list))
    nurse_ids = {r["id"] for r in rows if r["is_nurse"]}
    for a in adoptions:
        lid = a.mother.learner_id
        bucket = _bucket(a.type, lid in nurse_ids) if lid is not None else None
        if bucket and a.anchor:
            by_learner[lid][bucket].append(a.anchor)
    for dates in by_learner.values():
        for v in dates.values():
            v.sort()

    f2f = [r for r in rows if r["f2f"]]
    ends = {l.id: l.training_end or cal["training_date"] for l in data.learners}
    project_trs = R.tranches(steps, as_of, None)
    keys = [k for k, _ in UPTAKE_BUCKETS] + ["not_yet"]

    def summarise(records: List[Dict[str, Any]], max_n: int) -> Dict[str, Any]:
        asked = len(records)
        started = [r["nth"][0] for r in records if r["nth"] and r["nth"][0] is not None]
        completed = [r["completed"] for r in records if r["completed"] is not None]
        nth = []
        for n in range(1, max_n + 1):
            pool = [r for r in records if len(r["nth"]) >= n]
            days = [r["nth"][n - 1] for r in pool if r["nth"][n - 1] is not None]
            by = Counter(_uptake_bucket(r["nth"][n - 1]) for r in pool)
            q = _quartiles(max(0, d) for d in days)
            types = Counter(r["types"][n - 1] for r in pool if len(r["types"]) >= n)
            nth.append({"n": n, "learners": len(pool), "done": len(days),
                        "by": {k: by.get(k, 0) for k in keys},
                        # Which kind of case the n-th adoption was (review of 12 Oct 2026).
                        "types": {t: types.get(t, 0) for t in R.ADOPTION_TYPES},
                        "median": q["median"], "q1": q["q1"], "q3": q["q3"]})
        s_by = Counter(_uptake_bucket(r["nth"][0] if r["nth"] else None) for r in records)
        c_by = Counter(_uptake_bucket(r["completed"]) for r in records)
        q_start = _quartiles(max(0, d) for d in started)
        q_done = _quartiles(max(0, d) for d in completed)
        return {
            "learners": asked,
            "started": len(started), "started_pct": _pct(len(started), asked),
            "completed": len(completed), "completed_pct": _pct(len(completed), asked),
            "median_days_to_start": q_start["median"], "q1_days_to_start": q_start["q1"], "q3_days_to_start": q_start["q3"],
            "median_days_to_complete": q_done["median"], "q1_days_to_complete": q_done["q1"],
            "q3_days_to_complete": q_done["q3"],
            "started_by": {k: s_by.get(k, 0) for k in keys},
            "completed_by": {k: c_by.get(k, 0) for k in keys},
            "nth": nth,
        }

    out = []
    for tr in project_trs:
        i = tr["step"] - 1
        records: Dict[str, List[Dict[str, Any]]] = {"rol": [], "sn": []}
        max_n = {"rol": 0, "sn": 0}
        for r in f2f:
            ltr = R.tranches(steps, as_of, ends.get(r["id"]))
            if i >= len(ltr):
                continue
            mine = ltr[i]
            added = R.learner_targets(mine["added"], r["is_nurse"])
            before = R.learner_targets({k: mine["targets"][k] - mine["added"][k] for k in R.TARGET_KEYS},
                                       r["is_nurse"])
            need = [t for t in R.ADOPTION_TYPES if added[t] > 0]
            if not need:
                continue
            opened = date.fromisoformat(mine["opened"]) if mine["opened"] else None
            dates = by_learner.get(r["id"], {})
            taken = sorted((d, t) for t in need for d in dates.get(t, [])[before[t]:before[t] + added[t]])
            asked_n = sum(added[t] for t in need)
            nth = [((taken[j][0] - opened).days if (j < len(taken) and opened) else None) for j in range(asked_n)]
            types = [t for _, t in taken]
            all_done = all(len(dates.get(t, [])) >= before[t] + added[t] for t in need)
            completed = nth[-1] if (all_done and nth and nth[-1] is not None) else None
            group = "sn" if r["is_nurse"] else "rol"
            records[group].append({"nth": nth, "completed": completed, "types": types})
            max_n[group] = max(max_n[group], asked_n)
            # Everything the dashboard needs to recount uptake for any filtered
            # group of learners in the browser (review of 12 Oct 2026).
            r.setdefault("uptake", []).append({"step": tr["step"], "started_days": nth[0] if nth else None,
                                               "completed_days": completed, "nth": nth, "types": types,
                                               "asked": asked_n})
        everyone = records["rol"] + records["sn"]
        overall = summarise(everyone, max(max_n.values()))
        out.append({
            "step": tr["step"],
            "from": tr["from"],
            "buffer": tr["buffer"],
            "added": tr["added"],
            **overall,
            "groups": {"rol": summarise(records["rol"], max_n["rol"]),
                       "sn": summarise(records["sn"], max_n["sn"]),
                       "all": overall},
        })
    return out


CUMULATIVE_KINDS = ("anc", "pnc_lt5", "pnc_ge5", "sn")


def _kind_of(bucket: Optional[str], is_nurse: bool) -> Optional[str]:
    """The chart's adoption kind: a Staff Nurse's cases on their own ("sn"),
    the rest of the learners' by type."""
    if bucket is None:
        return None
    return "sn" if is_nurse else bucket


def cumulative(data: MasdData, rows: List[Dict[str, Any]], adoptions: List[Adoption],
               acts: List[ActivityIn], steps: List[Dict[str, Any]], cal: Dict[str, Any],
               table: Dict[str, Any], as_of: date, *, learner_ids: Optional[Iterable[int]] = None,
               kind: Optional[str] = None, per_case: bool = False) -> Dict[str, Any]:
    """Expected and actual adoptions and activities, day by day, cumulative
    (reviews of 6 and 12 Oct 2026): where the project should be by each date
    and where it is.

    Expected adoptions: a tranche's whole ask is due the day its buffer ends
    (from each learner's own last training day), so the line rises straight
    up there. Expected activities: those adoptions, all made that day (the
    ideal), then their forms day by day on the LAP schedule. With `per_case`,
    a third line: what the cases actually adopted were due, each counted from
    its own adoption and birth dates (level 3).

    Narrowed to `learner_ids` (the dashboard's filters) and to one `kind` of
    adoption (anc / pnc_lt5 / pnc_ge5 for the rest of the learners, sn for
    Staff Nurses). F2F learners only."""
    keep = set(learner_ids) if learner_ids is not None else None
    f2f = [r for r in rows if r["f2f"] and (keep is None or r["id"] in keep)]
    project_trs = R.tranches(steps, as_of, cal["training_date"])
    markers = [{"step": tr["step"], "from": tr["from"], "clock_from": tr["clock_from"]} for tr in project_trs]
    empty = {"days": [], "tranches": markers, "learners": len(f2f), "kind": kind, "per_case": per_case}
    if not f2f:
        return empty
    ends = {l.id: l.training_end or cal["training_date"] for l in data.learners}
    nurse = {r["id"]: r["is_nurse"] for r in f2f}

    plans = []
    first_clock: Optional[date] = None
    for r in f2f:
        for tr in R.tranches(steps, as_of, ends.get(r["id"])):
            if not tr["clock_from"]:
                continue
            clock = date.fromisoformat(tr["clock_from"])
            added = R.learner_targets(tr["added"], r["is_nurse"])
            asked = {t: n for t, n in added.items() if n and (kind is None or _kind_of(t, r["is_nurse"]) == kind)}
            if asked:
                plans.append((clock, r["is_nurse"], asked))
                first_clock = clock if first_clock is None or clock < first_clock else first_clock
    mine = [a for a in adoptions if a.mother.learner_id in nurse and a.anchor
            and (kind is None or _kind_of(_bucket(a.type, nurse[a.mother.learner_id]),
                                          nurse[a.mother.learner_id]) == kind)]
    if first_clock is None and not mine:
        return empty
    starts = [d for d in [first_clock, min((a.anchor for a in mine), default=None)] if d]
    start = min(min(starts) - timedelta(days=7), as_of)
    span = (as_of - start).days

    # Expected: step up at each clock, then the LAP schedule day by day.
    daily: Dict[Tuple[str, int], int] = {}

    def due(row: str, day: int) -> int:
        if (row, day) not in daily:
            daily[(row, day)] = sum(R.expected_on_day(table, row, day).values())
        return daily[(row, day)]

    exp_adopt = [0] * (span + 1)
    exp_acts = [0] * (span + 1)
    for clock, is_nurse, asked in plans:
        first = max(0, (clock - start).days)
        if first > span:
            continue
        n = sum(asked.values())
        for day in range(first, span + 1):
            exp_adopt[day] += n
            elapsed = day - (clock - start).days
            exp_acts[day] += sum(k * due(R.row_type(t, is_nurse), elapsed) for t, k in asked.items())

    # Actual adoptions and activities.
    adopt_on = Counter(a.anchor for a in mine)
    idx = _index(adoptions)
    act_on: Counter = Counter()
    for act in acts:
        if act.learner_id not in nurse or not R.FORM_TO_ACTIVITY.get(act.form_key):
            continue
        if kind is not None:
            a = idx.adoption_of(act)
            if a is None or a.mother.learner_id != act.learner_id:
                continue
            if _kind_of(_bucket(a.type, nurse[act.learner_id]), nurse[act.learner_id]) != kind:
                continue
        act_on[act.on] += 1

    # Level 3: each adopted case by its own dates.
    exp_cases = [0] * (span + 1) if per_case else None
    if per_case:
        for a in mine:
            is_nurse = nurse[a.mother.learner_id]
            for day in range(max(0, (a.anchor - start).days), span + 1):
                exp_cases[day] += sum(case_expected_for(a, table, start + timedelta(days=day), is_nurse).values())

    days = []
    run_a = sum(n for d, n in adopt_on.items() if d < start)
    run_x = sum(n for d, n in act_on.items() if d < start)
    for day in range(span + 1):
        d = start + timedelta(days=day)
        run_a += adopt_on.get(d, 0)
        run_x += act_on.get(d, 0)
        point = {"date": d.isoformat(), "expected_adoptions": exp_adopt[day], "adoptions": run_a,
                 "expected_activities": exp_acts[day], "activities": run_x}
        if exp_cases is not None:
            point["expected_cases"] = exp_cases[day]
        days.append(point)
    return {**empty, "days": days}


def cumulative_for(data: MasdData, as_of: date, *, learner_ids: Optional[Iterable[int]] = None,
                   kind: Optional[str] = None, per_case: bool = True) -> Dict[str, Any]:
    """The cumulative series on its own, for the chart's filters — without
    computing the whole report."""
    cal = calendar(data)
    steps = target_steps(data, cal)
    adoptions = adoptions_of(data, steps, as_of)
    acts = [a for a in data.activities if a.on <= as_of]
    rows = [{"id": l.id, "f2f": l.f2f, "is_nurse": R.role_group(l.role) == R.NURSING_STAFF} for l in data.learners]
    return cumulative(data, rows, adoptions, acts, steps, cal, data.expected_forms, as_of,
                      learner_ids=learner_ids, kind=kind, per_case=per_case)


def learner_view(data: MasdData, as_of: date, learner_id: int, due_days: int = 7) -> Optional[Dict[str, Any]]:
    """One learner's own work, for their dashboard (review of 17 Oct 2026:
    "it must be easy for them to track their own activities and adoptions,
    with clues to what percentage of work is done and what is expected of
    them in the next few days").

    The same numbers the MASD dashboard shows for that learner — targets and
    adoptions by type, forms due and done for the cases they adopted (level
    3, each case by its own dates), the cumulative series — plus, per case,
    the forms already behind and the forms falling due in the next
    `due_days` days. Expects `data` narrowed to the learner (data.load with
    `only_learners`), though any project data works."""
    cal = calendar(data)
    steps = target_steps(data, cal)
    targets_now, _ = R.targets_in_force(steps, as_of)
    table = data.expected_forms
    adoptions = adoptions_of(data, steps, as_of)
    acts = [a for a in data.activities if a.on <= as_of]
    idx = _index(adoptions)
    rows = _learner_rows(data, adoptions, acts, as_of, cal, steps, targets_now, table, idx)
    row = next((r for r in rows if r["id"] == learner_id), None)
    if row is None:
        return None
    is_nurse = row["is_nurse"]

    done_by_case: Dict[int, Counter] = defaultdict(Counter)
    last_on: Dict[int, date] = {}
    for act in acts:
        key = R.FORM_TO_ACTIVITY.get(act.form_key)
        a = idx.adoption_of(act)
        if key and a is not None and a.mother.learner_id == learner_id and act.learner_id == learner_id:
            done_by_case[a.mother.id][key] += 1
            if act.on > last_on.get(a.mother.id, date.min):
                last_on[a.mother.id] = act.on
    soon = as_of + timedelta(days=due_days)

    # The supervisors' follow-up warnings for this learner's own cases
    # (review of 17 Oct 2026: "the full faltering list"): a pregnancy past its
    # due date or behind on antenatal checks, a baby missing growth checks or
    # not visited for weeks, an adoption type that does not match the dates.
    flags = _flags(data, adoptions, acts, as_of, idx, table)
    warnings: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for item in flags["items"]:
        if item["learner_id"] != learner_id:
            continue
        for reason in item["reasons"]:
            warnings[item["mother_id"]].append({
                "code": reason, "days_past_edd": item["days_past_edd"], "edd": item["edd"],
                "anc_expected": item["anc_expected"], "anc_done": item["anc_done"],
            })
    for item in flags["pnc"]:
        if item["learner_id"] != learner_id:
            continue
        for reason in item["reasons"]:
            warnings[item["mother_id"]].append({
                "code": reason, "visits_missed": item["visits_missed"],
                "days_since_visit": item["days_since_visit"],
            })
    for item in flags["type_mismatch"]:
        if item["learner_id"] == learner_id:
            warnings[item["mother_id"]].append({"code": "type_mismatch", "declared": item["declared"],
                                                "computed": item["computed"]})
    cases = []
    for a in adoptions:
        if a.mother.learner_id != learner_id:
            continue
        now = case_expected_for(a, table, as_of, is_nurse)
        later = case_expected_for(a, table, soon, is_nurse)
        done = done_by_case.get(a.mother.id, Counter())
        behind = {k: max(0, now[k] - done[k]) for k in R.ACTIVITY_KEYS}
        upcoming = {k: max(0, later[k] - max(now[k], done[k])) for k in R.ACTIVITY_KEYS}
        cases.append({
            "mother_id": a.mother.id,
            "child_ids": [c.id for c in a.children],
            "type": _bucket(a.type, is_nurse) or R.UNKNOWN,
            "adopted_on": a.anchor.isoformat() if a.anchor else None,
            "expected": now, "done": {k: done[k] for k in R.ACTIVITY_KEYS},
            "behind": behind, "upcoming": upcoming,
            "behind_total": sum(behind.values()), "upcoming_total": sum(upcoming.values()),
            "warnings": warnings.get(a.mother.id, []),
            "last_form": last_on[a.mother.id].isoformat() if a.mother.id in last_on else None,
            "days_since_form": (as_of - last_on.get(a.mother.id, a.anchor or as_of)).days,
        })
    cases.sort(key=lambda c: (-len(c["warnings"]), -c["behind_total"], -c["upcoming_total"], c["adopted_on"] or ""))
    series = cumulative(data, rows, adoptions, acts, steps, cal, table, as_of,
                        learner_ids=[learner_id], per_case=True)
    tranches = R.tranches(steps, as_of, row["training_end"] and date.fromisoformat(row["training_end"]))
    return {
        "as_of": as_of.isoformat(),
        "due_days": due_days,
        "f2f": row["f2f"],
        "is_nurse": is_nurse,
        "training_end": row["training_end"],
        "tranches": [{"step": tr["step"], "from": tr["from"], "clock_from": tr["clock_from"]} for tr in tranches],
        "targets": row["targets"],
        "adoptions": row["adoptions"],
        "fulfilment_pct": row["fulfilment_pct"],
        "own": row["own"],
        "ideal": row["ideal"],
        "activities": row["activities"],
        "by_type": {t: {k: v for k, v in d.items() if k in ("target", "adopted", "adoption_pct")}
                    for t, d in row["by_type"].items()},
        "last_activity": row["last_activity"],
        "nil_days": row["nil_days"],
        "cases": cases,
        "behind_total": sum(c["behind_total"] for c in cases),
        "upcoming_total": sum(c["upcoming_total"] for c in cases),
        "cumulative": series,
    }


def team_view(data: MasdData, as_of: date, learner_ids: Iterable[int]) -> List[Dict[str, Any]]:
    """A batch monitor's learners at a glance: adoptions against target,
    forms done against due (level 3) and days since they last did anything.
    Counts about the learners only — no mother or child is named."""
    keep = set(learner_ids)
    cal = calendar(data)
    steps = target_steps(data, cal)
    targets_now, _ = R.targets_in_force(steps, as_of)
    adoptions = adoptions_of(data, steps, as_of)
    acts = [a for a in data.activities if a.on <= as_of]
    rows = _learner_rows(data, adoptions, acts, as_of, cal, steps, targets_now, data.expected_forms,
                         _index(adoptions))
    return [{
        "id": r["id"], "name": r["name"], "role_group": r["role_group"],
        "adoptions": r["adoptions"]["total"], "target": r["target"], "fulfilment_pct": r["fulfilment_pct"],
        "forms_done": r["own"]["actual"]["total"], "forms_due": r["own"]["expected"]["total"],
        "forms_pct": r["own"]["pct"], "nil_days": r["nil_days"], "last_activity": r["last_activity"],
    } for r in rows if r["id"] in keep]


def _levels_example(table: Dict[str, Any], steps: List[Dict[str, Any]], cal: Dict[str, Any],
                    as_of: date) -> Optional[Dict[str, Any]]:
    """One made-up community learner, worked through the three levels of
    expected activity on this project's own tranches and table (review of
    12 Oct 2026): asked for everything the tranches ask; adopted an ANC
    mother and a PNC <5M baby in tranche 1 and one PNC <5M baby in tranche 2,
    a few days after each buffer ended."""
    trs = [tr for tr in R.tranches(steps, as_of, cal["training_date"]) if tr["clock_from"]]
    if not trs:
        return None
    ideal = sum(v for tr in trs for t in R.ADOPTION_TYPES
                for v in [R.learner_targets(tr["added"], False)[t] * sum(
                    R.expected_at(table, R.row_type(t, False), tr["fu_days"]).values())])
    picks = [(trs[0], R.ANC, 3, None), (trs[0], R.PNC_LT5, 5, 30)]
    if len(trs) > 1:
        picks.append((trs[1], R.PNC_LT5, 10, 10))
    cases = []
    for tr, atype, after, baby_age in picks:
        adopted = date.fromisoformat(tr["clock_from"]) + timedelta(days=after)
        if adopted > as_of:
            continue
        lvl2 = sum(R.expected_at(table, atype, tr["fu_days"]).values())
        if atype == R.ANC:
            lmp = adopted - timedelta(days=200)               # about 7 months pregnant
            dob = lmp + timedelta(days=R.PREGNANCY_DAYS)
            born = dob if dob <= as_of else None
            e = R.case_expected(table, mother_adopted=adopted, lmp=lmp, dob=born,
                                baby_adopted=born, end=as_of)
        else:
            dob = adopted - timedelta(days=baby_age)
            e = R.case_expected(table, mother_adopted=adopted, lmp=None, dob=dob, baby_adopted=adopted, end=as_of)
        lvl3 = sum(e[k] for k in R.ACTIVITY_KEYS)
        cases.append({"tranche": tr["step"], "type": atype, "adopted": adopted.isoformat(),
                      "baby_age_days": baby_age, "fu_days": tr["fu_days"], "own_days": (as_of - adopted).days,
                      "level2": lvl2, "level3": lvl3})
    asked = {t: sum(R.learner_targets(tr["added"], False)[t] for tr in trs) for t in R.ADOPTION_TYPES}
    return {"asked": asked, "asked_total": sum(asked.values()), "level1": ideal, "cases": cases,
            "level2": sum(c["level2"] for c in cases), "level3": sum(c["level3"] for c in cases),
            "tranches": [{"step": tr["step"], "clock_from": tr["clock_from"], "fu_days": tr["fu_days"]} for tr in trs]}


# ── Outcome half ───────────────────────────────────────────────────────────


@dataclass
class Dyad:
    adoption: Adoption
    child: Optional[ChildIn]
    learner: LearnerIn
    reason: Optional[str] = None
    z: Dict[str, Dict[str, Optional[float]]] = field(default_factory=dict)   # point -> indicator -> z
    visits: int = 0
    follow_up_days: Optional[int] = None

    @property
    def band(self) -> Optional[str]:
        return R.BAND_OF_TYPE.get(self.adoption.type)


def _dyad_checks(dyad: Dyad, growth: List[GrowthIn]) -> Optional[str]:
    """Run the report's data-quality checks in order; the first that fails is
    the dyad's primary exclusion reason (None = included). Fills in the z-scores
    and visit counts as it goes."""
    m, c = dyad.adoption.mother, dyad.child
    if c is None:
        return "no_child"
    if c.adoption_date is None:
        return "no_adoption_details"
    sex = _sex(c.gender)
    measured = [g for g in growth if g.weight is not None or g.length is not None]
    first = measured[0] if measured else None
    last = measured[-1] if measured else None
    if last is not None and m.adoption_date and m.adoption_date > last.on:
        return "mother_after_lv"
    bv_waz = _z("wfa", sex, 0, c.birth_weight, None) if c.birth_weight else None
    if bv_waz is not None and abs(bv_waz) > R.BIRTH_Z_LIMIT:
        return "birth_weight_extreme"
    if first is not None and c.dob and c.birth_weight and first.weight is not None \
            and 0 <= (first.on - c.dob).days <= R.BIRTH_VISIT_WINDOW_DAYS \
            and abs(first.weight - c.birth_weight) > R.BIRTH_WEIGHT_TOLERANCE_KG:
        return "birth_vs_visit1"
    if first is not None and c.dob and first.on < c.dob:
        return "dob_vs_visit1"
    if first is not None and abs((first.on - c.adoption_date).days) > R.ADOPTION_VISIT_WINDOW_DAYS:
        return "adoption_vs_visit"
    if len(measured) == 1:
        return "only_adoption_visit"
    if not measured:
        return "only_birth_anthropometry"

    def age(on: date) -> Optional[int]:
        return (on - c.dob).days if c.dob else None

    points = {
        "bv": (0, c.birth_weight, c.birth_length),
        "av": (age(first.on), first.weight, first.length),
        "lv": (age(last.on), last.weight, last.length),
    }
    dyad.z = {p: {ind: _z(R.INDICATOR_Z[ind], sex, *points[p]) for ind in R.INDICATORS}
              for p in points}
    dyad.visits = len(measured)
    dyad.follow_up_days = (last.on - first.on).days
    if any(dyad.z[p]["underweight"] is None for p in ("bv", "av", "lv")):
        return "z_missing"
    if c.adoption_date and m.adoption_date and c.adoption_date < m.adoption_date:
        return "baby_before_mother"
    return None


def _prevalence(dyads: List[Dyad]) -> Dict[str, Any]:
    """% below −2 SD at BV / AV / LV for each indicator — and below −3 SD
    for its severe form (severe stunting, severe underweight, SAM) — over the
    dyads with a value at that point."""
    out: Dict[str, Any] = {"n": len(dyads)}
    for ind in R.ALL_INDICATORS:
        base = R.SEVERE_OF.get(ind, ind)
        cut = R.SEVERE_Z if ind in R.SEVERE_OF else R.MALNUTRITION_Z
        entry: Dict[str, Any] = {}
        for p in ("bv", "av", "lv"):
            vals = [d.z[p][base] for d in dyads if d.z.get(p, {}).get(base) is not None]
            entry[p] = _pct(sum(1 for v in vals if v < cut), len(vals))
            entry[f"n_{p}"] = len(vals)
        av, lv = entry["av"], entry["lv"]
        entry["abs_change"] = round(lv - av, 1) if (av is not None and lv is not None) else None
        entry["rel_change"] = (round(100.0 * (lv - av) / av, 1)
                               if (av and lv is not None) else None)
        out[ind] = entry
    return out


def _share(counter: Counter, order: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    total = sum(counter.values())
    keys = [k for k in (order or []) if k in counter] + \
        sorted((k for k in counter if k not in set(order or [])), key=lambda k: -counter[k])
    return [{"label": k, "n": counter[k], "pct": _pct(counter[k], total)} for k in keys]


def _mother_age_group(age: Optional[int]) -> str:
    if age is None:
        return "Not recorded"
    for lo, hi, label in R.MOTHER_AGE_GROUPS:
        if lo <= age <= hi:
            return label
    return "Other ages"


def _outcomes(data: MasdData, adoptions: List[Adoption], as_of: date) -> Dict[str, Any]:
    learners = {l.id: l for l in data.learners}
    growth: Dict[int, List[GrowthIn]] = defaultdict(list)
    for g in data.growth:
        if g.on <= as_of:
            growth[g.child_id].append(g)
    for series in growth.values():
        series.sort(key=lambda g: g.on)

    # Every dyad: a mother with no child is one dyad without a child ID; twins
    # are two dyads of one adoption.
    all_dyads: List[Dyad] = []
    for a in adoptions:
        learner = learners.get(a.mother.learner_id) if a.mother.learner_id else None
        if learner is None:
            continue
        born = [c for c in a.children if (c.adoption_date or c.dob) and (c.adoption_date or c.dob) <= as_of]
        for c in (born or [None]):
            all_dyads.append(Dyad(a, c, learner))

    # Upstream funnel (learners and cases): who is eligible for the analysis.
    def step(dyads: List[Dyad]) -> Tuple[int, int]:
        return len({d.learner.id for d in dyads}), len(dyads)

    funnel = []
    current = all_dyads
    l0, c0 = step(current)
    funnel.append({"key": "start", "learners_after": l0, "cases_after": c0,
                   "learners_removed": 0, "cases_removed": 0})
    for key, keep in (
        ("no_f2f", lambda d: d.learner.f2f),
        ("nursing_staff", lambda d: R.role_group(d.learner.role) != R.NURSING_STAFF),
    ):
        nxt = [d for d in current if keep(d)]
        lb, cb = step(current)
        la, ca = step(nxt)
        funnel.append({"key": key, "learners_after": la, "cases_after": ca,
                       "learners_removed": lb - la, "cases_removed": cb - ca})
        current = nxt
    eligible = current

    for d in eligible:
        d.reason = _dyad_checks(d, growth.get(d.child.id, []) if d.child else [])
    included = [d for d in eligible if d.reason is None]

    # Exclusion reasons, MT+FL vs other.
    reason_rows = []
    for key, label in R.EXCLUSION_REASONS:
        mt = sum(1 for d in eligible if d.reason == key and d.learner.trainer_role)
        ot = sum(1 for d in eligible if d.reason == key and not d.learner.trainer_role)
        reason_rows.append({"key": key, "label": label, "mtfl": mt, "other": ot, "total": mt + ot})
    tot_mt = sum(1 for d in eligible if d.learner.trainer_role)
    tot_ot = len(eligible) - tot_mt
    inc_mt = sum(1 for d in included if d.learner.trainer_role)
    inc_ot = len(included) - inc_mt

    # Retention by cadre.
    ret_learners, ret_adopt = [], []
    for group in R.ROLE_GROUPS:
        g_all = [d for d in eligible if R.role_group(d.learner.role) == group]
        if not g_all:
            continue
        g_inc = [d for d in g_all if d.reason is None]
        la, li = len({d.learner.id for d in g_all}), len({d.learner.id for d in g_inc})
        ret_learners.append({"role_group": group, "total": la, "final": li, "pct": _pct(li, la)})
        ret_adopt.append({"role_group": group, "total": len(g_all), "final": len(g_inc),
                          "pct": _pct(len(g_inc), len(g_all))})
    la = len({d.learner.id for d in eligible})
    li = len({d.learner.id for d in included})
    ret_learners.append({"role_group": "Total", "total": la, "final": li, "pct": _pct(li, la)})
    ret_adopt.append({"role_group": "Total", "total": len(eligible), "final": len(included),
                      "pct": _pct(len(included), len(eligible))})

    # Each learner's eligible dyads, included ones and reasons — so the
    # dashboard can split exclusions and retention by any learner group.
    by_learner: Dict[int, Dict[str, Any]] = {}
    for d in eligible:
        e = by_learner.setdefault(d.learner.id, {"eligible": 0, "included": 0, "reasons": Counter()})
        e["eligible"] += 1
        if d.reason is None:
            e["included"] += 1
        else:
            e["reasons"][d.reason] += 1
    by_learner_out = {str(k): {"eligible": v["eligible"], "included": v["included"], "reasons": dict(v["reasons"])}
                      for k, v in by_learner.items()}

    # Mother demographics of the analysed dyads, in the order the analysts
    # read them (review of 7 Oct 2026), with delivery place × method.
    places = ["Government", "Private", "Home", "Other", "Not recorded"]
    methods = ["Normal", "Caesarean section", "Assisted delivery", "Other", "Not recorded"]
    cross = Counter((R.delivery_place_group(d.child.delivery_place), R.delivery_method_group(d.child.delivery_method))
                    for d in included)
    demo = {
        "n": len(included),
        "mother_age": _share(Counter(_mother_age_group(d.adoption.mother.age) for d in included),
                             [g[2] for g in R.MOTHER_AGE_GROUPS]),
        "education": _share(Counter(d.adoption.mother.education or "Not recorded" for d in included)),
        "ration_card": _share(Counter(d.adoption.mother.ration_card or "Not recorded" for d in included)),
        "social_category": _share(Counter(d.adoption.mother.social_category or "Not recorded" for d in included)),
        "place_by_method": {"places": [p for p in places if any(cross.get((p, m)) for m in methods)],
                            "methods": [m for m in methods if any(cross.get((p, m)) for p in places)],
                            "counts": {f"{p}|{m}": n for (p, m), n in cross.items()}},
        "delivery_place": _share(Counter(R.delivery_place_group(d.child.delivery_place) for d in included),
                                 ["Government", "Private", "Home", "Other", "Not recorded"]),
        "delivery_method": _share(Counter(R.delivery_method_group(d.child.delivery_method) for d in included),
                                  ["Normal", "Caesarean section", "Assisted delivery", "Other", "Not recorded"]),
    }

    mt_inc = [d for d in included if d.learner.trainer_role]
    ot_inc = [d for d in included if not d.learner.trainer_role]
    bands: Dict[str, Any] = {}
    compliance: Dict[str, Any] = {}
    for band in (R.BAND_LT6, R.BAND_6_11):
        in_band = [d for d in included if d.band == band]
        rule = R.COMPLIANCE[band]
        yes = [d for d in in_band if d.visits >= rule["min_visits"]
               and (d.follow_up_days or 0) >= rule["min_follow_up_days"]]
        no = [d for d in in_band if d not in yes]
        bands[band] = {
            "all": _prevalence(in_band),
            "mtfl": _prevalence([d for d in in_band if d.learner.trainer_role]),
            "other": _prevalence([d for d in in_band if not d.learner.trainer_role]),
        }
        compliance[band] = {"rule": rule, "yes": _prevalence(yes), "no": _prevalence(no)}

    benchmarks = data.benchmarks
    # The first year of life in one figure: the <6 and 6–11 month NFHS values
    # weighted by their sample sizes, where the analysts have entered them.
    lt12 = None
    if benchmarks and benchmarks.get("age_bands"):
        a = benchmarks["age_bands"].get(R.BAND_LT6) or {}
        b = benchmarks["age_bands"].get(R.BAND_6_11) or {}
        vals = {ind: R.combined_prevalence(a.get(ind), a.get("n"), b.get(ind), b.get("n")) for ind in R.ALL_INDICATORS}
        if any(v is not None for v in vals.values()):
            lt12 = {**vals, "n": (a.get("n") or 0) + (b.get("n") or 0)}
    return {
        "funnel": funnel,
        "exclusions": {
            "reasons": reason_rows,
            "included": {"mtfl": inc_mt, "other": inc_ot, "total": len(included)},
            "total": {"mtfl": tot_mt, "other": tot_ot, "total": len(eligible)},
            "inclusion_pct": _pct(len(included), len(eligible)),
            "inclusion_pct_mtfl": _pct(inc_mt, tot_mt),
            "inclusion_pct_other": _pct(inc_ot, tot_ot),
        },
        "retention": {"learners": ret_learners, "adoptions": ret_adopt},
        "by_learner": by_learner_out,
        "demographics": demo,
        "prevalence": {
            "overall": _prevalence(included),
            "mtfl": _prevalence(mt_inc),
            "other": _prevalence(ot_inc),
            "bands": bands,
        },
        "compliance": compliance,
        "benchmarks": benchmarks,
        "benchmarks_lt12": lt12,
        "data_fixes": _data_fixes(eligible),
    }


_DATA_ERRORS = {"mother_after_lv", "birth_weight_extreme", "birth_vs_visit1", "dob_vs_visit1",
                "adoption_vs_visit", "z_missing", "baby_before_mother", "no_adoption_details"}


def _data_fixes(dyads: List[Dyad]) -> List[Dict[str, Any]]:
    """Cases excluded for a data-entry problem (not for incomplete follow-up),
    per learner — the list to send back for correction. Learner names only;
    the report never names a mother or child."""
    per: Dict[int, Dict[str, Any]] = {}
    for d in dyads:
        if d.reason not in _DATA_ERRORS:
            continue
        row = per.setdefault(d.learner.id, {"id": d.learner.id, "name": d.learner.name,
                                             "block": d.learner.block or "Not assigned",
                                             "cases": 0, "reasons": Counter()})
        row["cases"] += 1
        row["reasons"][d.reason] += 1
    out = sorted(per.values(), key=lambda r: -r["cases"])
    for r in out:
        r["reasons"] = dict(r["reasons"])
    return out


# ── The report ─────────────────────────────────────────────────────────────


def target_steps(data: MasdData, cal: Dict[str, Any]) -> List[Dict[str, Any]]:
    steps = data.targets or R.default_targets(data.project.get("slug") or "", cal["training_date"],
                                              cal["tranche2_start"])
    return sorted(steps, key=lambda s: s.get("from") or "")


def compute(data: MasdData, as_of: date) -> Dict[str, Any]:
    cal = calendar(data)
    tranche2 = cal["tranche2_start"]
    steps = target_steps(data, cal)
    targets_now, step_no = R.targets_in_force(steps, as_of)
    table = data.expected_forms
    adoptions = adoptions_of(data, steps, as_of)
    acts = [a for a in data.activities if a.on <= as_of]
    idx = _index(adoptions)

    rows = _learner_rows(data, adoptions, acts, as_of, cal, steps, targets_now, table, idx)
    f2f_rows = [r for r in rows if r["f2f"]]
    f2f_ids = {r["id"] for r in f2f_rows}
    non_f2f_cases = sum(r["adoptions"]["total"] for r in rows if not r["f2f"])

    blocks = _group_by(f2f_rows, "block")
    roles = _group_by(f2f_rows, "role_group", R.ROLE_GROUPS)
    total = _aggregate(f2f_rows, "total", "Total")
    departments = [_aggregate([r for r in f2f_rows if r["department"] == dept], dept, f"{dept} subtotal")
                   for dept in DEPARTMENT_ORDER if any(r["department"] == dept for r in f2f_rows)]
    departments.append(total)

    # Learners across blocks × cadres (counts), the report's distribution table.
    distribution: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in f2f_rows:
        distribution[r["block"]][r["role_group"]] += 1

    tranche_mix = Counter((a.tranche, a.type) for a in adoptions if a.mother.learner_id in f2f_ids)
    project_trs = R.tranches(steps, as_of, cal["training_date"])
    uptake = _uptake(data, rows, adoptions, steps, cal, as_of)

    attention = _attention(f2f_rows)
    monitors = _monitors(rows, attention)
    flags = _flags(data, adoptions, acts, as_of, idx, table)
    mismatched = Counter(i["learner_id"] for i in flags["type_mismatch"])
    by_row = {r["id"]: r for r in rows}
    for r in rows:
        r["declared_mismatch"] = mismatched.get(r["id"], 0)
    # A mismatch or a missed baby is the learner's and their batch monitor's to fix.
    for item in flags["type_mismatch"] + flags["pnc"]:
        item["monitor"] = (by_row.get(item["learner_id"]) or {}).get("monitor")
    report = {
        "project": data.project,
        "as_of": as_of.isoformat(),
        "calendar": {
            "training_date": cal["training_date"].isoformat() if cal["training_date"] else None,
            "tranche2_start": tranche2.isoformat() if tranche2 else None,
            "inferred": cal["inferred"],
            "saved": data.calendar_saved,
            "tranches_in_force": len(project_trs),
            "buffer_days": project_trs[0]["buffer"] if project_trs else R.FIRST_TRANCHE_BUFFER_DAYS,
            "step_days": R.FU_STEP_DAYS,
            "fu_raw": project_trs[0]["fu_raw"] if project_trs else None,
            "fu_days": project_trs[0]["fu_days"] if project_trs else None,
            "tranches": expected_per_learner(table, project_trs)["tranches"],
            "batches": _batches(data, rows, cal, as_of, steps, table),
            "targets": {"now": targets_now, "step": step_no, "steps": steps,
                        "is_default": data.targets is None},
            "expected_forms_default": data.expected_forms_default,
        },
        "summary": {
            **total,
            "learners_all": len(rows),
            "non_f2f_learners_with_cases": sum(1 for r in rows if not r["f2f"] and r["adoptions"]["total"]),
            "non_f2f_cases": non_f2f_cases,
            "tranche_mix": {f"t{t}_{typ}": n for (t, typ), n in sorted(tranche_mix.items())},
        },
        "blocks": blocks,
        "roles": roles,
        "departments": departments,
        "distribution": {b: dict(v) for b, v in distribution.items()},
        "learners": rows,
        "weekly": _weekly(acts, adoptions, f2f_ids, cal["training_date"], as_of),
        "attention": attention,
        "batch_monitors": monitors,
        "flags": flags,
        "cumulative": cumulative(data, rows, adoptions, acts, steps, cal, table, as_of),
        "levels_example": _levels_example(table, steps, cal, as_of),
        "uptake": uptake,
        "outcomes": _outcomes(data, adoptions, as_of),
        "rules": {
            "expected": {
                "buffer_days": R.FIRST_TRANCHE_BUFFER_DAYS,
                "later_buffer_days": R.LATER_TRANCHE_BUFFER_DAYS,
                "step_days": R.FU_STEP_DAYS,
                "max_days": R.FU_MAX_DAYS,
                "table": table,
                "table_is_default": data.expected_forms_default,
                "rows": R.EXPECTED_ROWS,
                "anc_every_days": R.ANC_VISIT_EVERY_DAYS,
                "pregnancy_days": R.PREGNANCY_DAYS,
                "cf_age_days": list(R.CF_AGE_DAYS),
                "bf_until_age_days": R.BF_UNTIL_AGE_DAYS,
                "counselling_from_age_days": R.COUNSELLING_FROM_AGE_DAYS,
                "baby_max_age_days": R.BABY_FOLLOW_UP_MAX_AGE_DAYS,
                # The LAP visit schedule behind the default table: the day of
                # follow-up each form falls due (review of 6 Oct 2026).
                "lap_days": {"anc": list(R.LAP_ANC_DAYS), "protein": list(R.LAP_ANC_DAYS),
                             "gm": list(R.LAP_GM_DAYS), "bf": list(R.LAP_BF_DAYS), "cf": list(R.LAP_CF_DAYS)},
                "nurse_flat": dict(R.NURSE_FLAT),
                "pnc_flag_missed": R.FLAG_PNC_MISSED,
                "pnc_flag_silent_days": R.FLAG_PNC_SILENT_DAYS,
            },
            "targets": steps,
            "own_bands": R.OWN_BANDS,
            "flag_reasons": R.FLAG_REASONS,
            "five_months_days": R.FIVE_MONTHS_DAYS,
            "compliance": R.COMPLIANCE,
            "exclusion_reasons": R.EXCLUSION_REASONS,
        },
    }
    return report


def community_target(report: Dict[str, Any]) -> int:
    now = report["calendar"]["targets"]["now"]
    return now["anc"] + now["pnc_lt5"] + now["pnc_ge5"]


def comparison(then: Dict[str, Any], now: Dict[str, Any]) -> Dict[str, Any]:
    """Then vs now, the report's "progress since the last meeting" slides."""
    def lite(r: Dict[str, Any]) -> Dict[str, Any]:
        s = r["summary"]
        nurses = next((g for g in r["roles"] if g["key"] == R.NURSING_STAFF), None)
        bands = r["outcomes"]["prevalence"]["bands"]
        return {
            "as_of": r["as_of"],
            "tranches_in_force": r["calendar"]["tranches_in_force"],
            "fu_days": r["calendar"]["fu_days"],
            "learners": s["learners"],
            "target_per_learner": community_target(r),
            "targets": r["calendar"]["targets"]["now"],
            "adoptions": s["adoptions"],
            "target": s["target"],
            "fulfilment_pct": s["fulfilment_pct"],
            "intensity_pct": s["intensity_pct"],
            "own_pct": s["own_pct"],
            "nil_days_avg": s["nil_days_avg"],
            # Counts before percentages, and the skew-proof middle (review of 7 Oct 2026).
            "activities": s["activities"],
            "ideal": s["ideal"],
            "undertaken_expected": s["undertaken_expected"],
            "undertaken_actual": s["undertaken_actual"],
            "undertaken_pct": s["undertaken_pct"],
            "nil_days_median": s["nil_days_median"],
            "nil_days_q1": s["nil_days_q1"],
            "nil_days_q3": s["nil_days_q3"],
            "cohort": r["outcomes"]["exclusions"]["included"]["total"],
            "cohort_lt6": bands[R.BAND_LT6]["all"]["n"],
            "cohort_6_11": bands[R.BAND_6_11]["all"]["n"],
            "nurses": ({"learners": nurses["learners"], "fulfilment_pct": nurses["fulfilment_pct"],
                        "intensity_pct": nurses["intensity_pct"], "nil_days_avg": nurses["nil_days_avg"]}
                       if nurses else None),
            "underweight": {band: {"n": bands[band]["all"]["n"],
                                   "av": bands[band]["all"]["underweight"]["av"],
                                   "lv": bands[band]["all"]["underweight"]["lv"],
                                   "abs_change": bands[band]["all"]["underweight"]["abs_change"]}
                            for band in (R.BAND_LT6, R.BAND_6_11)},
        }

    t, n = lite(then), lite(now)
    then_blocks = {b["key"]: b for b in then["blocks"]}
    blocks = []
    for b in now["blocks"]:
        tb = then_blocks.get(b["key"])
        blocks.append({
            "key": b["key"], "label": b["label"],
            "fulfilment_then": tb["fulfilment_pct"] if tb else None, "fulfilment_now": b["fulfilment_pct"],
            "intensity_then": tb["intensity_pct"] if tb else None, "intensity_now": b["intensity_pct"],
        })
    for b in blocks:
        b["fulfilment_change"] = (round(b["fulfilment_now"] - b["fulfilment_then"], 1)
                                  if b["fulfilment_now"] is not None and b["fulfilment_then"] is not None else None)
        b["intensity_change"] = (round(b["intensity_now"] - b["intensity_then"], 1)
                                 if b["intensity_now"] is not None and b["intensity_then"] is not None else None)
    return {"then": t, "now": n, "blocks": blocks}
