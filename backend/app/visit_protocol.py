"""The visit protocol of November 2026 (LAP), as a pure planner.

docs/visit-protocol-2026-11.md is the rule book; this module follows it and
nothing else. No database, no clock: every function takes one adoption's
dates and the forms already submitted (`Case`) and answers

  * which forms belong to a visit on a given day      forms_at()
  * when the next visit is, and what it carries       plan()
  * the visit days themselves                         schedule(), visit_slot()
  * the breastfeeding rule                            bf_status(), hidden_bf_questions()
  * the mother's protein form                         pf_status()
  * the not-breastfeeding counselling and drop-out    feeding_state()
  * the delivery question from 35 weeks               ask_delivery()
  * why each form is on a visit                       form_reasons()
  * whether a CF form may be filled today             cf_gate()
  * the visits as a line of done / missed / due       timeline()
  * visits and forms expected by today, and done      progress()

app/visit_plan.py turns database rows into a `Case`; the worker app (Today,
the baby page, the visit flow) and the care alerts read the answers from there
when a project runs the "lap_2026_11" protocol. Projects on "lap_2025" keep
the older LAP tables in app/masd/rules.py.

Form codes are the app's: mf (mother form), chf (child form), gm (check
growth, CG), bf, cf, anc (antenatal, AF), protein (PF).
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta
from typing import Any, Dict, FrozenSet, Iterable, List, Optional, Sequence, Tuple

# ── Protocols and their project settings ───────────────────────────────────

LAP_2025 = "lap_2025"          # the older LAP tables (app/masd/rules.py)
LAP_2026_11 = "lap_2026_11"    # this module
PROTOCOLS = (LAP_2025, LAP_2026_11)
LEGACY_SPLIT_DAYS = 150        # "5 months"
NEW_SPLIT_DAYS = 180           # "6 months" — the change applies to new projects

# ── The spec's numbers ─────────────────────────────────────────────────────

TOLERANCE_DAYS = 2             # a visit within ±2 days of its due day counts for it
ANC_EVERY_DAYS = 15
PREGNANCY_DAYS = 280           # LMP → expected delivery
DELIVERY_QUESTION_FROM_DAYS = 35 * 7
B2_DAYS = (0, 1, 2, 3, 5, 7, 10, 12, 14, 21, 28, 42)
B2_THEN_EVERY_DAYS = 30
CF_SWITCH_AGE_DAYS = 180       # the first visit at this age or older is "CF day 0"
CF_DAYS = (0, 5, 10, 15, 30, 45, 60)
MONTHLY_DAYS = 30
QUARTERLY_DAYS = 90
ONE_YEAR_DAYS = 365
B3_BF_ONLY_DAYS = (1, 2, 3)
BF_FORMS_TARGET = 5
WFA_P30_Z = -0.52              # the 30th percentile of weight-for-age
PF_EVERY_DAYS = 15
PF_MIN_GAP_DAYS = 10
PF_HQ_G = 40.0
PF_TOTAL_G = 80.0
DROP_OUT_AFTER_VISITS = 2

MF, CHF, CG, BF, CF, AF, PF = "mf", "chf", "gm", "bf", "cf", "anc", "protein"
FORM_ORDER = (MF, CHF, CG, BF, CF, AF, PF)
CHILD_FORMS = (CG, BF, CF)
MOTHER_FORMS = (AF, PF)
DELIVERY_PATH = (CHF, CG, BF, PF)       # "Has the delivery happened?" — Yes
NO_DELIVERY_PATH = (AF, PF)             # … No

ANC, PNC_LT, PNC_GE = "anc", "pnc_lt", "pnc_ge"
_REGISTRATION = {
    ANC: (MF, AF, PF),
    PNC_LT: (MF, CHF, CG, BF, PF),
    PNC_GE: (MF, CHF, CG, BF, CF, PF),
}
_SEARCH_AHEAD_DAYS = 400       # how far past a date the visit days are laid out
_LATER_MAX = 8


# ── Inputs ─────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Form:
    """One submitted form. Only the fields its rule reads are filled."""
    code: str
    on: date
    green: FrozenSet[str] = frozenset()   # BF: question ids answered green
    all_green: Optional[bool] = None      # BF: answered, and no red answer
    total_g: Optional[float] = None       # PF: total protein, past 24 hours (g)
    hq_g: Optional[float] = None          # PF: high-quality protein, past 24 hours (g)
    waz: Optional[float] = None           # CG: weight-for-age z-score
    breastfed: Optional[bool] = None      # CG: breastfed in the past 24 hours


@dataclass(frozen=True)
class Case:
    """One adoption: the mother and one baby (none while she is pregnant)."""
    adopted: date                          # the adoption visit, day 0
    lmp: Optional[date] = None
    edd: Optional[date] = None
    dob: Optional[date] = None             # the baby, once born and registered
    child_adopted: Optional[date] = None   # the baby's own adoption date
    forms: Tuple[Form, ...] = ()           # the mother's (anc, protein) and this baby's (gm, bf, cf)
    counselled_on: Optional[date] = None   # counselled to restart breastfeeding
    dropped_out_on: Optional[date] = None
    pnc_split_days: int = NEW_SPLIT_DAYS
    mother_forms_here: bool = True         # twins: the protein form rides on one baby only


@dataclass(frozen=True)
class Slot:
    """One planned visit."""
    day: int                 # days from its segment's anchor
    due_on: date
    segment: str             # "anc" | "b2" | "cf" (bucket 2 after CF day 0) | "b3"
    cf_no: Optional[int] = None   # CF-1, CF-2, … at this visit; None = no CF form


# ── Small helpers ──────────────────────────────────────────────────────────

def ordered(codes: Iterable[str]) -> List[str]:
    """Forms in the order a visit fills them: measure first, then feeding, then the mother."""
    unique = set(codes)
    return [c for c in FORM_ORDER if c in unique]


def registration_forms(bucket_name: str) -> List[str]:
    """Day 0 of each bucket, in order."""
    return list(_REGISTRATION[bucket_name])


def _iso(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d else None


def _of(case: Case, *codes: str, before: Optional[date] = None, upto: Optional[date] = None) -> List[Form]:
    out = [f for f in case.forms if f.code in codes
           and (before is None or f.on < before) and (upto is None or f.on <= upto)]
    return sorted(out, key=lambda f: f.on)


def _age(case: Case, on: date) -> Optional[int]:
    return (on - case.dob).days if case.dob else None


def _change(last: Optional[float], prev: Optional[float]) -> Optional[float]:
    if last is None or prev is None:
        return None
    return round(last - prev, 3)


# ── Buckets and phases ─────────────────────────────────────────────────────

def _child_day0(case: Case) -> date:
    if case.child_adopted and case.dob and case.child_adopted >= case.dob:
        return case.child_adopted
    return case.adopted


def bucket(case: Case) -> str:
    """The adoption type: ANC (adopted while pregnant), or PNC split by the
    baby's age at adoption. An ANC adoption stays ANC after the birth."""
    if case.dob is None or case.dob > case.adopted:
        return ANC
    age = (_child_day0(case) - case.dob).days
    return PNC_LT if age < case.pnc_split_days else PNC_GE


