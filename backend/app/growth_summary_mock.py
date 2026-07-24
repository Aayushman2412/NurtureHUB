"""MOCK / DEMO data for the growth-monitoring learner summary table.

⚠️  REMOVABLE IN ONE STEP.  Everything *synthetic* in the summary table lives in
this file and nowhere else:

  * the adoption **type** label (the DB stores adoption *dates*, not a type),
  * the per-form **expected** activity counts — the programme "rules" that decide
    how many Growth / Breastfeeding / Complementary-Feeding activities a case
    *should* have, given its adoption type and duration, and
  * **z-score fallbacks** for cases that have no real measurements yet.

Real data — actual submitted-form counts, adoption dates, and z-scores computed
from real weight/length — NEVER comes from this module.

──────────────────────────────────────────────────────────────────────────────
TO REMOVE FOR PRODUCTION — do either:
  1. Set env  GROWTH_SUMMARY_MOCK=false   (or 0/no).  The summary endpoint then
     returns real data only: expected counts, adoption type and z-fallbacks come
     back as null and the UI shows "—".
  2. Delete this file and every reference in app/routers/growth.py — find them all
     (the "# MOCK:" tags plus the `if gsm.MOCK_ENABLED` gates) with:
        grep -n "gsm\.\|growth_summary_mock\|GROWTH_SUMMARY_MOCK" app/routers/growth.py
──────────────────────────────────────────────────────────────────────────────

All values are DETERMINISTIC per child (seeded by child_id) so the table is
stable across refreshes — a given child always shows the same demo numbers.
When the real expected-count rules are known, replace :func:`expected_counts`
(and drop the mock flag) — the endpoint contract stays identical.
"""

from __future__ import annotations

import os
from random import Random
from typing import Dict, Optional

# Single switch. Default on in dev; set GROWTH_SUMMARY_MOCK=false in production.
MOCK_ENABLED: bool = os.getenv("GROWTH_SUMMARY_MOCK", "true").strip().lower() in ("1", "true", "yes", "on")

# Adoption-type buckets (also derivable from the real age-at-adoption signal).
ADOPTION_ANTENATAL = "Antenatal"
ADOPTION_NEWBORN = "Newborn (0–6m)"
ADOPTION_OLDER = "Older infant (6–24m)"
ADOPTION_TYPES = (ADOPTION_ANTENATAL, ADOPTION_NEWBORN, ADOPTION_OLDER)


def _rng(child_id: int, salt: int = 0) -> Random:
    """Stable per-child RNG so demo values never jump between requests."""
    return Random((int(child_id) * 2654435761 + salt) & 0xFFFFFFFF)


def adoption_type(child_id: int, age_at_adoption_days: Optional[int]) -> str:
    """Adoption type. Prefers the REAL signal (child's age when adopted); only
    truly random when no adoption/birth dates exist to derive it from."""
    if age_at_adoption_days is not None:
        if age_at_adoption_days < 0:
            return ADOPTION_ANTENATAL
        if age_at_adoption_days <= 180:
            return ADOPTION_NEWBORN
        return ADOPTION_OLDER
    return _rng(child_id, 11).choice(ADOPTION_TYPES)


def expected_counts(child_id: int, atype: str, duration_days: Optional[int]) -> Dict[str, int]:
    """MOCK RULES — placeholder LAP-style cadence for how many activities a case
    is expected to have. Roughly one growth check per month of follow-up, with
    breastfeeding weighted to the 0–6m window and complementary feeding to 6–24m,
    modulated by adoption type. Replace with the real programme rules.
    """
    if duration_days and duration_days > 0:
        months = max(1, min(24, round(duration_days / 30)))
    else:
        months = _rng(child_id, 23).randint(2, 12)

    cg = months  # growth monitoring ~ monthly
    if atype == ADOPTION_ANTENATAL:
        bf, cf = max(0, months - 2), max(0, months - 8)
    elif atype == ADOPTION_NEWBORN:
        bf, cf = min(months, 6), max(0, months - 6)
    else:  # older infant — BF window mostly past, CF is the focus
        bf, cf = min(months, 3), months
    return {"cg": int(cg), "bf": int(bf), "cf": int(cf)}


# Demo learners carry no department (the ICDS masters split HFW vs WCD); fill one
# deterministically so the Department filter has values to work with in the demo.
DEPARTMENTS = ("Health & Family Welfare", "Women & Child Development")


def resolved_department(learner_id: Optional[int], real_department: Optional[str]) -> Optional[str]:
    """Real department when present; otherwise a stable mock one (or None when
    mock is disabled). Used identically for row values, filter options, and
    filtering so the Department filter stays coherent."""
    if real_department:
        return real_department
    if not MOCK_ENABLED or learner_id is None:
        return real_department
    return _rng(learner_id, 41).choice(DEPARTMENTS)


def mock_adoption_timing(child_id: int) -> tuple:
    """(age_at_adoption_days, duration_days) for a case whose child has no stored
    adoption date — so the Case-details columns aren't all blank in the demo."""
    rng = _rng(child_id, 7)
    age = rng.choice([-45, -20, 5, 20, 60, 120, 210, 300])  # antenatal … older infant
    duration = rng.randint(60, 540)
    return age, duration


def fallback_z(child_id: int, key: str) -> float:
    """A plausible z-score in [-2.5, 1.5] for a case with no real measurement,
    so the outcomes columns aren't all blank in the demo. Flagged as mock in the
    response so the UI can render it distinctly."""
    return round(_rng(child_id, sum(ord(c) for c in key)).uniform(-2.5, 1.5), 2)
