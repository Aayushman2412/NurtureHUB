"""The MASD analysis: from a project's learners, adoptions and activities to
every number in the district report.

Pure: `compute(data, as_of)` takes plain records (see `MasdData`) and returns a
JSON-ready dict — no database, no clock. The same function runs for "now" and
for the comparison date, so "then vs now" is two calls with two dates, and the
dashboard, the PowerPoint and the Excel download can never disagree.

Two halves, as in the report:
  * activity — adoption target fulfilment and activity intensity for every
    F2F-trained learner, by block, cadre and activity subtype;
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


def expected_fraction(cal: Dict[str, Any], as_of: date, nurse: bool = False) -> Dict[int, float]:
    """How much of each tranche's ideal is due by `as_of`.

    A tranche's activities fall due across its adoption window plus the
    follow-up its adoptions need (2.5 months for tranche 1, 1.5 for tranche 2),
    pro rata. Once the follow-up is over the fraction is 1 and the ideal is the
    report's flat 98 (66 for a Staff Nurse); on an interim date it is what a
    learner should have done so far — without this an interim report charges
    learners for visits that were not due yet.

    A Staff Nurse's visits happen during the hospital stay, right after each
    adoption, so hers fall due across the adoption window alone.
    """
    training, tranche2 = cal["training_date"], cal["tranche2_start"]
    if training is None or tranche2 is None:
        return {1: 1.0, 2: 1.0}
    if nurse:
        spans = {1: (training, tranche2),
                 2: (tranche2, tranche2 + timedelta(days=R.TRANCHE2_WINDOW_DAYS))}
    else:
        spans = {
            1: (training, tranche2 + timedelta(days=R.FOLLOW_UP_DAYS[1])),
            2: (tranche2, tranche2 + timedelta(days=R.TRANCHE2_WINDOW_DAYS + R.FOLLOW_UP_DAYS[2])),
        }
    out = {}
    for t, (start, end) in spans.items():
        span = max(1, (end - start).days)
        out[t] = round(max(0.0, min(1.0, (as_of - start).days / span)), 3)
    return out


# ── Adoptions ──────────────────────────────────────────────────────────────


@dataclass
class Adoption:
    mother: MotherIn
    children: List[ChildIn]
    anchor: Optional[date]          # the adoption date
    type: str
    tranche: int
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


def adoptions_of(data: MasdData, tranche2: Optional[date], as_of: date) -> List[Adoption]:
    kids: Dict[int, List[ChildIn]] = defaultdict(list)
    for c in data.children:
        kids[c.mother_id].append(c)
    out: List[Adoption] = []
    for m in data.mothers:
        anchor = m.adoption_date or m.created_on
        if anchor is None or anchor > as_of:
            continue
        mine = kids.get(m.id, [])
        atype, age = classify(m, mine)
        tranche = 2 if (tranche2 is not None and anchor >= tranche2) else 1
        out.append(Adoption(m, mine, anchor, atype, tranche, age))
    return out


# ── Activity half ──────────────────────────────────────────────────────────


def _learner_rows(data: MasdData, adoptions: List[Adoption], acts: List[ActivityIn],
                  as_of: date, tranches: int, due: Dict[bool, Dict[int, float]]) -> List[Dict[str, Any]]:
    by_learner_adopt: Dict[int, List[Adoption]] = defaultdict(list)
    for a in adoptions:
        if a.mother.learner_id is not None:
            by_learner_adopt[a.mother.learner_id].append(a)
    counts: Dict[int, Counter] = defaultdict(Counter)
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
    for a in adoptions:   # registering a mother is activity too
        lid = a.mother.learner_id
        if lid is not None and a.anchor and a.anchor > last_seen.get(lid, date.min):
            last_seen[lid] = a.anchor

    rows = []
    for l in data.learners:
        group = R.role_group(l.role)
        is_nurse = group == R.NURSING_STAFF
        mine = by_learner_adopt.get(l.id, [])
        mix = Counter(a.type for a in mine)
        ideal = {k: round(sum(R.ideal_for_tranche(is_nurse, t)[k] * due[is_nurse][t] for t in (1, 2)), 1)
                 for k in R.ACTIVITY_KEYS}
        target = R.adoption_target(tranches)
        acts_by = {k: counts[l.id][k] for k in R.ACTIVITY_KEYS}
        total_acts = sum(acts_by.values())
        ideal_total = round(sum(ideal.values()), 1)
        last = last_seen.get(l.id)
        rows.append({
            "id": l.id,
            "name": l.name,
            "email": l.email,
            "role": l.role,
            "role_group": group,
            "department": R.ROLE_GROUP_DEPARTMENT.get(group, R.HFW),
            "block": l.block or "Not assigned",
            "f2f": l.f2f,
            "trainer_role": l.trainer_role,
            "mtfl": bool(l.trainer_role),
            "is_nurse": is_nurse,
            "adoptions": {
                "anc": mix.get(R.ANC, 0), "pnc_lt5": mix.get(R.PNC_LT5, 0),
                "pnc_ge5": mix.get(R.PNC_GE5, 0), "unknown": mix.get(R.UNKNOWN, 0),
                "total": len(mine),
            },
            "target": target,
            "fulfilment_pct": _pct(len(mine), target),
            "activities": {**acts_by, "total": total_acts},
            "ideal": {**ideal, "total": ideal_total},
            "intensity_pct": _pct(total_acts, ideal_total),
            "subtype_pct": {k: _pct(acts_by[k], ideal[k]) for k in R.ACTIVITY_KEYS},
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
    ideal = round(sum(r["ideal"]["total"] for r in rows), 1)
    sub_acts = {k: sum(r["activities"][k] for r in rows) for k in R.ACTIVITY_KEYS}
    sub_ideal = {k: round(sum(r["ideal"][k] for r in rows), 1) for k in R.ACTIVITY_KEYS}
    nil = [r["nil_days"] for r in rows if r["nil_days"] is not None]
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
    """% below −2 SD at BV / AV / LV for each indicator, over the dyads with a
    value at that point."""
    out: Dict[str, Any] = {"n": len(dyads)}
    for ind in R.INDICATORS:
        entry: Dict[str, Any] = {}
        for p in ("bv", "av", "lv"):
            vals = [d.z[p][ind] for d in dyads if d.z.get(p, {}).get(ind) is not None]
            entry[p] = _pct(sum(1 for v in vals if v < R.MALNUTRITION_Z), len(vals))
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


def compute(data: MasdData, as_of: date) -> Dict[str, Any]:
    cal = calendar(data)
    tranche2 = cal["tranche2_start"]
    tranches = 1 if (tranche2 is not None and as_of < tranche2) else 2
    due = {False: expected_fraction(cal, as_of), True: expected_fraction(cal, as_of, nurse=True)}
    adoptions = adoptions_of(data, tranche2, as_of)
    acts = [a for a in data.activities if a.on <= as_of]

    rows = _learner_rows(data, adoptions, acts, as_of, tranches, due)
    f2f_rows = [r for r in rows if r["f2f"]]
    f2f_ids = {r["id"] for r in f2f_rows}
    non_f2f_cases = sum(r["adoptions"]["total"] for r in rows if not r["f2f"])

    blocks = _group_by(f2f_rows, "block")
    roles = _group_by(f2f_rows, "role_group", R.ROLE_GROUPS)
    wcd = _aggregate([r for r in f2f_rows if r["department"] == R.WCD], R.WCD, "WCD subtotal")
    hfw = _aggregate([r for r in f2f_rows if r["department"] == R.HFW], R.HFW, "HFW subtotal")
    total = _aggregate(f2f_rows, "total", "Total")

    # Learners across blocks × cadres (counts), the report's distribution table.
    distribution: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in f2f_rows:
        distribution[r["block"]][r["role_group"]] += 1

    tranche_mix = Counter((a.tranche, a.type) for a in adoptions if a.mother.learner_id in f2f_ids)

    report = {
        "project": data.project,
        "as_of": as_of.isoformat(),
        "calendar": {
            "training_date": cal["training_date"].isoformat() if cal["training_date"] else None,
            "tranche2_start": tranche2.isoformat() if tranche2 else None,
            "inferred": cal["inferred"],
            "saved": data.calendar_saved,
            "tranches_in_force": tranches,
            "due_fraction": {"t1": due[False][1], "t2": due[False][2]},
            "prorated": any(v < 1 for d in due.values() for v in d.values()),
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
        "departments": [wcd, hfw, total],
        "distribution": {b: dict(v) for b, v in distribution.items()},
        "learners": rows,
        "weekly": _weekly(acts, adoptions, f2f_ids, cal["training_date"], as_of),
        "attention": _attention(f2f_rows),
        "outcomes": _outcomes(data, adoptions, as_of),
        "rules": {
            "ideal_per_adoption": R.IDEAL_PER_ADOPTION,
            "ideal_learner": {"standard": R.ideal_for_learner(False), "nurse": R.ideal_for_learner(True)},
            "target": R.adoption_target(2),
            "five_months_days": R.FIVE_MONTHS_DAYS,
            "compliance": R.COMPLIANCE,
            "min_follow_up_months": R.MIN_FOLLOW_UP_MONTHS,
            "exclusion_reasons": R.EXCLUSION_REASONS,
        },
    }
    return report


def comparison(then: Dict[str, Any], now: Dict[str, Any]) -> Dict[str, Any]:
    """Then vs now, the report's "progress since the last meeting" slides."""
    def lite(r: Dict[str, Any]) -> Dict[str, Any]:
        s = r["summary"]
        nurses = next((g for g in r["roles"] if g["key"] == R.NURSING_STAFF), None)
        bands = r["outcomes"]["prevalence"]["bands"]
        return {
            "as_of": r["as_of"],
            "tranches_in_force": r["calendar"]["tranches_in_force"],
            "learners": s["learners"],
            "target_per_learner": R.adoption_target(r["calendar"]["tranches_in_force"]),
            "adoptions": s["adoptions"],
            "target": s["target"],
            "fulfilment_pct": s["fulfilment_pct"],
            "intensity_pct": s["intensity_pct"],
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