def _pnc_rules(case: Case) -> str:
    """Which PNC rules apply: a mother adopted in pregnancy moves to bucket 2."""
    return PNC_GE if bucket(case) == PNC_GE else PNC_LT


def pnc_anchor(case: Case) -> Optional[date]:
    """Day 0 of the baby's visits: the adoption visit, or for a mother adopted
    in pregnancy the first visit after delivery."""
    if case.dob is None:
        return None
    if bucket(case) != ANC:
        return _child_day0(case)
    if case.child_adopted and case.child_adopted >= case.dob:
        return case.child_adopted
    firsts = [f.on for f in case.forms if f.code in CHILD_FORMS and f.on >= case.dob]
    return min(firsts) if firsts else case.dob


def _phase_at(case: Case, on: date) -> str:
    anchor = pnc_anchor(case)
    return "pnc" if anchor is not None and anchor <= on else "anc"


def phase(case: Case) -> str:
    """"pnc" once the baby is registered, else "anc"."""
    return "pnc" if case.dob is not None else "anc"


def gestation_days(case: Case, on: date) -> Optional[int]:
    if case.lmp:
        return (on - case.lmp).days
    if case.edd:
        return (on - (case.edd - timedelta(days=PREGNANCY_DAYS))).days
    return None


def ask_delivery(case: Case, on: date) -> bool:
    """From 35 weeks every pregnancy visit first asks "Has the delivery
    happened?" — and always when the pregnancy cannot be dated."""
    if _phase_at(case, on) != "anc":
        return False
    days = gestation_days(case, on)
    return days is None or days >= DELIVERY_QUESTION_FROM_DAYS


# ── Visit days ─────────────────────────────────────────────────────────────

def _anc_slots(anchor: date, upto: date) -> List[Slot]:
    out, n = [], 0
    while n == 0 or anchor + timedelta(days=n) <= upto:
        out.append(Slot(n, anchor + timedelta(days=n), "anc"))
        n += ANC_EVERY_DAYS
    return out


def _b2_slots(anchor: date, upto: date) -> List[Slot]:
    out = [Slot(n, anchor + timedelta(days=n), "b2") for n in B2_DAYS]
    n = B2_DAYS[-1]
    while anchor + timedelta(days=n + B2_THEN_EVERY_DAYS) <= upto:
        n += B2_THEN_EVERY_DAYS
        out.append(Slot(n, anchor + timedelta(days=n), "b2"))
    return out


