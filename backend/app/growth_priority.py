"""Growth status, trend and priority — every number in one place.

The visit protocol of November 2026 (docs/visit-protocol-2026-11.md, "Growth
status, priority and data checks") ranks the babies to be seen first. The
worker's "See these babies soon" list, her "My babies' growth" panel and the
supervisors' Faltering Cases page all read from this module, so a number
changed here changes all three. The numbers are the proposal from the chat;
Nandish is to confirm the final order of the malnutrition groups.

Priority score = status score × trend multiplier, × 2 when moderate or severe
on all three indicators.

* Status score = 1 + Σ (hazard ratio − 1) over wasting, underweight and
  stunting: the hazard ratios of death by grade from Olofin et al. 2013
  (PLoS ONE 8(5): e64636). A normal or unmeasured indicator adds nothing.
* Trend = the change in weight-for-age z (WAZ) since the last check at least
  14 days earlier. A baby under 3 weeks follows the newborn rule instead
  (NICE NG75): more than 10 % below the birth weight is faltering; after 3
  weeks, a weight still below the birth weight is faltering too.
* Tiers: ≥ 9 refer / act today · 3–9 act this week · 1.5–3 counsel at the
  next visit · below 1.5 not flagged. Severe wasting or severe underweight is
  always tier 1, whatever the trend.

The z-scores themselves come from app/who_growth.py through the growth
monitor's own reading of a visit (routers/growth._visit_z) — this module only
grades and weighs them.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Sequence, Tuple

# ── Grades of a z-score (the analysts' cut-offs, routers/growth.Z_CATEGORY_NAMES) ──
SEVERE_BELOW_Z = -3.0
MODERATE_BELOW_Z = -2.0
MILD_BELOW_Z = -1.0
SEVERE, MODERATE, MILD, NORMAL = "severe", "moderate", "mild", "normal"
LOW_GRADES = (MODERATE, SEVERE)          # "underweight", "stunted", "wasted": below −2 SD

# ── Status score: Olofin 2013 hazard ratios of death, by grade ───────────────
WASTING, UNDERWEIGHT, STUNTING = "wasting", "underweight", "stunting"
HAZARD_RATIO: Dict[str, Dict[str, float]] = {
    WASTING: {SEVERE: 11.63, MODERATE: 3.38, MILD: 1.62, NORMAL: 1.00},
    UNDERWEIGHT: {SEVERE: 9.40, MODERATE: 2.63, MILD: 1.52, NORMAL: 1.00},
    STUNTING: {SEVERE: 5.48, MODERATE: 2.28, MILD: 1.46, NORMAL: 1.00},
}
# The WHO indicator each is read from: weight-for-length, weight-for-age, length-for-age.
INDICATOR_OF = {WASTING: "wfl", UNDERWEIGHT: "wfa", STUNTING: "lfa"}
# Moderate or severe on all three: the deficits compound (Olofin's combined HR).
ALL_THREE_MULTIPLIER = 2.0

# ── Trend ────────────────────────────────────────────────────────────────────
TREND_MIN_DAYS = 14                      # compare with a check at least this long before
FALTERING_BELOW = -0.67                  # WAZ change below this: faltering
CATCH_UP_ABOVE = 0.67                    # WAZ change above this: catch-up
NEWBORN_UNDER_DAYS = 21                  # under 3 weeks: the newborn rule
NEWBORN_MAX_LOSS = 0.10                  # more than 10 % below the birth weight

FALTERING, SLOWED, NO_CHANGE, IMPROVED, CATCH_UP = "faltering", "slowed", "no_change", "improved", "catch_up"
FIRST_CHECK = "first_check"              # no check 14+ days before to compare with
NEWBORN = "newborn"                      # under 3 weeks and within 10 % of the birth weight
TREND_MULTIPLIER: Dict[str, float] = {
    FALTERING: 2.0, SLOWED: 1.5, NO_CHANGE: 1.0, FIRST_CHECK: 1.0, NEWBORN: 1.0, IMPROVED: 0.8, CATCH_UP: 0.6,
}

# ── Tiers ────────────────────────────────────────────────────────────────────
TIER_REFER, TIER_WEEK, TIER_COUNSEL = 1, 2, 3
TIER_MIN_SCORE: Tuple[Tuple[int, float], ...] = ((TIER_REFER, 9.0), (TIER_WEEK, 3.0), (TIER_COUNSEL, 1.5))
ALWAYS_TIER_1 = ((WASTING, SEVERE), (UNDERWEIGHT, SEVERE))
# English words for the spreadsheet; the screens translate the tier number.
TIER_WORDS = {TIER_REFER: "Refer today", TIER_WEEK: "Act this week", TIER_COUNSEL: "Counsel at next visit"}
NOT_FLAGGED_WORDS = "Not flagged"
TREND_WORDS = {
    FALTERING: "Faltering", SLOWED: "Slowed", NO_CHANGE: "No change", IMPROVED: "Improved",
    CATCH_UP: "Catch-up", FIRST_CHECK: "No check 14+ days before", NEWBORN: "Newborn (under 3 weeks)",
}

# ── Groups on the learner's "My babies' growth" ─────────────────────────────
GROUPS = ("underweight", "faltering", "stunted", "wasted")
_GROUP_OF = {UNDERWEIGHT: "underweight", STUNTING: "stunted", WASTING: "wasted"}


def grade(z: Optional[float]) -> Optional[str]:
    if z is None:
        return None
    if z < SEVERE_BELOW_Z:
        return SEVERE
    if z < MODERATE_BELOW_Z:
        return MODERATE
    return MILD if z < MILD_BELOW_Z else NORMAL


def status_score(grades: Dict[str, Optional[str]]) -> float:
    """1 + the extra death risk of each indicator's grade."""
    return 1.0 + sum(HAZARD_RATIO[ind][grades.get(ind) or NORMAL] - 1.0 for ind in HAZARD_RATIO)


