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
        for tr in trs:
            added = R.learner_targets(tr["added"], is_nurse)
            for t in R.ADOPTION_TYPES:
                for k, v in R.expected_at(table, R.row_type(t, is_nurse), tr["fu_days"]).items():
                    ideal[k] += added[t] * v
                    exp_type[t] += added[t] * v
        by_type: Dict[str, Dict[str, Any]] = {}
        for t in R.ADOPTION_TYPES:
            keys = {k for rt, k in R.EXPECTED_ROWS if rt == R.row_type(t, is_nurse)}
            actual = sum(typed[l.id][(t, k)] for k in keys)
            adopted = mix.get(t, 0)
            by_type[t] = {"target": lt[t], "adopted": adopted, "adoption_pct": _pct(adopted, lt[t]),
                          "expected": exp_type[t], "actual": actual, "activity_pct": _pct(actual, exp_type[t])}

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
        "no_activity": sum(1 for r in rows if r["activities"]["total"] == 0),
        "zero_adoptions": sum(1 for r in rows if r["adoptions"]["total"] == 0),
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
           idx: _Index) -> Dict[str, Any]:
    """Pregnancies to follow up: the due date (LMP + 280) has passed with no
    birth recorded, fortnightly antenatal checks are being missed, or there is
    no LMP to track the due date by. Mothers appear by record ID, never name."""
    learners = {l.id: l for l in data.learners}
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
    per_block = Counter(i["block"] for i in items)
    per_learner = Counter((i["learner_id"], i["learner"], i["block"]) for i in items)
    return {
        "summary": {"open_pregnancies": open_n, "flagged": len(items),
                    **{k: sum(1 for i in items if k in i["reasons"]) for k in R.FLAG_REASONS}},
        "items": items,
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
    if any(r["batch_id"] is None for r in f2f) and cal["training_date"] is not None:
        groups.append((None, None, cal["training_date"]))
    for bid, name, end in groups:
        members = [r for r in f2f if r["batch_id"] == bid]
        if bid is None and not members:
            continue
        trs = R.tranches(steps, as_of, end)
        out.append({"id": bid, "name": name, "end_date": end.isoformat(), "learners": len(members),
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
    """How quickly learners took up each tranche once it opened: the day of
    their first adoption of it, and of the adoption that completed it.

    Adoptions fill the tranches in order, per adoption type: a learner asked
    for 1 ANC in each tranche starts tranche 2 with their second ANC
    adoption. One made before the tranche opened (an early start) counts as
    "before"; one not yet made, "not yet". Adds each learner's days to their
    row (`uptake`) for the workbook."""
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
    out = []
    for tr in project_trs:
        i = tr["step"] - 1
        agg = {"started": Counter(), "completed": Counter()}
        days_started: List[int] = []
        days_completed: List[int] = []
        asked = 0
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
            asked += 1
            opened = date.fromisoformat(mine["opened"]) if mine["opened"] else None
            dates = by_learner.get(r["id"], {})
            firsts = [dates.get(t, [])[before[t]] for t in need if len(dates.get(t, [])) > before[t]]
            lasts = [dates.get(t, [])[before[t] + added[t] - 1] for t in need
                     if len(dates.get(t, [])) >= before[t] + added[t]]
            start_days = (min(firsts) - opened).days if (firsts and opened) else None
            done_days = (max(lasts) - opened).days if (len(lasts) == len(need) and opened) else None
            agg["started"][_uptake_bucket(start_days)] += 1
            agg["completed"][_uptake_bucket(done_days)] += 1
            if start_days is not None:
                days_started.append(max(0, start_days))
            if done_days is not None:
                days_completed.append(max(0, done_days))
            r.setdefault("uptake", []).append({"step": tr["step"], "started_days": start_days,
                                               "completed_days": done_days})
        keys = [k for k, _ in UPTAKE_BUCKETS] + ["not_yet"]
        started = asked - agg["started"]["not_yet"]
        completed = asked - agg["completed"]["not_yet"]
        out.append({
            "step": tr["step"],
            "from": tr["from"],
            "buffer": tr["buffer"],
            "added": tr["added"],
            "learners": asked,
            "started": started,
            "started_pct": _pct(started, asked),
            "completed": completed,
            "completed_pct": _pct(completed, asked),
            "median_days_to_start": _median(days_started),
            "median_days_to_complete": _median(days_completed),
            "started_by": {k: agg["started"].get(k, 0) for k in keys},
            "completed_by": {k: agg["completed"].get(k, 0) for k in keys},
        })
    return out


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

    # Mother demographics of the analysed dyads.
    demo = {
        "n": len(included),
        "mother_age": _share(Counter(_mother_age_group(d.adoption.mother.age) for d in included),
                             [g[2] for g in R.MOTHER_AGE_GROUPS]),
        "ration_card": _share(Counter(d.adoption.mother.ration_card or "Not recorded" for d in included)),
        "social_category": _share(Counter(d.adoption.mother.social_category or "Not recorded" for d in included)),
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
        "attention": _attention(f2f_rows),
        "flags": _flags(data, adoptions, acts, as_of, idx),
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
