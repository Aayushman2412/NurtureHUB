"""Checks on a growth measurement as it is entered and saved.

The visit protocol of November 2026 (docs/visit-protocol-2026-11.md, "Entry
checks when a measurement is saved"). A wrong number on a growth chart sends a
baby to the wrong list — a typing slip can look like faltering, and real
faltering can hide behind a slip — so the runner asks right after the weight
or length is typed, and the save records what was flagged:

* impossible values: WAZ < −6 or > +5, LAZ < −6 or > +6, WLZ < −5 or > +5 —
  measure again;
* a likely typing error: the weight more than 1.5× or less than 0.67× the
  previous one, carried forward along the baby's own WHO curve to today (the
  WHO standard "scaled to the interval": six months of normal growth is not
  a slip);
* weight loss since the previous check: ≥ 10 % — weigh again, check danger
  signs, refer today; 5–10 % — ask about diarrhoea, fever and feeding, visit
  again within 7 days. Under 3 weeks the newborn rule (NICE NG75) replaces
  this: more than 10 % below the birth weight is referred, and the usual
  loss of the first days is not flagged;
* the length more than 1 cm shorter than before — measure again, with two
  people holding the baby.

The save is never blocked by these. The flags go into the response's
summary_json under "entry_checks", with which of them the learner confirmed
as right, so the supervisors see them on the case page. Hard refusals (dates
out of order, a birth-day weight far from the birth weight) stay in
app/entry_checks.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy.orm import Session

from app import models

ENTRY_CHECKS_VERSION = 1

# ── The numbers ──────────────────────────────────────────────────────────────
# Impossible z-scores (the WHO "biologically implausible" flags).
IMPOSSIBLE_Z = {"wfa": (-6.0, 5.0), "lfa": (-6.0, 6.0), "wfl": (-5.0, 5.0)}
TYPING_ERROR_ABOVE = 1.5                 # more than 1.5× the expected weight
TYPING_ERROR_BELOW = 0.67                # less than 0.67× the expected weight
LOSS_REFER_AT = 0.10                     # ≥ 10 % lighter: refer today
LOSS_REVISIT_AT = 0.05                   # 5–10 % lighter: revisit within a week
REVISIT_WITHIN_DAYS = 7
LENGTH_SHORTER_CM = 1.0                  # more than 1 cm shorter: measure again
NEWBORN_UNDER_DAYS = 21                  # under 3 weeks: the newborn rule
NEWBORN_MAX_LOSS = 0.10                  # more than 10 % below the birth weight
HISTORY_CHECKS = 12                      # earlier growth checks read for the comparison

# What each flag asks of the learner.
REMEASURE, REFER_TODAY, REVISIT_7D, REMEASURE_TWO = "remeasure", "refer_today", "revisit_7d", "remeasure_two_people"
CODES = ("impossible_wfa", "impossible_lfa", "impossible_wfl", "typing_error",
         "weight_loss_refer", "weight_loss_revisit", "newborn_loss", "length_shorter")


@dataclass(frozen=True)
class Measurement:
    on: date
    weight: Optional[float] = None
    length: Optional[float] = None


def _age(dob: Optional[date], on: date) -> Optional[int]:
    return (on - dob).days if dob else None


def _impossible(current: Measurement, sex: Optional[str], age: Optional[int]) -> List[Dict[str, Any]]:
    from app.who_growth import zscore_for_value

    if not sex:
        return []
    out = []
    for indicator, x, value, field in (("wfa", age, current.weight, "weight"),
                                       ("lfa", age, current.length, "length"),
                                       ("wfl", current.length, current.weight, "weight")):
        if x is None or value is None:
            continue
        z = zscore_for_value(indicator, sex, x, value)
        low, high = IMPOSSIBLE_Z[indicator]
        if z is not None and not low <= z <= high:
            out.append({"code": f"impossible_{indicator}", "field": field, "action": REMEASURE, "z": z})
    return out


def _expected_weight(previous: Measurement, on: date, sex: Optional[str], dob: Optional[date]) -> float:
    """The previous weight carried along the baby's own weight-for-age curve
    to `on`; the previous weight itself when the curve cannot be read."""
    from app.who_growth import value_for_z, zscore_for_value

    then, now = _age(dob, previous.on), _age(dob, on)
    if not sex or then is None or now is None:
        return previous.weight
    z = zscore_for_value("wfa", sex, then, previous.weight)
    if z is None:
        return previous.weight
    carried = value_for_z("wfa", sex, now, max(-3.0, min(3.0, z)))
    if carried is None:
        return previous.weight
    # Keep the baby's own distance from the curve, not the curve's.
    at_then = value_for_z("wfa", sex, then, max(-3.0, min(3.0, z)))
    return previous.weight * (carried / at_then) if at_then else previous.weight


def _weight_flags(current: Measurement, previous: Optional[Measurement], *, sex: Optional[str],
                  dob: Optional[date], birth_weight: Optional[float]) -> List[Dict[str, Any]]:
    weight = current.weight
    out: List[Dict[str, Any]] = []
    prev = {"on": previous.on.isoformat(), "value": previous.weight} if previous else None
    if previous is not None:
        ratio = weight / _expected_weight(previous, current.on, sex, dob)
        if ratio > TYPING_ERROR_ABOVE or ratio < TYPING_ERROR_BELOW:
            out.append({"code": "typing_error", "field": "weight", "action": REMEASURE, "previous": prev})
    age = _age(dob, current.on)
    if age is not None and age < NEWBORN_UNDER_DAYS and birth_weight:
        below = round((birth_weight - weight) / birth_weight, 4)
        if below > NEWBORN_MAX_LOSS:
            out.append({"code": "newborn_loss", "field": "weight", "action": REFER_TODAY,
                        "birth_weight": birth_weight, "loss_pct": round(100 * below)})
        return out
    if previous is None or not previous.weight:
        return out
    loss = round((previous.weight - weight) / previous.weight, 4)
    newborn = age is not None and age < NEWBORN_UNDER_DAYS
    if loss >= LOSS_REFER_AT:
        out.append({"code": "weight_loss_refer", "field": "weight", "action": REFER_TODAY,
                    "loss_pct": round(100 * loss), "previous": prev})
    elif loss >= LOSS_REVISIT_AT and not newborn:
        out.append({"code": "weight_loss_revisit", "field": "weight", "action": REVISIT_7D,
                    "loss_pct": round(100 * loss), "previous": prev, "revisit_within_days": REVISIT_WITHIN_DAYS})
    return out


def _latest(history: Iterable[Measurement], on: date, attr: str) -> Optional[Measurement]:
    earlier = [m for m in history if m.on < on and getattr(m, attr)]
    return max(earlier, key=lambda m: m.on) if earlier else None


def check(current: Measurement, *, sex: Optional[str], dob: Optional[date], birth_weight: Optional[float],
          history: Sequence[Measurement] = ()) -> List[Dict[str, Any]]:
    """Every flag for one measurement, compared with the earlier checks in
    `history` (any order; only those before `current.on` count). Each flag
    names its code, the field it is about and the action it asks for."""
    flags = _impossible(current, sex, _age(dob, current.on))
    if current.weight:
        flags += _weight_flags(current, _latest(history, current.on, "weight"),
                               sex=sex, dob=dob, birth_weight=birth_weight)
    previous_length = _latest(history, current.on, "length")
    if current.length and previous_length is not None:
        shorter = round(previous_length.length - current.length, 2)
        if shorter > LENGTH_SHORTER_CM:
            flags.append({"code": "length_shorter", "field": "length", "action": REMEASURE_TWO,
                          "shorter_cm": shorter,
                          "previous": {"on": previous_length.on.isoformat(), "value": previous_length.length}})
    return flags


# ── With the database ────────────────────────────────────────────────────────

def history_for(db: Session, child_id: int, before: date,
                exclude_response_id: Optional[int] = None) -> List[Measurement]:
    """The child's earlier submitted growth checks, newest first."""
    from app.routers.growth import GROWTH_FORM_KEY, _extract_metrics

    query = (db.query(models.FormResponse.assessment_date, models.FormResponse.answers_json)
             .filter(models.FormResponse.child_id == child_id,
                     models.FormResponse.form_key == GROWTH_FORM_KEY,
                     models.FormResponse.status == "submitted",
                     models.FormResponse.assessment_date < before))
    if exclude_response_id is not None:
        query = query.filter(models.FormResponse.id != exclude_response_id)
    rows = query.order_by(models.FormResponse.assessment_date.desc(), models.FormResponse.id.desc())
    out = []
    for on, answers in rows.limit(HISTORY_CHECKS):
        metrics = _extract_metrics(answers or [])
        out.append(Measurement(on, metrics["weight"], metrics["length"]))
    return out


