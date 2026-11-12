"""A baby's visit plan under the November 2026 protocol, and the two things
the learner records about breastfeeding having stopped.

  GET  /api/visits/children/{id}             the plan (baby page, form runner)
  POST /api/visits/children/{id}/counselled  "I counselled her to restart"
  POST /api/visits/children/{id}/drop-out    confirm the adoption a drop-out

The rules are app/visit_protocol.py (docs/visit-protocol-2026-11.md); the
plan is read from the database by app/visit_plan.py. A learner whose project
runs the older protocol gets {"protocol": "lap_2025"} and nothing else.

Patient data: every route records the access by data principal (the child,
or the mother for the drop-out), and refuses another learner's baby with a
404 after recording the refusal (routers/forms._get_owned_child).
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, visit_plan
from app import visit_protocol as VP
from app.database import get_db
from app.dependencies import get_verified_user, require_phi_access
from app.routers.forms import _get_owned_child
from app.security import phi

router = APIRouter(prefix="/api/visits", tags=["visits"], dependencies=[Depends(require_phi_access)])

DROPOUT_REASON = "not_breastfeeding"


def _plan_or_409(db: Session, user: models.User, child: models.Child) -> Dict[str, Any]:
    plan = visit_plan.child_plan(db, user, child, date.today())
    if plan.get("protocol") != VP.LAP_2026_11:
        raise HTTPException(status_code=409, detail="Your project does not use the November 2026 visit protocol.")
    return plan


@router.get("/children/{child_id}")
def child_visit_plan(child_id: int, current_user: models.User = Depends(get_verified_user),
                     db: Session = Depends(get_db)):
    child = _get_owned_child(db, child_id, current_user)
    plan = visit_plan.child_plan(db, current_user, child, date.today())
    phi.log_read(resource_type="visit_plan", resource_id=child.id, subject_type=phi.CHILD, subject_id=child.id,
                 detail={"protocol": plan.get("protocol")})
    return plan


@router.post("/children/{child_id}/counselled")
def record_counselling(child_id: int, current_user: models.User = Depends(get_verified_user),
                       db: Session = Depends(get_db)):
    """The learner counselled the mother to restart breastfeeding today."""
    child = _get_owned_child(db, child_id, current_user)
    plan = _plan_or_409(db, current_user, child)
    if plan["feeding"]["state"] != "counsel":
        raise HTTPException(status_code=409, detail="There is no stop in breastfeeding to counsel about.")
    child.bf_counselled_on = date.today()
    db.commit()
    phi.log_update(resource_type="child", resource_id=child.id, subject_type=phi.CHILD, subject_id=child.id,
                   changed_fields=["bf_counselled_on"], detail={"action": "bf_counselled"})
    return visit_plan.child_plan(db, current_user, child, date.today())


@router.post("/children/{child_id}/drop-out")
def confirm_drop_out(child_id: int, current_user: models.User = Depends(get_verified_user),
                     db: Session = Depends(get_db)):
    """Breastfeeding still stopped at two visits after the counselling: the
    learner confirms the adoption (the mother and her babies) a drop-out."""
    child = _get_owned_child(db, child_id, current_user)
    plan = _plan_or_409(db, current_user, child)
    if plan["feeding"]["state"] != "can_drop_out":
        raise HTTPException(status_code=409, detail=(
            "A drop-out is confirmed only when breastfeeding is still stopped at two visits after counselling."))
    mother = child.mother
    mother.dropped_out_on = date.today()
    mother.dropped_out_by_user_id = current_user.id
    mother.dropout_reason = DROPOUT_REASON
    db.commit()
    phi.log_update(resource_type="mother", resource_id=mother.id, subject_type=phi.MOTHER, subject_id=mother.id,
                   changed_fields=["dropped_out_on", "dropped_out_by_user_id", "dropout_reason"],
                   detail={"action": "adoption_drop_out", "child_id": child.id, "reason": DROPOUT_REASON})
    return visit_plan.child_plan(db, current_user, child, date.today())