def _cf_slots(anchor: date, dob: Optional[date], upto: date, segment: str,
              extra_days: Sequence[int] = ()) -> List[Slot]:
    """CF-1 … CF-7 on the CF days, then monthly until the first birthday and
    every three months after it (bucket 3 adds its breastfeeding days 1–3)."""
    out = []
    for n in sorted(set(CF_DAYS) | set(extra_days)):
        cf_no = CF_DAYS.index(n) + 1 if n in CF_DAYS else None
        out.append(Slot(n, anchor + timedelta(days=n), segment, cf_no))
    n, cf_no = CF_DAYS[-1], len(CF_DAYS)
    while True:
        step = MONTHLY_DAYS
        if dob is not None and (anchor + timedelta(days=n + MONTHLY_DAYS) - dob).days >= ONE_YEAR_DAYS:
            step = QUARTERLY_DAYS
        if anchor + timedelta(days=n + step) > upto:
            break
        n, cf_no = n + step, cf_no + 1
        out.append(Slot(n, anchor + timedelta(days=n), segment, cf_no))
    return out


def _cf_day0(case: Case, visits: Sequence[date], b2: Sequence[Slot]) -> Optional[date]:
    """Bucket 2: the first visit at 180 days or older — done, or planned."""
    if case.dob is None:
        return None
    done = [v for v in visits if _age(case, v) >= CF_SWITCH_AGE_DAYS]
    if done:
        return done[0]
    last = visits[-1] if visits else None
    planned = [s.due_on for s in b2
               if (last is None or s.due_on > last) and _age(case, s.due_on) >= CF_SWITCH_AGE_DAYS]
    return planned[0] if planned else None


def _visits(case: Case, upto: date) -> List[date]:
    """The visit days so far: any child form in the baby's phase, the
    antenatal or protein form in pregnancy."""
    if _phase_at(case, upto) == "pnc":
        start = pnc_anchor(case)
        days = {f.on for f in case.forms if f.code in CHILD_FORMS and start <= f.on <= upto}
    else:
        days = {f.on for f in case.forms if f.code in MOTHER_FORMS and case.adopted <= f.on <= upto
                and (case.dob is None or f.on < pnc_anchor(case))}
    return sorted(days)


def _layout(case: Case, upto: date, visits: Sequence[date]) -> Tuple[List[Slot], Optional[date]]:
    """(the visit days up to `upto`, the CF day-0 boundary for bucket 2)."""
    if _phase_at(case, upto) == "anc":
        return _anc_slots(case.adopted, upto), None
    anchor = pnc_anchor(case)
    if _pnc_rules(case) == PNC_GE:
        return _cf_slots(anchor, case.dob, upto, "b3", B3_BF_ONLY_DAYS), None
    far = max(upto, case.dob + timedelta(days=CF_SWITCH_AGE_DAYS + B2_THEN_EVERY_DAYS + 1))
    b2 = _b2_slots(anchor, far)
    c0 = _cf_day0(case, visits, b2)
    if c0 is None:
        return [s for s in b2 if s.due_on <= upto], None
    return [s for s in b2 if s.due_on < c0] + _cf_slots(c0, case.dob, upto, "cf"), c0


def schedule(case: Case, upto: date) -> List[Slot]:
    """The visit days of the current phase, up to `upto`."""
    return [s for s in _layout(case, upto, _visits(case, upto))[0] if s.due_on <= upto]


def _slot_for(slots: Sequence[Slot], k: int, v: date, boundary: Optional[date]) -> Optional[int]:
    """The visit day a visit on `v` counts for, after slot `k`: the nearest
    within ±2 days (the earlier on a tie); else the latest one missed; else none
    (a visit more than two days early is an extra visit)."""
    rest = [j for j in range(k + 1, len(slots))
            if boundary is None or (slots[j].due_on >= boundary) == (v >= boundary)]
    near = [j for j in rest if abs((slots[j].due_on - v).days) <= TOLERANCE_DAYS]
    if near:
        return min(near, key=lambda j: (abs((slots[j].due_on - v).days), j))
    late = [j for j in rest if slots[j].due_on < v]
    return late[-1] if late else None


def _assign(slots: Sequence[Slot], visits: Sequence[date], boundary: Optional[date]) -> List[Optional[int]]:
    out: List[Optional[int]] = []
    k = -1
    for v in visits:
        j = _slot_for(slots, k, v, boundary)
        out.append(j)
        if j is not None:
            k = j
    return out


def _matched(case: Case, on: date, extra_days: int = 0) -> Tuple[List[Slot], List[date], List[Optional[int]], Optional[date]]:
    visits = sorted(set(_visits(case, on)))
    slots, boundary = _layout(case, on + timedelta(days=_SEARCH_AHEAD_DAYS + extra_days), visits)
    return slots, visits, _assign(slots, visits, boundary), boundary


def visit_slot(case: Case, on: date) -> Optional[Slot]:
    """The visit day a visit on `on` counts for (None: an extra visit)."""
    visits = sorted(set(_visits(case, on)) | {on})
    slots, boundary = _layout(case, on + timedelta(days=_SEARCH_AHEAD_DAYS), visits)
    j = _assign(slots, visits, boundary)[-1]
    return slots[j] if j is not None else None


