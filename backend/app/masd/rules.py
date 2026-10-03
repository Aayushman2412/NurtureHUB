"""The programme rules behind the MASD dashboard — one place, written down once.

Everything here comes from the analysts' MASD & outcome report (the deck the
team presents to the district) and the method agreed on 29 Sep 2026: how an
adoption is typed, the adoption targets and how they rise, the forms expected
at each follow-up duration, a case's expected forms from its own follow-up,
and the survey benchmarks the outcomes are read against.
The engine (app/masd/engine.py) and the growth monitor both read these, so the
two screens can never disagree about what a learner "should" have done.

Terms (as the deck uses them)
  adoption / MCD   one mother (and her child, once born) a learner takes on
  ANC              adopted while pregnant
  PNC<5M / PNC≥5M  adopted after birth, the child younger / older than 5 months
  tranche          the programme runs rounds of adoption; the targets rise at
                   each review (Jalna: three, three more on 27 Jul, three
                   more on 7 Sep)
  follow-up (FU)   days a tranche of adoptions has run: from the day it opened
                   (or the learner's training ended, if later), less a short
                   buffer, rounded down to a multiple of 15
  BV / AV / LV     birth details / adoption visit / last visit
  MT+FL            Master Trainers + Facilitators
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

# ── Adoption types ─────────────────────────────────────────────────────────

ANC = "anc"
PNC_LT5 = "pnc_lt5"
PNC_GE5 = "pnc_ge5"
UNKNOWN = "unknown"          # no pregnancy date and no child: cannot be typed
ADOPTION_TYPES = (ANC, PNC_LT5, PNC_GE5)
ADOPTION_TYPE_LABELS = {
    ANC: "ANC",
    PNC_LT5: "PNC <5M",
    PNC_GE5: "PNC ≥5M",
    UNKNOWN: "Not typed",
}

# A child adopted at this many days old or more is a "PNC ≥5 months" adoption.
FIVE_MONTHS_DAYS = 150

# ── Activities (one submitted assessment form = one activity) ──────────────

ACTIVITY_FORMS: Dict[str, str] = {
    "anc": "antenatal",
    "protein": "mother_protein_intake",
    "gm": "growth_monitoring",
    "bf": "breastfeeding",
    "cf": "complementary_feeding",
}
ACTIVITY_KEYS = tuple(ACTIVITY_FORMS)
ACTIVITY_LABELS = {
    "anc": "Antenatal care",
    "protein": "Protein count",
    "gm": "Growth monitoring",
    "bf": "Breastfeeding",
    "cf": "Complementary feeding",
}
FORM_TO_ACTIVITY = {form: key for key, form in ACTIVITY_FORMS.items()}

# ── Expected activity (the method agreed on 2026-09-29) ────────────────────
#
# MASD no longer reads a learner against a flat ideal (the deck's 98 / 66). It
# reads them against what was EXPECTED by the report date, two ways:
#
#  1. Against the adoption targets. The targets come in tranches, and each
#     tranche has its own follow-up (refined 1–3 Oct 2026): from the day it
#     opened — or the learner's last training day, if that came later — plus a
#     buffer (a week for the first tranche, four days for each later one), to
#     the report date, rounded DOWN to a multiple of 15 days (98 days counts as
#     90). The forms expected are, for each tranche, the adoptions it added ×
#     the cumulative expected-forms table at ITS follow-up, summed. Adoptions
#     asked for in September cannot be expected to have June's visits.
#  2. Within the learner's own cases. Each case's expected forms follow from
#     its actual follow-up (case_expected below), so a learner who adopted
#     fewer mothers is still asked: are you active on the ones you have?

FIRST_TRANCHE_BUFFER_DAYS = 7    # before the first tranche's follow-up counts
LATER_TRANCHE_BUFFER_DAYS = 4    # … and after each later tranche opens
FU_STEP_DAYS = 15
FU_MAX_DAYS = 270            # the table runs to nine months of follow-up
EXPECTED_DURATIONS = list(range(FU_STEP_DAYS, FU_MAX_DAYS + 1, FU_STEP_DAYS))

NURSE = "nurse_lt5"   # a Staff Nurse's PNC<5M adoption (facility-based)

# The table's rows: which forms each adoption type is expected to generate.
# Protein counts are held to ANC adoptions for now, as agreed.
EXPECTED_ROWS = [
    (ANC, "anc"), (ANC, "protein"),
    (PNC_LT5, "gm"), (PNC_LT5, "bf"),
    (PNC_GE5, "gm"), (PNC_GE5, "bf"), (PNC_GE5, "cf"),
    (NURSE, "gm"), (NURSE, "bf"),
]
EXPECTED_ROW_TYPES = (ANC, PNC_LT5, PNC_GE5, NURSE)

# The Learning Action Protocol (LAP) visit days, counted from the adoption,
# that the DEFAULT table is built from. The real sheet replaces the table (an
# admin edits it on the dashboard); these only seed it. They reproduce every
# figure quoted when the method was agreed: growth checks 9 within 15 days,
# 11 within 30, 14 at 90 and 15 at 105; all five breastfeeding assessments in
# the first 15 days; complementary feeding every 15 days for the first 60 days
# of a ≥5-month adoption and monthly after (4 at 75 days, 5 at 90).
LAP_GM_DAYS = (0, 1, 2, 3, 4, 6, 8, 11, 14, 21, 28, 45, 60, 90, 105, 135, 165, 195, 225, 255)
LAP_BF_DAYS = (0, 3, 7, 10, 14)
LAP_CF_DAYS = (15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270)
# Interim rule for ANC adoptions (taken in the last trimester): the antenatal
# and protein checks of the pregnancy only — two, the adoption visit and one
# 15 days later — whatever the follow-up. Visits after the birth are the
# baby's, and this table does not yet count them for an ANC adoption.
LAP_ANC_DAYS = (0, 15)
# A Staff Nurse's hospital adoptions: two visits a day through the stay.
NURSE_FLAT = {"gm": 6, "bf": 5}


def _cumulative(days: Tuple[int, ...], upto: int) -> int:
    return sum(1 for d in days if d <= upto)


def default_expected_forms() -> Dict[str, Any]:
    rows: Dict[str, Dict[str, List[int]]] = {t: {} for t in EXPECTED_ROW_TYPES}
    schedule = {"anc": LAP_ANC_DAYS, "protein": LAP_ANC_DAYS, "gm": LAP_GM_DAYS,
                "bf": LAP_BF_DAYS, "cf": LAP_CF_DAYS}
    for atype, key in EXPECTED_ROWS:
        if atype == NURSE:
            rows[atype][key] = [NURSE_FLAT[key] for _ in EXPECTED_DURATIONS]
        else:
            rows[atype][key] = [_cumulative(schedule[key], d) for d in EXPECTED_DURATIONS]
    return {"durations": list(EXPECTED_DURATIONS), "rows": rows}


def validate_expected_forms(table: Dict[str, Any]) -> Optional[str]:
    """Why an edited table cannot be used, or None. Counts are cumulative, so
    they may never fall as the follow-up gets longer."""
    if table.get("durations") != EXPECTED_DURATIONS:
        return f"durations must be {EXPECTED_DURATIONS[0]}–{EXPECTED_DURATIONS[-1]} days in steps of {FU_STEP_DAYS}"
    rows = table.get("rows") or {}
    for atype, key in EXPECTED_ROWS:
        values = (rows.get(atype) or {}).get(key)
        if not isinstance(values, list) or len(values) != len(EXPECTED_DURATIONS):
            return f"{ADOPTION_TYPE_LABELS.get(atype, atype)} · {ACTIVITY_LABELS[key]}: one value per duration"
        if any(not isinstance(v, int) or isinstance(v, bool) or v < 0 or v > 999 for v in values):
            return f"{ADOPTION_TYPE_LABELS.get(atype, atype)} · {ACTIVITY_LABELS[key]}: whole numbers 0–999"
        if any(b < a for a, b in zip(values, values[1:])):
            return f"{ADOPTION_TYPE_LABELS.get(atype, atype)} · {ACTIVITY_LABELS[key]}: cumulative counts cannot fall"
    return None


def round_follow_up(days: int) -> int:
    """The nearest lower multiple of 15 days, within the table."""
    return max(0, min(FU_MAX_DAYS, (days // FU_STEP_DAYS) * FU_STEP_DAYS))


def follow_up(clock_from: Optional[date], as_of: date) -> Tuple[Optional[int], Optional[int]]:
    """(actual, rounded) days of follow-up from `clock_from` (the buffer
    already added) to `as_of`; 0 while the clock has not started."""
    if clock_from is None:
        return None, None
    raw = max(0, (as_of - clock_from).days)
    return raw, round_follow_up(raw)


def expected_at(table: Dict[str, Any], atype: str, days: Optional[int]) -> Dict[str, int]:
    """Cumulative forms expected from ONE adoption of `atype` followed for
    `days` (already rounded). Nothing is due before the first step."""
    row = (table.get("rows") or {}).get(atype) or {}
    if not days:
        return {k: 0 for k in row}
    durations = table["durations"]
    idx = max((i for i, d in enumerate(durations) if d <= days), default=None)
    return {k: (vals[idx] if idx is not None else 0) for k, vals in row.items()}


# ── Adoption targets, raised as the programme goes on ───────────────────────
#
# Right after training a learner is asked for one adoption of each type; at
# each review the district asks for more (a "tranche"), so the targets rise in
# steps. The step in force on the report date is the adoption target, and each
# step is a tranche with its own follow-up clock (see tranches()). Each
# project's steps are the analysts' to set (Programme settings); these defaults
# stand in until they do. Jalna's are the dates the programme gave on
# 3 Oct 2026; the others are dated from the project's training date and
# tranche-2 start.

TARGET_KEYS = ("anc", "pnc_lt5", "pnc_ge5", "nurse")
_PLANS: Dict[str, List[Tuple[int, int, int, int]]] = {
    #            ANC  <5M  ≥5M  Staff Nurse (<5M)
    "jalna":     [(1, 1, 1, 3), (2, 2, 2, 6), (3, 3, 3, 9)],
    "ujjain":    [(1, 1, 1, 3), (2, 2, 2, 6), (3, 3, 3, 10)],
    "meghalaya": [(1, 1, 1, 5), (2, 2, 2, 10)],
    "khasi":     [(1, 1, 1, 5), (2, 2, 2, 10)],
}
_GENERIC_PLAN = [(1, 1, 1, 3), (2, 2, 2, 6)]
# The dates each tranche opened, where the programme has given them.
_PLAN_DATES: Dict[str, Tuple[date, ...]] = {
    "jalna": (date(2026, 6, 11), date(2026, 7, 27), date(2026, 9, 7)),
}
THIRD_STEP_AFTER_TRANCHE2_DAYS = 45


def default_buffer(index: int) -> int:
    """The buffer before the `index`-th (0-based) tranche's follow-up counts."""
    return FIRST_TRANCHE_BUFFER_DAYS if index == 0 else LATER_TRANCHE_BUFFER_DAYS