def run(db: Session, child: models.Child, on: date, weight: Optional[float], length: Optional[float],
        exclude_response_id: Optional[int] = None) -> Dict[str, Any]:
    """The flags for a measurement about to be saved, and the previous values
    they were compared with — what the runner shows the learner."""
    from app.routers.growth import _sex_key

    history = history_for(db, child.id, on, exclude_response_id)
    flags = check(Measurement(on, weight, length), sex=_sex_key(child.gender), dob=child.dob,
                  birth_weight=child.birth_weight, history=history)
    previous = {}
    for attr in ("weight", "length"):
        m = _latest(history, on, attr)
        previous[attr] = {"on": m.on.isoformat(), "value": getattr(m, attr)} if m else None
    return {"flags": flags, "previous": previous}


def for_answers(db: Session, child: Optional[models.Child], on: date, answers: List[Dict[str, Any]], *,
                exclude_response_id: Optional[int] = None,
                confirmed: Iterable[str] = ()) -> Optional[Dict[str, Any]]:
    """What a saved growth check records under summary_json["entry_checks"]:
    the flags and which of them the learner confirmed. None when nothing is
    flagged (or there is nothing measured to check)."""
    from app.routers.growth import _extract_metrics

    if child is None:
        return None
    metrics = _extract_metrics(answers or [])
    if metrics["weight"] is None and metrics["length"] is None:
        return None
    flags = run(db, child, on, metrics["weight"], metrics["length"], exclude_response_id)["flags"]
    if not flags:
        return None
    codes = {f["code"] for f in flags}
    agreed = sorted(codes & {c for c in confirmed if c in CODES})
    return {"version": ENTRY_CHECKS_VERSION, "flags": flags, "confirmed": agreed,
            "all_confirmed": set(agreed) == codes}