# ── Breastfeeding ──────────────────────────────────────────────────────────

def _breastfeeding_at(case: Case, on: date) -> bool:
    said = [f for f in _of(case, CG, upto=on) if f.breastfed is not None]
    return said[-1].breastfed if said else True


def _may_stop(bfs: Sequence[Form], last: Optional[float], prev: Optional[float]) -> bool:
    change = _change(last, prev)
    return (len(bfs) >= 2 and bfs[-1].all_green is True and bfs[-2].all_green is True
            and last is not None and last >= WFA_P30_Z and change is not None and change >= 0)


def _falling(last: Optional[float], prev: Optional[float]) -> bool:
    change = _change(last, prev)
    return last is not None and (last < WFA_P30_Z or (change is not None and change < 0))


def _bf_rule_state(case: Case, on: date) -> Tuple[bool, bool, Optional[date]]:
    """(BF due by the bucket-2 rule at a visit on `on`, it was stopped before,
    the day it last reopened).

    A stop is decided at the end of a visit and holds from the next one; a
    growth check that falls below the 30th percentile or turns negative
    reopens BF at once — the check is filled first, so at the same visit."""
    events = sorted({f.on for f in _of(case, CG, BF, before=on)})
    active, stopped_once = True, False
    reopened_on: Optional[date] = None
    bfs: List[Form] = []
    last = prev = None
    for day in events:
        for f in case.forms:
            if f.on == day and f.code == CG and f.waz is not None:
                prev, last = last, f.waz
                if not active and _falling(last, prev):
                    active, reopened_on = True, day
        bfs.extend(f for f in _of(case, BF) if f.on == day)
        if active and _may_stop(bfs, last, prev):
            active, stopped_once = False, True
    for f in case.forms:
        if f.on == on and f.code == CG and f.waz is not None:
            prev, last = last, f.waz
            if not active and _falling(last, prev):
                active, reopened_on = True, on
    return active, stopped_once, reopened_on


def _bf_rule(case: Case, on: date) -> Tuple[bool, bool]:
    """(BF due by the bucket-2 rule at a visit on `on`, it was stopped before)."""
    active, stopped_once, _reopened = _bf_rule_state(case, on)
    return active, stopped_once


def bf_status(case: Case, on: date) -> Dict[str, Any]:
    """Whether a visit on `on` carries the breastfeeding form, and why."""
    count = len(_of(case, BF, before=on))
    if _phase_at(case, on) != "pnc":
        return {"due": False, "status": "not_applicable", "count": count}
    if not _breastfeeding_at(case, on):
        return {"due": False, "status": "not_breastfeeding", "count": count}
    age = _age(case, on)
    if _pnc_rules(case) == PNC_GE or (age is not None and age >= CF_SWITCH_AGE_DAYS):
        due = count < BF_FORMS_TARGET              # until five are done
        return {"due": due, "status": "active" if due else "done", "count": count}
    active, stopped_once = _bf_rule(case, on)
    status = ("reopened" if stopped_once else "active") if active else "stopped"
    return {"due": active, "status": status, "count": count}


def hidden_bf_questions(case: Case, on: Optional[date] = None) -> List[str]:
    """Points drop out (bucket 2): a question answered green in two back-to-back
    BF forms is not shown in later BF forms.

    When BF reopens (the baby fell below the 30th percentile, or the z-score
    turned negative, after BF had stopped) every point comes back: only the
    BF forms filled since the reopening count towards dropping one out again
    (decided with the team, 14 Nov 2026)."""
    if _pnc_rules(case) == PNC_GE or case.dob is None:
        return []
    bfs = _of(case, BF, upto=on)
    if on is not None:
        reopened_on = _bf_rule_state(case, on + timedelta(days=1))[2]
        if reopened_on is not None:
            bfs = [f for f in bfs if f.on >= reopened_on]
    hidden: set = set()
    for a, b in zip(bfs, bfs[1:]):
        hidden |= set(a.green) & set(b.green)
    return sorted(hidden)


def feeding_state(case: Case) -> Dict[str, Any]:
    """The mother not breastfeeding: counsel her; still stopped at two visits
    after the counselling, the adoption may be confirmed as a drop-out
    (bucket 2 until 180 days; elsewhere BF just stops)."""
    out = {"state": "ok", "since": None, "counselled_on": None, "visits_after": 0}
    if case.dob is None:
        return {**out, "state": "not_applicable"}
    said = [f for f in _of(case, CG) if f.breastfed is not None]
    if not said or said[-1].breastfed:
        return out
    run: List[Form] = []
    for f in reversed(said):
        if f.breastfed:
            break
        run.insert(0, f)
    since = run[0].on
    out["since"] = since.isoformat()
    if _pnc_rules(case) == PNC_GE or _age(case, since) >= CF_SWITCH_AGE_DAYS:
        return {**out, "state": "not_breastfeeding"}
    if case.counselled_on is None or case.counselled_on < since:
        return {**out, "state": "counsel"}
    after = [f for f in run if f.on > case.counselled_on]
    state = "can_drop_out" if len(after) >= DROP_OUT_AFTER_VISITS else "counselled"
    return {**out, "state": state, "counselled_on": case.counselled_on.isoformat(), "visits_after": len(after)}