def default_targets(slug: str, training: Optional[date], tranche2: Optional[date]) -> List[Dict[str, Any]]:
    plan = _PLANS.get(slug, _GENERIC_PLAN)
    starts = _PLAN_DATES.get(slug)
    if starts is None:
        if training is None:
            return [{"from": None, **dict(zip(TARGET_KEYS, plan[-1])), "buffer": default_buffer(0)}]
        t2 = tranche2 or training + timedelta(days=DEFAULT_TRANCHE2_OFFSET_DAYS)
        starts = (training, t2, t2 + timedelta(days=THIRD_STEP_AFTER_TRANCHE2_DAYS))
    return [{"from": starts[i].isoformat(), **dict(zip(TARGET_KEYS, step)), "buffer": default_buffer(i)}
            for i, step in enumerate(plan)]


def _step_date(step: Dict[str, Any]) -> date:
    return date.fromisoformat(step["from"]) if step.get("from") else date.min


def targets_in_force(steps: List[Dict[str, Any]], as_of: date) -> Tuple[Dict[str, int], Optional[int]]:
    """The targets on `as_of` and which step (1-based) they are. Before the
    first step nothing is expected yet."""
    ordered = sorted(steps, key=_step_date)
    current, number = None, None
    for i, step in enumerate(ordered, 1):
        if _step_date(step) <= as_of:
            current, number = step, i
    if current is None:
        return {k: 0 for k in TARGET_KEYS}, None
    return {k: int(current.get(k) or 0) for k in TARGET_KEYS}, number


