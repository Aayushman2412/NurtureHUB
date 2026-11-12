"""The learner's growth status endpoints (visit protocol, November 2026).

- GET  /api/growth/my-babies                          → "My babies' growth": the
  four groups over her babies' latest checks (app/growth_groups.py)
- POST /api/growth/my-cases/{child_id}/measurement-check → the measurement
  checks for a weight/length about to be saved (app/growth_entry_checks.py),
  so the runner can ask "measure again, or is it right?" before the save

Both are her own babies only. The listing is audited as a list read; the check
reads the baby's earlier measurements, so it is audited as a read, and a baby
she did not register answers 404 with the true reason recorded.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import growth_entry_checks, growth_groups, models
from app.database import get_db
from app.dependencies import get_verified_user, require_phi_access
from app.security import phi

router = APIRouter(prefix="/api/growth", tags=["growth"], dependencies=[Depends(require_phi_access)])


class MeasurementCheckIn(BaseModel):
    assessment_date: date
    # Wide limits on purpose: "75" typed for 7.5 has to reach the check.
    weight: Optional[float] = Field(default=None, gt=0, le=500)
    length: Optional[float] = Field(default=None, gt=0, le=500)
    # The growth check being edited, so it is not compared with itself.
    response_id: Optional[int] = None


@router.get("/my-babies")
def my_babies_growth(current_user: models.User = Depends(get_verified_user), db: Session = Depends(get_db)):
    view = growth_groups.my_babies(db, current_user)
    ids = [b["child_id"] for b in view["babies"] + view["unmeasured"]]
    phi.log_list(
        resource_type="growth_status", count=len(ids), subject_type=phi.CHILD, subject_ids=ids,
        detail={"scope": "own_cases", "view": "my_babies_growth",
                "fields": ["child_name", "mother_name", "measurements"]},
    )
    return view


@router.post("/my-cases/{child_id}/measurement-check")
def check_measurement(child_id: int, data: MeasurementCheckIn,
                      current_user: models.User = Depends(get_verified_user), db: Session = Depends(get_db)):
    child = db.get(models.Child, child_id)
    mother = db.get(models.Mother, child.mother_id) if child else None
    if child is None or mother is None or mother.registered_by_user_id != current_user.id:
        phi.log_denied(resource_type="growth_case", resource_id=child_id, subject_type=phi.CHILD,
                       subject_id=child_id, reason="no_such_record" if child is None else "not_owner")
        raise HTTPException(status_code=404, detail="Child not found")
    result = growth_entry_checks.run(db, child, data.assessment_date, data.weight, data.length,
                                     exclude_response_id=data.response_id)
    phi.log_read(
        resource_type="growth_case", resource_id=child_id, subject_type=phi.CHILD, subject_id=child_id,
        fields=["measurements"],
        detail={"scope": "measurement_check", "flags": [f["code"] for f in result["flags"]]},
    )
    return result