# ── The mother's protein form ──────────────────────────────────────────────

def _qualifies(f: Form) -> bool:
    return (f.hq_g or 0) >= PF_HQ_G and (f.total_g or 0) >= PF_TOTAL_G


def _pnc_pfs(case: Case, before: date) -> List[Form]:
    start = pnc_anchor(case)
    return [f for f in _of(case, PF, before=before) if start is not None and f.on >= start]


def _pf_slot(case: Case, last: date, on: date) -> Optional[Slot]:
    """The child visit nearest 15 days after the last PF, at least 10 days on."""
    slots = _matched(case, on)[0]
    target = last + timedelta(days=PF_EVERY_DAYS)
    ok = [s for s in slots if s.due_on >= last + timedelta(days=PF_MIN_GAP_DAYS)]
    return min(ok, key=lambda s: (abs((s.due_on - target).days), s.due_on)) if ok else None


def pf_status(case: Case, on: date) -> Dict[str, Any]:
    """The protein form after the birth: stopped for good after two
    consecutive forms each with ≥40 g high-quality and ≥80 g total protein."""
    pfs = _pnc_pfs(case, on)
    stopped = any(_qualifies(a) and _qualifies(b) for a, b in zip(pfs, pfs[1:]))
    nxt = None
    if not stopped and pfs:
        slot = _pf_slot(case, pfs[-1].on, on)
        nxt = slot.due_on if slot else None
    return {"stopped": stopped, "last_on": _iso(pfs[-1].on) if pfs else None, "next_on": _iso(nxt)}


def _pf_due(case: Case, on: date, slot: Optional[Slot]) -> bool:
    pfs = _pnc_pfs(case, on)
    if any(_qualifies(a) and _qualifies(b) for a, b in zip(pfs, pfs[1:])):
        return False
    if not pfs:
        return True                    # the first: at the adoption visit (or the first after delivery)
    last = pfs[-1].on
    if (on - last).days < PF_MIN_GAP_DAYS:
        return False
    target = _pf_slot(case, last, on)
    if target is None:
        return True
    return (slot.due_on if slot is not None else on) >= target.due_on


# ── A visit's forms ────────────────────────────────────────────────────────

def forms_at(case: Case, on: date) -> List[str]:
    """The forms of a visit on `on`, in order, from what was submitted before
    it (and the growth check of the same visit, which is filled first)."""
    if case.dropped_out_on is not None and on >= case.dropped_out_on:
        return []
    slot = visit_slot(case, on)
    if _phase_at(case, on) == "anc":
        return [AF, PF] if slot is not None else []
    forms = [CG]
    if bf_status(case, on)["due"]:
        forms.append(BF)
    if slot is not None and slot.cf_no is not None:
        forms.append(CF)
    if case.mother_forms_here and _pf_due(case, on, slot):
        forms.append(PF)
    return ordered(forms)


# ── The plan for a day ─────────────────────────────────────────────────────

def _done_on(case: Case, on: date) -> List[str]:
    codes = MOTHER_FORMS if _phase_at(case, on) == "anc" else CHILD_FORMS + ((PF,) if case.mother_forms_here else ())
    return ordered(f.code for f in case.forms if f.on == on and f.code in codes)


def _upcoming(case: Case, after: date) -> Optional[Slot]:
    """The first visit day not yet done, after the visits up to `after`."""
    slots, _visits_, idx, _b = _matched(case, after)
    k = max((j for j in idx if j is not None), default=-1)
    return next((slots[j] for j in range(k + 1, len(slots)) if slots[j].due_on > after), None)


def _visit_dict(case: Case, on: date, due_on: date, slot: Optional[Slot], forms: List[str],
                late_days: int = 0, unfinished: bool = False) -> Dict[str, Any]:
    return {"due_on": due_on.isoformat(), "late_days": late_days, "forms": forms,
            "day": slot.day if slot else None, "cf_no": slot.cf_no if slot else None,
            "ask_delivery": ask_delivery(case, on) and not unfinished, "unfinished": unfinished}