def tranches(steps: List[Dict[str, Any]], as_of: date,
             training_end: Optional[date] = None) -> List[Dict[str, Any]]:
    """The tranches of adoption open by `as_of`, each with its own follow-up.

    A tranche is a target step: on its date the learners were asked for the
    adoptions it `added` on top of the step before. Its follow-up clock starts
    when it opened — the step's date, or the learner's last training day if
    that came later (no one adopts before they are trained) — plus the step's
    buffer, and never before the previous tranche's clock. Steps not yet open
    on `as_of` are left out; a tranche still inside its buffer has 0 days."""
    out: List[Dict[str, Any]] = []
    prev = {k: 0 for k in TARGET_KEYS}
    last_clock: Optional[date] = None
    for i, step in enumerate(sorted(steps, key=_step_date)):
        from_ = date.fromisoformat(step["from"]) if step.get("from") else None
        if from_ is not None and from_ > as_of:
            break
        known = [d for d in (from_, training_end) if d is not None]
        opened = max(known) if known else None
        buffer = int(step["buffer"]) if step.get("buffer") is not None else default_buffer(i)
        clock = opened + timedelta(days=buffer) if opened else None
        if clock and last_clock and clock < last_clock:
            clock = last_clock
        raw, fu = follow_up(clock, as_of)
        now = {k: int(step.get(k) or 0) for k in TARGET_KEYS}
        out.append({
            "step": i + 1,
            "from": from_.isoformat() if from_ else None,
            "opened": opened.isoformat() if opened else None,
            "buffer": buffer,
            "clock_from": clock.isoformat() if clock else None,
            "fu_raw": raw,
            "fu_days": fu,
            "added": {k: max(0, now[k] - prev[k]) for k in TARGET_KEYS},
            "targets": now,
        })
        prev, last_clock = now, clock or last_clock
    return out


