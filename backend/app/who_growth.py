"""WHO Child Growth Standards (2006) — reference data access.

Loads LMS parameter tables (weight-for-age, length-for-age, weight-for-length,
boys + girls) from ``app/data/who_standards.json`` and exposes:

- percentile curves for the chart background (P3/P15/P50/P85/P97, the five
  percentile lines printed on Indian MCP / ICDS growth charts), and
- ``value_for_z`` for the demo seeder, so mock children can follow realistic
  percentile tracks instead of random numbers.

The JSON entries are ``{"x": <age_days | length_cm>, "L":…, "M":…, "S":…}``;
entries may instead carry precomputed ``p3…p97`` keys (fallback shape if the
source tables only published percentiles).
"""

import json
import os
from functools import lru_cache
from typing import Dict, List, Optional

# Standard normal z-scores for the five printed percentiles.
PERCENTILE_Z = {
    "p3": -1.8807936,
    "p15": -1.0364334,
    "p50": 0.0,
    "p85": 1.0364334,
    "p97": 1.8807936,
}

INDICATORS = ("wfa", "lfa", "wfl")  # weight-for-age, length-for-age, weight-for-length
SEXES = ("boys", "girls")

_DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "who_standards.json")


def _lms_value(L: float, M: float, S: float, z: float) -> float:
    """Inverse LMS transform: the measurement at z-score ``z``."""
    if abs(L) < 1e-9:
        from math import exp
        return M * exp(S * z)
    return M * (1.0 + L * S * z) ** (1.0 / L)


@lru_cache(maxsize=1)
def _raw_tables() -> Dict[str, Dict[str, List[dict]]]:
    with open(_DATA_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    for indicator in INDICATORS:
        for sex in SEXES:
            rows = data.get(indicator, {}).get(sex)
            if not rows:
                raise RuntimeError(f"who_standards.json is missing {indicator}/{sex}")
            rows.sort(key=lambda r: r["x"])
    return data


@lru_cache(maxsize=1)
def percentile_curves() -> Dict[str, Dict[str, List[dict]]]:
    """{indicator: {sex: [{"x":…, "p3":…, "p15":…, "p50":…, "p85":…, "p97":…}]}}"""
    curves: Dict[str, Dict[str, List[dict]]] = {}
    for indicator in INDICATORS:
        curves[indicator] = {}
        for sex in SEXES:
            out = []
            for row in _raw_tables()[indicator][sex]:
                if "M" in row:
                    point = {"x": row["x"]}
                    for name, z in PERCENTILE_Z.items():
                        point[name] = round(_lms_value(row["L"], row["M"], row["S"], z), 3)
                else:  # precomputed-percentile fallback shape
                    point = {k: row[k] for k in ("x", *PERCENTILE_Z) if k in row}
                out.append(point)
            curves[indicator][sex] = out
    return curves


def _interpolated_lms(indicator: str, sex: str, x: float) -> Optional[tuple]:
    """Linear interpolation of (L, M, S) at ``x``; None outside the table range."""
    rows = _raw_tables()[indicator][sex]
    if not rows or "M" not in rows[0]:
        return None
    if x < rows[0]["x"] or x > rows[-1]["x"]:
        return None
    for i in range(len(rows) - 1):
        lo, hi = rows[i], rows[i + 1]
        if lo["x"] <= x <= hi["x"]:
            span = hi["x"] - lo["x"]
            t = 0.0 if span == 0 else (x - lo["x"]) / span
            return (
                lo["L"] + t * (hi["L"] - lo["L"]),
                lo["M"] + t * (hi["M"] - lo["M"]),
                lo["S"] + t * (hi["S"] - lo["S"]),
            )
    return None


def value_for_z(indicator: str, sex: str, x: float, z: float) -> Optional[float]:
    """Measurement at z-score ``z`` for age-in-days (wfa/lfa) or length-cm (wfl).

    Used by the demo seeder to generate children tracking a chosen percentile.
    """
    lms = _interpolated_lms(indicator, sex, x)
    if lms is None:
        return None
    return _lms_value(*lms, z)