def _next_visit(case: Case, as_of: date, today: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[date]]:
    if today["visited"] and today["pending"]:
        return _visit_dict(case, as_of, as_of, visit_slot(case, as_of), today["forms"], unfinished=True), as_of
    slots, visits, idx, boundary = _matched(case, as_of)
    k = max((j for j in idx if j is not None), default=-1)
    # While CF day 0 is only planned, the CF days after it depend on when it
    # is made: none of them can be overdue yet.
    cap = boundary if boundary is not None and boundary not in visits else None
    overdue = [j for j in range(k + 1, len(slots))
               if slots[j].due_on <= as_of and (cap is None or slots[j].due_on <= cap)]
    if overdue and not today["visited"]:
        missed, shown = slots[overdue[-1]], visit_slot(case, as_of)
        due = missed.due_on
        if shown is not None and shown.due_on >= as_of and (shown.segment, shown.day) != (missed.segment, missed.day):
            # Lateness describes the visit shown. A visit today counts for a
            # day not yet past — CF day 0 at the first visit at 180 days, or
            # a due day within ±2 days — and carries that day's forms, not the
            # missed one's: it is due today. (A missed planned CF day 0 is the
            # same visit as today's CF day 0, so it stays late.)
            due = as_of
        return _visit_dict(case, as_of, due, shown, today["forms"], late_days=(as_of - due).days), as_of
    slot = next((slots[j] for j in range(k + 1, len(slots)) if slots[j].due_on > as_of), None)
    if slot is None:
        return None, None
    return _visit_dict(case, slot.due_on, slot.due_on, slot, forms_at(case, slot.due_on)), slot.due_on


def _assume_done(case: Case, on: date, forms: Sequence[str]) -> Case:
    """The case as if a visit on `on` filled `forms` (with no findings)."""
    return replace(case, forms=case.forms + tuple(Form(code, on) for code in forms if code in CHILD_FORMS + MOTHER_FORMS))


def _later(case: Case, on: date, forms: Sequence[str], until: date) -> List[Dict[str, Any]]:
    """The visits after the next one, up to `until`, assuming each is made on its day."""
    out: List[Dict[str, Any]] = []
    sim = _assume_done(case, on, forms)
    while len(out) < _LATER_MAX:
        slot = _upcoming(sim, on)
        if slot is None or slot.due_on > until:
            break
        on = slot.due_on
        visit_forms = forms_at(sim, on)
        out.append({"due_on": on.isoformat(), "forms": visit_forms, "day": slot.day, "cf_no": slot.cf_no,
                    "ask_delivery": ask_delivery(sim, on)})
        sim = _assume_done(sim, on, visit_forms)
    return out


def plan(case: Case, as_of: date, horizon_days: int = 7) -> Dict[str, Any]:
    """One adoption on `as_of`: what a visit today is, the next visit to make,
    the visits after it within `horizon_days`, and the rules' state."""
    ph = _phase_at(case, as_of)
    anchor = pnc_anchor(case) if ph == "pnc" else case.adopted
    out: Dict[str, Any] = {
        "bucket": bucket(case), "phase": ph, "anchor": _iso(anchor),
        "dropped_out": case.dropped_out_on is not None and case.dropped_out_on <= as_of,
        "feeding": feeding_state(case),
    }
    if out["dropped_out"]:
        return {**out, "today": {"visited": False, "forms": [], "done": [], "pending": []},
                "next": None, "later": [],
                "bf": {"status": "not_applicable", "count": len(_of(case, BF, upto=as_of)), "hidden_questions": []},
                "pf": {"stopped": False, "last_on": None, "next_on": None}}
    forms = forms_at(case, as_of)
    done = _done_on(case, as_of)
    visited = as_of in _visits(case, as_of)
    today = {"visited": visited, "forms": forms, "done": done, "pending": [f for f in forms if f not in done]}
    nxt, nxt_on = _next_visit(case, as_of, today)
    later: List[Dict[str, Any]] = []
    if nxt is not None:
        start = max(as_of, date.fromisoformat(nxt["due_on"]))
        later = _later(case, start, nxt["forms"], as_of + timedelta(days=horizon_days))
    bf_on = nxt_on or as_of
    bf_now = bf_status(case, bf_on)
    return {**out, "today": today, "next": nxt, "later": later,
            "bf": {"status": bf_now["status"], "count": len(_of(case, BF, upto=as_of)),
                   "hidden_questions": hidden_bf_questions(case, as_of)},
            "pf": pf_status(case, as_of + timedelta(days=1))}


# ── Why each form is on a visit ────────────────────────────────────────────

B3_BF_DAYS = (0, 1, 2, 3, 5)   # bucket 3: BF-1 … BF-5 on these visit days