def learner_targets(targets: Dict[str, int], is_nurse: bool) -> Dict[str, int]:
    """A Staff Nurse's target is all PNC<5M hospital adoptions."""
    if is_nurse:
        return {ANC: 0, PNC_LT5: targets["nurse"], PNC_GE5: 0}
    return {ANC: targets["anc"], PNC_LT5: targets["pnc_lt5"], PNC_GE5: targets["pnc_ge5"]}


def row_type(atype: str, is_nurse: bool) -> str:
    """The table row an adoption is read against."""
    return NURSE if (is_nurse and atype in (PNC_LT5, PNC_GE5)) else atype


# ── One case's expected forms, from its actual follow-up ───────────────────
#
# The main-database rule. A case is expected to have:
#   * in pregnancy — an antenatal and a protein check on the adoption day and
#     every 15 days after, until the birth (a check due on or after the birth
#     day is not expected) or, if the baby has not come, until the expected
#     delivery date (LMP + 280 days);
#   * from the baby's adoption (its first contact, whatever its age then) —
#     growth checks and breastfeeding by the expected-forms table at the
#     follow-up rounded down to 15 days; breastfeeding only for the follow-up
#     before 195 days of age;
#   * complementary-feeding assessments by AGE: at 195, 210, 225 and 240 days,
#     then monthly. Counselling starts from 150 days but no form is filled
#     before 195: feeding starts at 180 and needs 15 days to take hold before
#     it can be assessed. A baby adopted after 195 days is assessed from its
#     first visit.
# Follow-up stops at the report date or at one year of age.