def tier_for(score: float) -> Optional[int]:
    for tier, lowest in TIER_MIN_SCORE:
        if round(score, 6) >= lowest:
            return tier
    return None


def priority(grades: Dict[str, Optional[str]], trend_group: str) -> Dict[str, Any]:
    base = status_score(grades)
    multiplier = TREND_MULTIPLIER.get(trend_group, 1.0)
    all_three = all(grades.get(ind) in LOW_GRADES for ind in HAZARD_RATIO)
    score = base * multiplier * (ALL_THREE_MULTIPLIER if all_three else 1.0)
    safety = any(grades.get(ind) == g for ind, g in ALWAYS_TIER_1)
    return {"score": round(score, 2), "tier": TIER_REFER if safety else tier_for(score),
            "status_score": round(base, 2), "multiplier": multiplier, "all_three": all_three,
            "safety_rule": safety and tier_for(score) != TIER_REFER}


def sort_key(p: Optional[Dict[str, Any]]) -> Tuple[int, float]:
    """Tier 1 first, then the higher score; babies not flagged last."""
    if not p:
        return (99, 0.0)
    return (p.get("tier") or 9, -float(p.get("score") or 0.0))


def trend_of_change(change: float) -> str:
    if change < FALTERING_BELOW:
        return FALTERING
    if change < 0:
        return SLOWED
    if change == 0:
        return NO_CHANGE
    return IMPROVED if change <= CATCH_UP_ABOVE else CATCH_UP


def waz_trend(checks: Sequence[Tuple[date, float]]) -> Dict[str, Any]:
    """The WAZ trend from (date, WAZ) pairs, oldest first: the latest check
    against the last one at least TREND_MIN_DAYS before it."""
    none = {"group": FIRST_CHECK, "rule": "waz", "change": None, "since": None}
    if not checks:
        return none
    last_on, last_z = checks[-1]
    earlier = [(d, z) for d, z in checks[:-1] if (last_on - d).days >= TREND_MIN_DAYS]
    if not earlier:
        return none
    since, then = earlier[-1]
    change = round(last_z - then, 2)
    return {"group": trend_of_change(change), "rule": "waz", "change": change, "since": since.isoformat()}


def _trend(weighed: List[Dict[str, Any]], sex: Optional[str], birth_weight: Optional[float]) -> Dict[str, Any]:
    from app.routers.growth import _visit_z

    last = weighed[-1]
    if last["age_days"] < NEWBORN_UNDER_DAYS:
        if birth_weight and last["weight"] < birth_weight * (1 - NEWBORN_MAX_LOSS):
            loss = round(100 * (birth_weight - last["weight"]) / birth_weight)
            return {"group": FALTERING, "rule": "newborn_loss", "change": None, "since": None, "loss_pct": loss}
        return {"group": NEWBORN, "rule": NEWBORN, "change": None, "since": None}
    if birth_weight and last["weight"] < birth_weight:
        return {"group": FALTERING, "rule": "birth_weight_not_regained", "change": None, "since": None}
    checks = [(date.fromisoformat(v["date"]), z) for v in weighed
              if (z := _visit_z("wfa", sex, v)) is not None]
    return waz_trend(checks)


def assess(case: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One baby's latest growth check, graded, trended and ranked; None when
    the baby has not been weighed yet. `case` is a growth-monitor case
    (routers/growth._build_cases): each indicator is read at its own latest
    measurement, as the summary table's "last visit" grades are."""
    from app.routers.growth import _sex_key, _visit_z

    child = case.get("child") or {}
    sex = _sex_key(child.get("gender"))
    visits = sorted((v for v in case.get("visits") or [] if v.get("age_days") is not None),
                    key=lambda v: v["date"])
    weighed = [v for v in visits if v.get("weight")]
    if not weighed:
        return None
    with_length = [v for v in visits if v.get("length")]
    with_both = [v for v in weighed if v.get("length")]
    z = {"wfa": _visit_z("wfa", sex, weighed[-1]),
         "lfa": _visit_z("lfa", sex, with_length[-1]) if with_length else None,
         "wfl": _visit_z("wfl", sex, with_both[-1]) if with_both else None}
    grades = {ind: grade(z[INDICATOR_OF[ind]]) for ind in HAZARD_RATIO}
    trend = _trend(weighed, sex, child.get("birth_weight"))
    groups = [g for g in GROUPS
              if (g == "faltering" and trend["group"] == FALTERING)
              or any(_GROUP_OF[ind] == g and grades[ind] in LOW_GRADES for ind in HAZARD_RATIO)]
    return {"last_check": weighed[-1]["date"], "age_days": weighed[-1]["age_days"], "z": z, "grades": grades,
            "trend": trend, "priority": priority(grades, trend["group"]), "groups": groups}


def growing_well(assessed: Optional[Dict[str, Any]]) -> bool:
    """Weighed, in none of the four groups and not flagged by the score."""
    return bool(assessed) and not assessed["groups"] and assessed["priority"]["tier"] is None