def form_reasons(case: Case, on: date, forms: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    """For each form of a visit on `on`, why it is there — the tag the visit
    card shows beside it ("Every visit", "Catch-up 4 of 5", "CF-1"):

      gm       {"kind": "every_visit"}
      bf       {"kind": "count" | "catch_up", "n", "of"}   bucket 3, or bucket 2 from 180 days
               {"kind": "until_good" | "reopened", "n"}    bucket 2 under 180 days
      cf       {"kind": "cf", "n"}
      protein  {"kind": "first" | "every_15"}
      anc      {"kind": "every_15"}
    """
    slot = visit_slot(case, on)
    out: Dict[str, Dict[str, Any]] = {}
    for code in forms:
        if code == CG:
            out[code] = {"kind": "every_visit"}
        elif code == BF:
            n = len(_of(case, BF, before=on)) + 1
            age = _age(case, on)
            if _pnc_rules(case) == PNC_GE:
                planned = B3_BF_DAYS[min(n, len(B3_BF_DAYS)) - 1]
                late = slot is None or slot.day > planned
                out[code] = {"kind": "catch_up" if late else "count", "n": n, "of": BF_FORMS_TARGET}
            elif age is not None and age >= CF_SWITCH_AGE_DAYS:
                # Bucket 2 from 180 days: only the forms still short of five.
                out[code] = {"kind": "catch_up", "n": n, "of": BF_FORMS_TARGET}
            else:
                status = bf_status(case, on)["status"]
                out[code] = {"kind": "reopened" if status == "reopened" else "until_good", "n": n}
        elif code == CF:
            n = slot.cf_no if slot is not None and slot.cf_no is not None else len(_of(case, CF, before=on)) + 1
            out[code] = {"kind": "cf", "n": n}
        elif code == PF:
            done = _pnc_pfs(case, on) if _phase_at(case, on) == "pnc" else _of(case, PF, before=on)
            out[code] = {"kind": "every_15" if done else "first"}
        elif code == AF:
            out[code] = {"kind": "every_15"}
    return out


# ── Complementary feeding: not before its day ─────────────────────────────

def _slot_of_visits(slots: Sequence[Slot], visits: Sequence[date], idx: Sequence[Optional[int]]) -> Dict[date, Slot]:
    return {v: slots[j] for v, j in zip(visits, idx) if j is not None}


def cf_gate(case: Case, as_of: date) -> Dict[str, Any]:
    """Whether a complementary feeding form may be filled today. The app does
    not allow a CF before its scheduled day (docs/visit-protocol-2026-11.md):
    opened too early, the learner is told when the last one was and when the
    next one is.

      allowed   a CF is due at a visit today
      reason    None | "done_today" | "too_early" | "not_started" | "not_applicable"
      last_on / last_day / last_no     the latest CF form
      next_on / next_day / next_no     the next CF visit day
    """
    out: Dict[str, Any] = {"allowed": False, "reason": "not_applicable", "count": 0,
                           "last_on": None, "last_day": None, "last_no": None,
                           "next_on": None, "next_day": None, "next_no": None}
    if case.dob is None or _phase_at(case, as_of) != "pnc":
        return out
    if case.dropped_out_on is not None and as_of >= case.dropped_out_on:
        return out
    cfs = _of(case, CF, upto=as_of)
    slots, visits, idx, _boundary = _matched(case, as_of)
    by_visit = _slot_of_visits(slots, visits, idx)
    out["count"] = len(cfs)
    if cfs:
        last = cfs[-1]
        s = by_visit.get(last.on)
        out.update(last_on=last.on.isoformat(), last_day=s.day if s else None,
                   last_no=s.cf_no if s and s.cf_no else len(cfs))
    if any(f.on == as_of for f in cfs):
        return {**out, "reason": "done_today"}
    if CF in forms_at(case, as_of):
        return {**out, "allowed": True, "reason": None}
    k = max((j for j in idx if j is not None), default=-1)
    nxt = next((s for s in slots[k + 1:] if s.cf_no is not None and s.due_on > as_of), None)
    if nxt is not None:
        out.update(next_on=nxt.due_on.isoformat(), next_day=nxt.day, next_no=nxt.cf_no)
    return {**out, "reason": "too_early" if cfs else "not_started"}


# ── The visit line: done, missed, due ─────────────────────────────────────

_LINE_OF_SEGMENT = {"anc": "anc", "b2": "pnc", "cf": "cf", "b3": "b3"}


def _line_end(case: Case, as_of: date) -> date:
    """How far the visit line is drawn: to the expected delivery while
    pregnant; to the first birthday after it (one quarterly visit on, past it)."""
    if _phase_at(case, as_of) == "anc":
        edd = case.edd or (case.lmp + timedelta(days=PREGNANCY_DAYS) if case.lmp else None)
        return edd if edd and edd > as_of else as_of + timedelta(days=ANC_EVERY_DAYS)
    birthday = case.dob + timedelta(days=ONE_YEAR_DAYS)
    return birthday if birthday > as_of else as_of + timedelta(days=QUARTERLY_DAYS)


def timeline(case: Case, as_of: date) -> Dict[str, Any]:
    """The adoption's visits as a line of dots (the baby page): green done,
    red missed, outlined due now or next, grey later — and "Visit 8 of 17".

      {"lines": [{"key": "anc" | "pnc" | "cf" | "b3", "visits": [
                   {"n", "due_on", "day", "cf_no", "state", "done_on"}]}],
       "current": {"n", "total", "done", "missed", "state"} | None}
    """
    if case.dropped_out_on is not None and case.dropped_out_on <= as_of:
        return {"lines": [], "current": None}
    slots, visits, idx, boundary = _matched(case, as_of)
    end = _line_end(case, as_of)
    done = {j: visits[i] for i, j in enumerate(idx) if j is not None}
    k = max(done, default=-1)
    cap = boundary if boundary is not None and boundary not in visits else None
    overdue = [j for j in range(k + 1, len(slots))
               if slots[j].due_on <= as_of and (cap is None or slots[j].due_on <= cap)]
    if overdue:
        current = overdue[-1]
    else:
        current = next((j for j in range(k + 1, len(slots)) if slots[j].due_on > as_of), None)
    shown = [j for j, s in enumerate(slots) if s.due_on <= end or j in done or j == current]
    lines: List[Dict[str, Any]] = []
    counts = {"done": 0, "missed": 0}
    position = None
    for n, j in enumerate(shown, start=1):
        s = slots[j]
        if j in done:
            state = "done"
        elif j == current:
            state = "due" if s.due_on <= as_of else "next"
        elif j < (current if current is not None else len(slots)) and s.due_on <= as_of:
            state = "missed"
        else:
            state = "later"
        if state in counts:
            counts[state] += 1
        if j == current:
            position = n
        key = _LINE_OF_SEGMENT.get(s.segment, s.segment)
        if not lines or lines[-1]["key"] != key:
            lines.append({"key": key, "visits": []})
        lines[-1]["visits"].append({"n": n, "due_on": s.due_on.isoformat(), "day": s.day, "cf_no": s.cf_no,
                                    "state": state, "done_on": _iso(done.get(j))})
    current_out = None
    if position is not None:
        current_out = {"n": position, "total": len(shown), "done": counts["done"], "missed": counts["missed"],
                       "state": "due" if slots[current].due_on <= as_of else "next"}
    return {"lines": lines, "current": current_out}


# ── Progress: visits and forms expected by today ───────────────────────────

def _phase_counts(case: Case, as_of: date, codes: Sequence[str]) -> Dict[str, Any]:
    slots, visits, idx, _boundary = _matched(case, as_of)
    visit_of = {j: visits[i] for i, j in enumerate(idx) if j is not None}
    expected: Dict[str, int] = {c: 0 for c in codes}
    due_slots = made = on_time = 0
    last_pf: Optional[date] = None
    for j, s in enumerate(slots):
        if s.due_on > as_of:
            break
        if case.dropped_out_on is not None and s.due_on >= case.dropped_out_on:
            break
        due_slots += 1
        v = visit_of.get(j)
        if v is not None:
            made += 1
            on_time += abs((v - s.due_on).days) <= TOLERANCE_DAYS
        on = v if v is not None else s.due_on
        for code in forms_at(case, on):
            if code == PF:
                # Missed visits in a row would each still "owe" the protein
                # form; it is expected once per 15 days, never closer than 10.
                if last_pf is not None and (on - last_pf).days < PF_MIN_GAP_DAYS:
                    continue
                last_pf = on
            if code in expected:
                expected[code] += 1
    return {"due": due_slots, "made": made, "on_time": on_time, "expected": expected}


def progress(case: Case, as_of: date) -> Dict[str, Any]:
    """One adoption's work so far: visit days due by today, made, made on time
    (within ±2 days), and the forms those visits were to carry against the
    forms filled. A mother adopted in pregnancy counts her pregnancy visits
    and, after the birth, the baby's."""
    codes = (CG, BF, CF, AF, PF)
    done: Dict[str, int] = {c: 0 for c in codes}
    totals = {"due": 0, "made": 0, "on_time": 0}
    expected: Dict[str, int] = {c: 0 for c in codes}
    phases: List[Tuple[Case, date, date]] = []
    anchor = pnc_anchor(case) if case.dob is not None else None
    if bucket(case) == ANC:
        pregnancy = replace(case, dob=None, child_adopted=None)
        until = min(as_of, anchor - timedelta(days=1)) if anchor is not None and anchor <= as_of else as_of
        phases.append((pregnancy, case.adopted, until))
    if anchor is not None and anchor <= as_of:
        phases.append((case, anchor, as_of))
    for phase_case, start, until in phases:
        if until < start:
            continue
        counts = _phase_counts(phase_case, until, codes)
        for key in totals:
            totals[key] += counts[key]
        for code in codes:
            expected[code] += counts["expected"][code]
        mine = MOTHER_FORMS if phase_case.dob is None else CHILD_FORMS + ((PF,) if case.mother_forms_here else ())
        for f in case.forms:
            if f.code in mine and start <= f.on <= until:
                done[f.code] += 1
    if not case.mother_forms_here:
        expected[PF] = done[PF] = 0
    return {"visits": totals, "expected": expected, "done": done}