ANC_VISIT_EVERY_DAYS = 15
PREGNANCY_DAYS = 280                  # LMP → expected delivery date
CF_FIRST_AGE_DAYS = 195
CF_AGE_DAYS = (195, 210, 225, 240, 270, 300, 330, 360)
BF_UNTIL_AGE_DAYS = 195
COUNSELLING_FROM_AGE_DAYS = 150
BABY_FOLLOW_UP_MAX_AGE_DAYS = 365


def edd(lmp: Optional[date]) -> Optional[date]:
    return lmp + timedelta(days=PREGNANCY_DAYS) if lmp else None


def pregnancy_visits_due(adopted: date, stop: date, born: bool) -> int:
    """Checks due every 15 days from `adopted`: up to `stop` inclusive while
    the pregnancy is running, strictly before it once the baby is born."""
    span = (stop - adopted).days
    if span < 0 or (born and span == 0):
        return 0
    return (span - 1) // ANC_VISIT_EVERY_DAYS + 1 if born else span // ANC_VISIT_EVERY_DAYS + 1


def case_expected(table: Dict[str, Any], *, mother_adopted: Optional[date], lmp: Optional[date],
                  dob: Optional[date], baby_adopted: Optional[date], end: date,
                  is_nurse: bool = False) -> Dict[str, Any]:
    """Expected forms for one mother-child case, and the follow-up segments
    they come from. Returns zeros where a phase has not happened."""
    out: Dict[str, Any] = {k: 0 for k in ACTIVITY_KEYS}
    out.update({"fu_pregnancy": None, "fu_baby": None, "fu_to_195": None,
                "fu_from_195": None, "fu_from_150": None, "age_at_adoption": None})

    # Pregnancy: only for a mother taken on before the birth.
    if mother_adopted and mother_adopted <= end and (dob is None or mother_adopted < dob):
        born = dob is not None and dob <= end
        stop = dob if born else end
        due_date = edd(lmp)
        if not born and due_date is not None:
            stop = min(stop, due_date)
        out["fu_pregnancy"] = max(0, (stop - mother_adopted).days)
        n = pregnancy_visits_due(mother_adopted, stop, born)
        out["anc"] = out["protein"] = n

    # The baby, from its first contact.
    if dob is not None and dob <= end:
        start = baby_adopted if (baby_adopted and baby_adopted >= dob) else \
            (dob if (mother_adopted and mother_adopted < dob) else (mother_adopted or dob))
        stop = min(end, dob + timedelta(days=BABY_FOLLOW_UP_MAX_AGE_DAYS))
        age_start = (start - dob).days
        out["age_at_adoption"] = age_start
        if start <= stop:
            fu = (stop - start).days
            to195 = max(0, (min(stop, dob + timedelta(days=BF_UNTIL_AGE_DAYS)) - start).days)
            from195 = max(0, (stop - max(start, dob + timedelta(days=CF_FIRST_AGE_DAYS))).days)
            from150 = max(0, (stop - max(start, dob + timedelta(days=COUNSELLING_FROM_AGE_DAYS))).days)
            out.update({"fu_baby": fu, "fu_to_195": to195 if age_start < BF_UNTIL_AGE_DAYS else 0,
                        "fu_from_195": from195, "fu_from_150": from150})
            atype = PNC_LT5 if age_start < FIVE_MONTHS_DAYS else PNC_GE5
            row = row_type(atype, is_nurse)
            out["gm"] = expected_at(table, row, round_follow_up(fu)).get("gm", 0)
            if age_start < BF_UNTIL_AGE_DAYS:
                out["bf"] = expected_at(table, row, round_follow_up(to195)).get("bf", 0)
            if not is_nurse:
                age_stop = (stop - dob).days
                if age_start > CF_FIRST_AGE_DAYS:
                    out["cf"] = 1 + sum(1 for a in CF_AGE_DAYS if age_start < a <= age_stop)
                else:
                    out["cf"] = sum(1 for a in CF_AGE_DAYS if age_start <= a <= age_stop)
    out["total"] = sum(out[k] for k in ACTIVITY_KEYS)
    return out


