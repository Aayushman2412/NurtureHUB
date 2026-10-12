"""Date and weight checks across a mother, her children and their visits.

The analysts drop a mother–baby pair from the outcome analysis when its
dates contradict each other (app/masd/engine.py `_dyad_checks`). In the
earlier CommCare data that happened often; in NurtureHUB it should not be
possible at all (review of 6–7 Oct 2026), so these are refused at entry,
with a message that says what to correct:

- a baby adopted before its mother;
- a mother's adoption date moved after a visit or a baby's adoption;
- a visit dated before the mother's (or the baby's) adoption, or before the
  baby was born;
- a weight taken within three days of birth that differs from the birth
  weight by more than half a kilogram.

Each check looks only at the date or weight being entered, so an older
record that already breaks a rule can still be edited for other reasons.
Schema-level rules on one record (no future dates, adoption not before
birth, LMP limits) stay in app/schemas.py.
"""
from __future__ import annotations

from datetime import date
from typing import Any, List, Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app.masd import rules as R


def _fmt(d: date) -> str:
    return d.strftime("%d %b %Y")


def _refuse(message: str) -> None:
    raise HTTPException(status_code=400, detail=message)


def child_adoption(mother: models.Mother, adoption_date: Optional[date]) -> None:
    """A baby is adopted with or after its mother, never before."""
    if adoption_date and mother.adoption_date and adoption_date < mother.adoption_date:
        _refuse(f"The baby's adoption date ({_fmt(adoption_date)}) is before the mother's "
                f"({_fmt(mother.adoption_date)}). A baby cannot be adopted before the mother — "
                "correct one of the two dates.")


def mother_adoption(db: Session, mother: models.Mother, adoption_date: Optional[date]) -> None:
    """A mother's adoption date cannot move after a baby's adoption or a visit
    already recorded for her or her babies."""
    if adoption_date is None or mother.id is None:
        return
    child_ids = [cid for (cid,) in db.query(models.Child.id).filter(models.Child.mother_id == mother.id)]
    first_baby = (db.query(func.min(models.Child.adoption_date))
                  .filter(models.Child.mother_id == mother.id).scalar())
    if first_baby and adoption_date > first_baby:
        _refuse(f"A baby of this mother was adopted on {_fmt(first_baby)}, before {_fmt(adoption_date)}. "
                "The mother's adoption date cannot be after her baby's.")
    cond = [models.FormResponse.mother_id == mother.id]
    if child_ids:
        cond.append(models.FormResponse.child_id.in_(child_ids))
    first_visit = (db.query(func.min(models.FormResponse.assessment_date))
                   .filter(or_(*cond)).scalar())
    if first_visit and adoption_date > first_visit:
        _refuse(f"There is a visit recorded on {_fmt(first_visit)}, before {_fmt(adoption_date)}. "
                "The adoption date cannot be after the first visit — it is the day of the adoption visit.")


def assessment_date(on: date, *, mother: Optional[models.Mother] = None,
                    child: Optional[models.Child] = None) -> None:
    """A visit falls on or after the adoption (the mother's, and the baby's
    if the baby has one) and, for a baby, on or after the birth."""
    m = mother if mother is not None else (child.mother if child is not None else None)
    if child is not None and child.dob and on < child.dob:
        _refuse(f"The assessment date ({_fmt(on)}) is before the baby was born ({_fmt(child.dob)}).")
    if child is not None and child.adoption_date and on < child.adoption_date:
        _refuse(f"The assessment date ({_fmt(on)}) is before the baby was adopted ({_fmt(child.adoption_date)}). "
                "Visits start from the day of adoption.")
    if m is not None and m.adoption_date and on < m.adoption_date:
        _refuse(f"The assessment date ({_fmt(on)}) is before the mother was adopted ({_fmt(m.adoption_date)}). "
                "Visits start from the day of adoption.")


def birth_weight(child: Optional[models.Child], on: date, answers: List[Any]) -> None:
    """A growth check within three days of birth is in effect the birth
    weighing, and should agree with the birth weight to within 0.5 kg."""
    if child is None or child.dob is None or child.birth_weight is None:
        return
    days = (on - child.dob).days
    if not 0 <= days <= R.BIRTH_VISIT_WINDOW_DAYS:
        return
    from app.routers.growth import _extract_metrics  # the growth monitor's own reading of the form

    weight = _extract_metrics(answers or []).get("weight")
    if weight is None:
        return
    if abs(weight - child.birth_weight) > R.BIRTH_WEIGHT_TOLERANCE_KG:
        _refuse(f"The weight {weight:g} kg, {days} day(s) after birth, differs from the birth weight "
                f"({child.birth_weight:g} kg) by more than {R.BIRTH_WEIGHT_TOLERANCE_KG:g} kg. "
                "Check this weight, or correct the birth weight on the child's profile.")
