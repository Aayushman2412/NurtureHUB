"""The programme rules behind the MASD dashboard — one place, written down once.

Everything here comes from the analysts' MASD & outcome report (the deck the
team presents to the district): the ideal activity count per learner per
tranche, the adoption target, how an adoption is typed, what counts as the
minimum follow-up, and the survey benchmarks the outcomes are read against.
The engine (app/masd/engine.py) and the growth monitor both read these, so the
two screens can never disagree about what a learner "should" have done.

Terms (as the deck uses them)
  adoption / MCD   one mother (and her child, once born) a learner takes on
  ANC              adopted while pregnant
  PNC<5M / PNC≥5M  adopted after birth, the child younger / older than 5 months
  tranche          the programme runs two rounds of adoption; tranche 1 needs
                   at least 2.5 months of follow-up, tranche 2 at least 1.5
  BV / AV / LV     birth details / adoption visit / last visit
  MT+FL            Master Trainers + Facilitators
"""
from __future__ import annotations

from typing import Dict, Optional

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

# ── Ideal activities per adoption, by tranche (deck: "Reference: Ideal
#    Activity Count per Learner (by Tranche)") ─────────────────────────────

NURSE = "nurse_lt5"   # a Staff Nurse's PNC<5M adoption (facility-based)

IDEAL_PER_ADOPTION: Dict[int, Dict[str, Dict[str, int]]] = {
    1: {  # tranche 1 — at least 2.5 months of follow-up
        ANC: {"anc": 5, "protein": 5},
        PNC_LT5: {"protein": 2, "gm": 13, "bf": 5},
        PNC_GE5: {"gm": 13, "bf": 5, "cf": 5},
        # The deck gives 33 for a nurse's three tranche adoptions (GM 18, BF 15):
        # six growth checks and five breastfeeding assessments per baby — two
        # visits a day through the hospital stay.
        NURSE: {"gm": 6, "bf": 5},
    },
    2: {  # tranche 2 — at least 1.5 months of follow-up
        ANC: {"anc": 3, "protein": 3},
        PNC_LT5: {"protein": 2, "gm": 12, "bf": 5},
        PNC_GE5: {"gm": 12, "bf": 5, "cf": 3},
        NURSE: {"gm": 6, "bf": 5},
    },
}

# Each tranche expects one adoption of each type (three per learner per tranche,
# six in all); a Staff Nurse is expected three PNC<5M adoptions per tranche.
TARGET_MIX = {ANC: 1, PNC_LT5: 1, PNC_GE5: 1}
NURSE_TARGET_PER_TRANCHE = 3
ADOPTIONS_PER_TRANCHE = 3
MIN_FOLLOW_UP_MONTHS = {1: 2.5, 2: 1.5}

# Follow-up each tranche's adoptions need, in days (2.5 and 1.5 months), and
# how long tranche 2's adoption window stays open.
FOLLOW_UP_DAYS = {1: 76, 2: 46}
TRANCHE2_WINDOW_DAYS = 21

# Defaults when a project has not set its calendar.
DEFAULT_TRANCHE2_OFFSET_DAYS = 42   # tranche 2 opens six weeks after training


def ideal_for_tranche(is_nurse: bool, tranche: int) -> Dict[str, int]:
    """Ideal activities per subtype for one learner in one tranche: 53 then 45
    for most cadres, 33 and 33 for a Staff Nurse."""
    totals = {k: 0 for k in ACTIVITY_KEYS}
    table = IDEAL_PER_ADOPTION[tranche]
    if is_nurse:
        for key, n in table[NURSE].items():
            totals[key] += n * NURSE_TARGET_PER_TRANCHE
    else:
        for atype, count in TARGET_MIX.items():
            for key, n in table[atype].items():
                totals[key] += n * count
    return totals


def ideal_for_learner(is_nurse: bool, tranches: int = 2) -> Dict[str, int]:
    """Ideal activities per subtype over the first `tranches` tranches — 98 in
    all for most cadres, 66 for a Staff Nurse (deck: "Both tranches combine to
    a flat ideal of 98 … and 66 for Staff Nurse")."""
    totals = {k: 0 for k in ACTIVITY_KEYS}
    for tranche in range(1, tranches + 1):
        for key, n in ideal_for_tranche(is_nurse, tranche).items():
            totals[key] += n
    return totals


def adoption_target(tranches: int = 2) -> int:
    """Adoptions expected per learner: 3 per tranche (6 over both) — the same
    count for Staff Nurses, whose six are all PNC<5M."""
    return ADOPTIONS_PER_TRANCHE * tranches


def ideal_for_adoption(adoption_type: str, tranche: int, is_nurse: bool) -> Dict[str, int]:
    """Ideal activities for ONE adoption — what the growth monitor calls the
    expected count. An ANC adoption expects antenatal and protein checks only
    (mother-level); its baby's growth checks after birth are extra."""
    tranche = 2 if tranche == 2 else 1
    if is_nurse and adoption_type in (PNC_LT5, PNC_GE5):
        return dict(IDEAL_PER_ADOPTION[tranche][NURSE])
    return dict(IDEAL_PER_ADOPTION[tranche].get(adoption_type, {}))


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