# Learners' activity on their own cases, grouped as agreed: nothing yet, then
# fifths of what their cases were expected to have (above 100% counts in the
# top band).
OWN_BANDS = [("none", "No activity"), ("b1_20", "1–20%"), ("b21_40", "21–40%"),
             ("b41_60", "41–60%"), ("b61_80", "61–80%"), ("b81_100", "81–100%")]
OWN_BAND_KEYS = [k for k, _ in OWN_BANDS]


def own_band(actual: int, expected: float) -> Optional[str]:
    if expected <= 0:
        return None                       # nothing due yet: not banded
    if actual == 0:
        return "none"
    pct = round(100.0 * actual / expected)
    for upper, key in ((20, "b1_20"), (40, "b21_40"), (60, "b41_60"), (80, "b61_80")):
        if pct <= upper:
            return key
    return "b81_100"


# Tranche 2 still dates the second round of adoption (the growth monitor
# shows it, and the default target steps use it).
DEFAULT_TRANCHE2_OFFSET_DAYS = 42   # tranche 2 opens six weeks after training

# Pregnancies the dashboard flags for follow-up.
FLAG_ANC_MISSED = 2                 # two or more fortnightly checks missed
FLAG_REASONS = {
    "edd_passed": "Expected delivery date has passed, no birth recorded",
    "anc_behind": "Two or more fortnightly antenatal checks missed",
    "no_lmp": "LMP not recorded, so the due date cannot be tracked",
}


# ── Cadres (role groups) and departments ───────────────────────────────────

ROLE_GROUPS = ("AWW", "AWSup", "ASHA", "ASHA Sup", "ANM", "CHO", "Nursing Staff", "Other")
WCD, HFW = "WCD", "HFW"
ROLE_GROUP_DEPARTMENT = {
    "AWW": WCD, "AWSup": WCD,
    "ASHA": HFW, "ASHA Sup": HFW, "ANM": HFW, "CHO": HFW, "Nursing Staff": HFW, "Other": HFW,
}
NURSING_STAFF = "Nursing Staff"


def role_group(role: Optional[str]) -> str:
    """The deck's eight cadres, from a learner's designation or legacy role.
    Order matters: "ASHA Facilitator" must not fall into plain "ASHA"."""
    r = (role or "").strip().lower()
    if not r:
        return "Other"
    if "anganwadi worker" in r or r in ("aww",) or "(aww)" in r:
        return "AWW"
    if "lady supervisor" in r or "anganwadi supervisor" in r or r in ("aws", "awsup", "supervisor"):
        return "AWSup"
    if "asha" in r and ("facilitator" in r or "supervisor" in r or "sup" in r.split()):
        return "ASHA Sup"
    if "asha" in r:
        return "ASHA"
    if "anm" in r or "auxiliary nurse" in r:
        return "ANM"
    if "cho" in r.split() or "community health officer" in r or "mlhp" in r or "mid-level health" in r:
        return "CHO"
    if "nurse" in r or "nursing" in r:
        return NURSING_STAFF
    return "Other"


# ── Outcome analysis ───────────────────────────────────────────────────────

# z below this = stunted (height-for-age), underweight (weight-for-age),
# wasted (weight-for-height). WHO: moderate-or-severe is < -2 SD.
MALNUTRITION_Z = -2.0
INDICATORS = ("stunting", "underweight", "wasting")
INDICATOR_Z = {"stunting": "hfa", "underweight": "wfa", "wasting": "wfh"}
INDICATOR_LABELS = {"stunting": "Stunting", "underweight": "Underweight", "wasting": "Wasting"}

# Age bands for the NFHS comparison (deck: "<6-month age band = ANC + PNC<5M
# adoption subtypes combined; 6–11-month age band = PNC≥5M").
BAND_LT6, BAND_6_11 = "lt6", "m6_11"
BAND_OF_TYPE = {ANC: BAND_LT6, PNC_LT5: BAND_LT6, PNC_GE5: BAND_6_11}
BAND_LABELS = {BAND_LT6: "<6 months", BAND_6_11: "6–11 months"}

# Minimum PNC visit compliance: growth checks and follow-up length.
COMPLIANCE = {
    BAND_LT6: {"min_visits": 8, "min_follow_up_days": 60},   # ANC + PNC<5M
    BAND_6_11: {"min_visits": 4, "min_follow_up_days": 60},  # PNC≥5M
}

# Data-quality thresholds for the exclusion checks.
BIRTH_Z_LIMIT = 6.0               # |birth weight z| beyond this is implausible
BIRTH_VISIT_WINDOW_DAYS = 3       # a first visit this close to birth is the birth weighing
BIRTH_WEIGHT_TOLERANCE_KG = 0.5   # … and should agree with the birth weight
ADOPTION_VISIT_WINDOW_DAYS = 7    # the adoption visit should fall on the adoption date

# Primary exclusion reasons, in the order they are tested (the first failed
# check is the one reported) — the deck's "Primary Exclusion Reasons" table.
EXCLUSION_REASONS = [
    ("no_child", "No child ID – child not born yet / not followed up"),
    ("no_adoption_details", "Birth details available but no adoption details"),
    ("mother_after_lv", "Mother adoption date is after the child's last visit"),
    ("birth_weight_extreme", "Birth weight below −6 SD or above +6 SD"),
    ("birth_vs_visit1", "Birth weight vs first-visit weight mismatch"),
    ("dob_vs_visit1", "Date of birth vs first-visit date mismatch"),
    ("adoption_vs_visit", "Adoption date vs adoption-visit date mismatch"),
    ("only_adoption_visit", "Only the adoption visit occurred"),
    ("only_birth_anthropometry", "Only birth anthropometry available"),
    ("z_missing", "Weight z-score at BV/AV/LV is missing"),
    ("baby_before_mother", "Invalid: baby adopted before the mother"),
]
EXCLUSION_LABELS = dict(EXCLUSION_REASONS)

# Mother demographics buckets.
MOTHER_AGE_GROUPS = [(15, 18, "15–18 years"), (19, 24, "19–24 years"),
                     (25, 36, "25–36 years"), (37, 46, "37–46 years")]
GOVERNMENT_PLACES = ("district hospital", "rural hospital", "sub-district hospital",
                     "community health centre", "primary health centre", "sub-centre",
                     "(dh)", "(rh)", "(sdh)", "(chc)", "(phc)", "(sc)")


def delivery_place_group(place: Optional[str]) -> str:
    p = (place or "").strip().lower()
    if not p:
        return "Not recorded"
    if p == "home":
        return "Home"
    if "private" in p or "nursing home" in p:
        return "Private"
    if any(g in p for g in GOVERNMENT_PLACES) or "hospital" in p or "phc" in p or "chc" in p:
        return "Government"
    return "Other"


def delivery_method_group(method: Optional[str]) -> str:
    m = (method or "").strip().lower()
    if not m:
        return "Not recorded"
    if "caesarean" in m or "cesarean" in m or "c-section" in m:
        return "Caesarean section"
    if "assisted" in m:
        return "Assisted delivery"
    if "normal" in m:
        return "Normal"
    return "Other"


# ── Survey benchmarks ──────────────────────────────────────────────────────
#
# Used only where a project has none saved in masd_project_settings. Values are
# the deck's: NFHS-5 (2019-21) Maharashtra age-wise table (<6 months taken
# directly, 6–11 months the sample-weighted average of the 6–8 and 9–11 month
# rows) and Jalna district's NFHS-4/5/6 under-5 figures. Other projects start
# without benchmarks rather than with borrowed ones.

DEFAULT_BENCHMARKS: Dict[str, Dict] = {
    "jalna": {
        "label": "NFHS-5 Maharashtra",
        "age_bands": {
            BAND_LT6: {"stunting": 28.8, "underweight": 29.4, "wasting": 31.2},
            BAND_6_11: {"stunting": 24.8, "underweight": 24.7, "wasting": 29.9},
        },
        "district_trend": {
            "label": "Jalna district, children under 5",
            "rounds": ["NFHS-4", "NFHS-5", "NFHS-6"],
            "stunting": [44.1, 38.0, 33.0],
            "underweight": [43.6, 39.0, 32.6],
            "wasting": [22.4, 22.2, 21.5],
        },
    },
}
